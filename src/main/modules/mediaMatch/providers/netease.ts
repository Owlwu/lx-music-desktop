import { request } from '@common/utils/request'
import { log } from '@common/utils'
import { hasInstrumentalMark } from '@common/utils/mediaMatch/normalize'
import { sanitizeExtendedLyric, validateLyric } from '@common/utils/mediaMatch/lrcText'
import { htmlUnescape } from '@common/utils/mediaMatch/qqParse'

/**
 * 网易云音乐歌词源（第三方非官方接口、无 key）
 *
 * 与 QQ/LRCLIB 不同，这个源除了主歌词还能返回行级中文翻译（`tlyric`）与罗马音
 * （`romalrc` / `yromalrc`）。搜索只返回候选元数据，取词时才拉翻译/罗马音。
 * 不发送任何 Cookie；日志只记 source/cost/count/code，不打印歌词/URL 正文。
 */

const SEARCH_URL = 'https://music.163.com/api/search/get/web'
const LYRIC_URL = 'https://music.163.com/api/song/lyric'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REFERER = 'https://music.163.com/'
const REQUEST_INTERVAL = 300
const REQUEST_TIMEOUT = 10000
const MAX_BODY_SIZE = 4 * 1024 * 1024
const MAX_KEYWORDS = 2
const CACHE_LIMIT = 50

const lyricCache = new Map<string, LX.MediaMatch.LyricResult>()
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const asString = (value: unknown): string => typeof value === 'string' ? value : ''

const asIdString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

const toNumber = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const cacheGet = (key: string): LX.MediaMatch.LyricResult | undefined => {
  const item = lyricCache.get(key)
  if (!item) return undefined
  lyricCache.delete(key)
  lyricCache.set(key, item)
  return item
}

const cachePut = (key: string, item: LX.MediaMatch.LyricResult): void => {
  if (lyricCache.has(key)) lyricCache.delete(key)
  lyricCache.set(key, item)
  while (lyricCache.size > CACHE_LIMIT) {
    const first = lyricCache.keys().next().value
    if (first == null) break
    lyricCache.delete(first)
  }
}

const buildHeaders = (): Record<string, string> => ({
  'User-Agent': UA,
  Referer: REFERER,
  Accept: 'application/json',
})

interface JsonResponse {
  failed: boolean
  json: unknown
}

const requestJson = async(
  url: string,
  query: Record<string, string>,
  signal?: AbortSignal,
): Promise<JsonResponse> => {
  if (isAborted(signal)) return { failed: true, json: null }
  await waitInterval()
  if (isAborted(signal)) return { failed: true, json: null }

  let response: Awaited<ReturnType<typeof request>>
  try {
    response = await request(url, {
      query,
      timeout: REQUEST_TIMEOUT,
      signal,
      needRaw: true,
      maxRedirect: 4,
      // 失败直接降级到其他源，关闭 undici 内建重试避免额外等待
      retryNum: 0,
      headers: buildHeaders(),
    })
  } catch {
    if (isAborted(signal)) return { failed: true, json: null }
    log.debug('[mediaMatch][netease] request failed', { source: 'netease', code: 'request' })
    return { failed: true, json: null }
  }

  const statusCode = response.statusCode ?? 0
  if (statusCode !== 200) {
    log.debug('[mediaMatch][netease] unexpected status', { source: 'netease', code: statusCode })
    return { failed: true, json: null }
  }
  const raw = response.raw
  if (!raw?.byteLength || raw.byteLength > MAX_BODY_SIZE) {
    log.debug('[mediaMatch][netease] response too large or empty', { source: 'netease', code: 'body' })
    return { failed: true, json: null }
  }
  try {
    return { failed: false, json: JSON.parse(Buffer.from(raw).toString('utf8')) as unknown }
  } catch {
    log.debug('[mediaMatch][netease] parse json failed', { source: 'netease', code: 'json' })
    return { failed: true, json: null }
  }
}

interface NeteaseSearchResult {
  ok: boolean
  code: number
  candidates: LX.MediaMatch.LyricsCandidate[]
}

const normalizeDurationSec = (value: unknown): number | null => {
  const ms = toNumber(value)
  if (ms == null || ms <= 0) return null
  return ms / 1000
}

const toCandidate = (item: Record<string, unknown>): LX.MediaMatch.LyricsCandidate | null => {
  const id = asIdString(item.id)
  if (!id) return null
  const name = htmlUnescape(asString(item.name)).trim()
  if (!name) return null
  const singers = Array.isArray(item.artists)
    ? item.artists
      .map(artist => isRecord(artist) ? htmlUnescape(asString(artist.name)).trim() : '')
      .filter(Boolean)
    : []
  return {
    source: 'netease',
    id,
    name,
    singer: singers.join(' / '),
    albumName: isRecord(item.album) ? htmlUnescape(asString(item.album.name)).trim() : '',
    durationSec: normalizeDurationSec(item.duration),
    hasSynced: null,
    instrumental: hasInstrumentalMark(name),
    score: 0,
  }
}

