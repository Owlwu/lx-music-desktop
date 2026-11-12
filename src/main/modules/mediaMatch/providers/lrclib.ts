import { request } from '@common/utils/request'
import { log } from '@common/utils'
import { hasInstrumentalMark } from '@common/utils/mediaMatch/normalize'
import { validateLyric } from '@common/utils/mediaMatch/lrcText'
import { buildLrclibKeywordFallbacks } from '@common/utils/mediaMatch/query'
import { parseRetryAfterMs, resolveRetryDelayMs } from '../retry'

const BASE_URL = 'https://lrclib.net/api'
const MAX_BODY_SIZE = 2 * 1024 * 1024
// 串行请求间隔，避免触发源站限流
const REQUEST_INTERVAL = 260
const REQUEST_TIMEOUT = 10000
const CACHE_LIMIT = 50
const APP_VERSION = process.versions.app || '2.12.6'

interface LrclibItem {
  id?: number
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number | string | null
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

const lyricCache = new Map<string, LrclibItem>()
let lastRequestTime = 0

const sleep = async(ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms)
})

const isAborted = (signal?: AbortSignal): boolean => !!signal?.aborted

const waitInterval = async(): Promise<void> => {
  const wait = REQUEST_INTERVAL - (Date.now() - lastRequestTime)
  lastRequestTime = Date.now()
  if (wait > 0) await sleep(wait)
}

const cachePut = (key: string, item: LrclibItem): void => {
  if (lyricCache.has(key)) lyricCache.delete(key)
  lyricCache.set(key, item)
  while (lyricCache.size > CACHE_LIMIT) {
    const first = lyricCache.keys().next().value
    if (first == null) break
    lyricCache.delete(first)
  }
}

const cacheGet = (key: string): LrclibItem | undefined => {
  const item = lyricCache.get(key)
  if (!item) return undefined
  lyricCache.delete(key)
  lyricCache.set(key, item)
  return item
}

const sleepWithJitter = async(delayMs: number): Promise<void> => {
  // 只在服务端要求的基础上增加 ≤30% 抖动，绝不低于服务端值
  const jitter = Math.floor(Math.random() * delayMs * 0.3)
  await sleep(delayMs + jitter)
}

const buildHeaders = () => ({
  'User-Agent': `LXMusicLocal/${APP_VERSION} (+https://github.com/lyswhut/lx-music-desktop)`,
  Accept: 'application/json',
})

const requestJson = async<T>(
  url: string,
  query: Record<string, string> | null,
  signal?: AbortSignal,
  retryLeft = 2,
): Promise<T | null> => {
  for (let attempt = 0; attempt <= retryLeft; attempt++) {
    if (isAborted(signal)) return null
    await waitInterval()
    if (isAborted(signal)) return null

    let response: Awaited<ReturnType<typeof request>>
    try {
      response = await request(url, {
        query: query ?? undefined,
        timeout: REQUEST_TIMEOUT,
        signal,
        needRaw: true,
        // 关闭 undici 内建重试，Retry-After 策略统一由本函数控制（避免内部提前重试）
        maxRedirect: 4,
        retryNum: 0,
        headers: buildHeaders(),
      })
    } catch (err) {
      if (isAborted(signal) || attempt >= retryLeft) {
        log.debug('[mediaMatch][lrclib] request failed', err)
        return null
      }
      await sleepWithJitter(resolveRetryDelayMs(null, attempt) ?? 500)
      continue
    }

    const statusCode = response.statusCode ?? 0
    if (statusCode === 429 || statusCode === 503) {
      const delayMs = resolveRetryDelayMs(parseRetryAfterMs(response.headers['retry-after']), attempt)
      if (delayMs == null || attempt >= retryLeft) {
        // Retry-After >30s 或重试次数用尽：放弃本次/该源，不在服务端要求前重试
        log.debug('[mediaMatch][lrclib] rate limited, give up source', statusCode)
        throw new Error('lrclib rate limited')
      }
      await sleepWithJitter(delayMs)
      continue
    }
    // /api/get 的 400 是 text/plain，404 是 JSON；统一只按状态码处理
    if (statusCode !== 200) {
      log.debug('[mediaMatch][lrclib] unexpected status', statusCode)
      return null
    }

    const raw = response.raw
    if (!raw || raw.byteLength > MAX_BODY_SIZE) {
      log.debug('[mediaMatch][lrclib] response too large or empty', raw?.byteLength ?? 0)
      return null
    }
    try {
      return JSON.parse(Buffer.from(raw).toString('utf8')) as T
    } catch (err) {
      log.debug('[mediaMatch][lrclib] parse json failed', err)
      return null
    }
  }
  return null
}

const normalizeAlbumName = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const albumName = value.trim()
  return albumName.toLowerCase() === 'null' ? '' : albumName
}

const normalizeDuration = (value: unknown): number | null => {
  const duration = Number(value)
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

const toCandidate = (item: LrclibItem): LX.MediaMatch.LyricsCandidate | null => {
  if (item.id == null) return null
  const name = (item.trackName ?? '').trim()
  if (!name) return null

  const hasSynced = !!item.syncedLyrics
  if (!hasSynced && !item.plainLyrics && !item.instrumental) return null

  const id = String(item.id)
  cachePut(id, item)
  return {
    source: 'lrclib',
    id,
    name,
    singer: (item.artistName ?? '').trim(),
    albumName: normalizeAlbumName(item.albumName),
    durationSec: normalizeDuration(item.duration),
    hasSynced,
    instrumental: item.instrumental === true || hasInstrumentalMark(name),
    score: 0,
  }
}

const searchByKeyword = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LrclibItem[]> => {
  const structured: Record<string, string> = { track_name: query.name }
  if (query.singer) structured.artist_name = query.singer
  if (query.albumName) structured.album_name = query.albumName

  let items = await requestJson<LrclibItem[]>(BASE_URL + '/search', structured, signal)
  if (items?.length) return items

  // 结构化无结果时回退 q=：首项固定 name singer，随后仅 name / 清洗后的 name
  const fallbacks = buildLrclibKeywordFallbacks(query)
  for (const keyword of fallbacks) {
    if (isAborted(signal)) return []
    items = await requestJson<LrclibItem[]>(BASE_URL + '/search', { q: keyword }, signal)
    if (items?.length) return items
  }
  return []
}

const search = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricsCandidate[]> => {
  if (!query.name) return []
  const startedAt = Date.now()
  const items = await searchByKeyword(query, signal)
  const candidates = items.map(toCandidate).filter((item): item is LX.MediaMatch.LyricsCandidate => item != null)
  log.debug('[mediaMatch][lrclib] search done', {
    cost: Date.now() - startedAt,
    count: candidates.length,
  })
  return candidates
}

const getLyric = async(
  candidate: LX.MediaMatch.LyricsCandidate,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricResult | null> => {
  if (candidate.source !== 'lrclib') return null

  let item = cacheGet(candidate.id)
  if (!item) {
    const response = await requestJson<LrclibItem>(BASE_URL + '/get/' + encodeURIComponent(candidate.id), null, signal)
    if (!response?.id) return null
    item = response
    cachePut(String(response.id), response)
  }

  if (item.instrumental) return null
  let lyric = item.syncedLyrics ?? ''
  if (!lyric && item.plainLyrics) lyric = item.plainLyrics
  const validation = validateLyric(lyric)
  if (!validation.usable) return null
  return {
    lyric,
    isSynced: validation.isSynced,
  }
}

const provider: LX.MediaMatch.LyricsProvider = {
  id: 'lrclib',
  search,
  getLyric,
}

export default provider
