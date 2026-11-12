import { request } from '@common/utils/request'
import { log } from '@common/utils'
import { cleanQueryName } from '@common/utils/mediaMatch/normalize'
import { parseQqLyricResponse, parseQqSearchResponse } from '@common/utils/mediaMatch/qqParse'

const SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REQUEST_INTERVAL = 260
const REQUEST_TIMEOUT = 10000
const MAX_BODY_SIZE = 2 * 1024 * 1024
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

const cachePut = (key: string, value: LX.MediaMatch.LyricResult): void => {
  if (lyricCache.has(key)) lyricCache.delete(key)
  lyricCache.set(key, value)
  while (lyricCache.size > CACHE_LIMIT) {
    const first = lyricCache.keys().next().value
    if (first == null) break
    lyricCache.delete(first)
  }
}

const requestJson = async(
  url: string,
  query: Record<string, string | number>,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown | null> => {
  if (isAborted(signal)) return null
  await waitInterval()
  if (isAborted(signal)) return null

  try {
    const response = await request(url, {
      query,
      timeout: REQUEST_TIMEOUT,
      signal,
      needRaw: true,
      // QQ 失败直接降级，关闭 undici 内建重试避免额外等待
      maxRedirect: 4,
      retryNum: 0,
      headers: {
        'User-Agent': UA,
        ...headers,
      },
    })
    if (response.statusCode !== 200) {
      log.debug('[mediaMatch][qq] unexpected status', response.statusCode)
      return null
    }
    const raw = response.raw
    if (!raw || raw.byteLength > MAX_BODY_SIZE) {
      log.debug('[mediaMatch][qq] response too large or empty', raw?.byteLength ?? 0)
      return null
    }
    // QQ 的 Content-Type 不可信（text/html 但 body 是 JSON），必须按文本解析
    return JSON.parse(Buffer.from(raw).toString('utf8')) as unknown
  } catch (err) {
    if (!isAborted(signal)) log.debug('[mediaMatch][qq] request failed', err)
    return null
  }
}

const search = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricsCandidate[]> => {
  const startedAt = Date.now()
  const keywords: string[] = []
  const primaryKeyword = [query.name, query.singer].filter(Boolean).join(' ')
  if (primaryKeyword) keywords.push(primaryKeyword)
  const cleanedName = cleanQueryName(query.name)
  if (cleanedName && cleanedName !== primaryKeyword) keywords.push(cleanedName)

  for (const keyword of keywords.slice(0, 2)) {
    if (isAborted(signal)) return []
    const json = await requestJson(SEARCH_URL, {
      format: 'json',
      n: 10,
      p: 1,
      w: keyword,
      cr: 1,
      g_tk: 5381,
    }, {}, signal)
    if (!json) continue
    const items = parseQqSearchResponse(json)
    if (!items.length) continue

    const candidates = items.map(item => ({
      source: 'qq' as const,
      id: item.id,
      name: item.name,
      singer: item.singer,
      albumName: item.albumName,
      durationSec: item.durationSec,
      hasSynced: null,
      instrumental: item.instrumental,
      score: 0,
    }))
    log.debug('[mediaMatch][qq] search done', {
      cost: Date.now() - startedAt,
      count: candidates.length,
    })
    return candidates
  }

  log.debug('[mediaMatch][qq] search empty', { cost: Date.now() - startedAt })
  return []
}

const getLyric = async(
  candidate: LX.MediaMatch.LyricsCandidate,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricResult | null> => {
  if (candidate.source !== 'qq') return null
  const cached = lyricCache.get(candidate.id)
  if (cached) return cached

  const json = await requestJson(LYRIC_URL, {
    songmid: candidate.id,
    format: 'json',
    nobase64: 1,
    g_tk: 5381,
  }, {
    // 歌词接口硬要求 Referer，缺失会返回 -1310
    Referer: 'https://y.qq.com/',
  }, signal)
  if (!json) return null

  const parsed = parseQqLyricResponse(json)
  log.debug('[mediaMatch][qq] get lyric done', {
    code: parsed.code,
    placeholder: parsed.placeholder,
    usable: parsed.lyric != null,
  })
  if (!parsed.lyric) return null

  const result = {
    lyric: parsed.lyric,
    isSynced: parsed.isSynced,
  }
  cachePut(candidate.id, result)
  return result
}

const provider: LX.MediaMatch.LyricsProvider = {
  id: 'qq',
  search,
  getLyric,
}

export default provider