const parseSearchResponse = (json: unknown): NeteaseSearchResult => {
  if (!isRecord(json)) return { ok: false, code: 0, candidates: [] }
  const code = toNumber(json.code) ?? 0
  if (code !== 200) return { ok: false, code, candidates: [] }
  if (!isRecord(json.result) || !Array.isArray(json.result.songs)) return { ok: true, code, candidates: [] }

  const seen = new Set<string>()
  const candidates: LX.MediaMatch.LyricsCandidate[] = []
  for (const item of json.result.songs) {
    if (!isRecord(item)) continue
    const candidate = toCandidate(item)
    if (!candidate || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    candidates.push(candidate)
  }
  return { ok: true, code, candidates }
}

const search = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricsCandidate[]> => {
  const startedAt = Date.now()
  const keywords = query.variants.slice(0, MAX_KEYWORDS)
  if (!keywords.length) {
    log.debug('[mediaMatch][netease] search empty', { source: 'netease', cost: 0, count: 0, code: 200 })
    return []
  }

  let allFailed = true
  let code = 0
  for (const keyword of keywords) {
    if (isAborted(signal)) return []
    const response = await requestJson(SEARCH_URL, {
      csrf_token: '',
      s: keyword,
      type: '1',
      offset: '0',
      limit: '10',
    }, signal)
    if (!response.json) continue
    const parsed = parseSearchResponse(response.json)
    code = parsed.code
    if (!parsed.ok) continue
    allFailed = false
    if (!parsed.candidates.length) continue

    log.debug('[mediaMatch][netease] search done', {
      source: 'netease',
      cost: Date.now() - startedAt,
      count: parsed.candidates.length,
      code,
    })
    return parsed.candidates
  }

  if (allFailed) {
    log.debug('[mediaMatch][netease] search failed', {
      source: 'netease',
      cost: Date.now() - startedAt,
      count: 0,
      code,
    })
    throw new Error('netease search failed')
  }
  log.debug('[mediaMatch][netease] search empty', {
    source: 'netease',
    cost: Date.now() - startedAt,
    count: 0,
    code,
  })
  return []
}

const getLyric = async(
  candidate: LX.MediaMatch.LyricsCandidate,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricResult | null> => {
  if (candidate.source !== 'netease') return null
  const cached = cacheGet(candidate.id)
  if (cached) return cached

  const startedAt = Date.now()
  const response = await requestJson(LYRIC_URL, {
    id: candidate.id,
    lv: '-1',
    kv: '-1',
    tv: '-1',
    rv: '-1',
  }, signal)
  if (!response.json) return null

  const json = response.json
  const code = isRecord(json) ? toNumber(json.code) ?? 0 : 0
  if (!isRecord(json) || code !== 200) {
    log.debug('[mediaMatch][netease] get lyric failed', {
      source: 'netease',
      cost: Date.now() - startedAt,
      count: 0,
      code,
    })
    return null
  }
  // nolyric/uncollected：纯音乐或未收录，主歌词不可用
  if (json.nolyric === true || json.uncollected === true) {
    log.debug('[mediaMatch][netease] get lyric nolyric', {
      source: 'netease',
      cost: Date.now() - startedAt,
      count: 0,
      code,
    })
    return null
  }

  const lyric = isRecord(json.lrc) ? asString(json.lrc.lyric) : ''
  const validation = validateLyric(lyric)
  if (!validation.usable) {
    log.debug('[mediaMatch][netease] get lyric unusable', {
      source: 'netease',
      cost: Date.now() - startedAt,
      count: 0,
      code,
    })
    return null
  }

  const tlyric = sanitizeExtendedLyric(isRecord(json.tlyric) ? asString(json.tlyric.lyric) : '')
  const roma = sanitizeExtendedLyric(isRecord(json.romalrc) ? asString(json.romalrc.lyric) : '')
  const romaFallback = sanitizeExtendedLyric(isRecord(json.yromalrc) ? asString(json.yromalrc.lyric) : '')
  const rlyric = roma || romaFallback

  const result: LX.MediaMatch.LyricResult = {
    lyric,
    isSynced: validation.isSynced,
    tlyric,
    rlyric,
  }
  cachePut(candidate.id, result)
  log.debug('[mediaMatch][netease] get lyric done', {
    source: 'netease',
    cost: Date.now() - startedAt,
    count: tlyric ? tlyric.split('\n').length : 0,
    code,
  })
  return result
}

const provider: LX.MediaMatch.LyricsProvider = {
  id: 'netease',
  search,
  getLyric,
}

export default provider
