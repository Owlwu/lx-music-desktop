import { request } from '@common/utils/request'
import { log } from '@common/utils'
import { cleanQueryName } from '@common/utils/mediaMatch/normalize'
import { extractQrcLyricText, parseQqLyricResponse, parseQqSearchResponse, parseQqWordSyncResponse } from '@common/utils/mediaMatch/qqParse'
import { isUsableWordSync, parseQrcLyric, type QrcLyricResult } from '@common/utils/mediaMatch/qrcLyric'
import { decodeQrc } from '@common/utils/lyricUtils/qrc'
import { parseRetryAfterMs, resolveRetryDelayMs } from '../retry'

const SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const LYRIC_URL = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg'
const WORD_SYNC_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REQUEST_INTERVAL = 260
const REQUEST_TIMEOUT = 10000
const MAX_BODY_SIZE = 2 * 1024 * 1024
const CACHE_LIMIT = 50

const lyricCache = new Map<string, LX.MediaMatch.LyricResult>()
const wordSyncCache = new Map<string, LX.MediaMatch.WordSyncResult>()
let lastRequestTime = 0

const sleep = async(ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms)
})

const sleepWithJitter = async(delayMs: number): Promise<void> => {
  // 只在不低于服务端/退避值的基础上增加 ≤30% 抖动
  await sleep(delayMs + Math.floor(Math.random() * delayMs * 0.3))
}

const isAborted = (signal?: AbortSignal): boolean => !!signal?.aborted

const waitInterval = async(): Promise<void> => {
  const wait = REQUEST_INTERVAL - (Date.now() - lastRequestTime)
  lastRequestTime = Date.now()
  if (wait > 0) await sleep(wait)
}

/**
 * 简易 LRU：命中后重新插到队尾，超出容量淘汰最旧
 */
const lruPut = <T>(cache: Map<string, T>, key: string, value: T): void => {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) {
    const first = cache.keys().next().value
    if (first == null) break
    cache.delete(first)
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
      // QRC 逐字接口需要数字 songid（songmid 是搜索/行级歌词用）
      trackId: item.songId || undefined,
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
  lruPut(lyricCache, candidate.id, result)
  return result
}

const requestPostJson = async(
  url: string,
  json: Record<string, unknown>,
  headers: Record<string, string>,
  signal?: AbortSignal,
  retryLeft = 2,
): Promise<unknown | null> => {
  if (isAborted(signal)) return null

  for (let attempt = 0; attempt <= retryLeft; attempt++) {
    await waitInterval()
    if (isAborted(signal)) return null

    let response: Awaited<ReturnType<typeof request>>
    try {
      response = await request(url, {
        method: 'POST',
        json,
        timeout: REQUEST_TIMEOUT,
        signal,
        needRaw: true,
        maxRedirect: 4,
        // 关闭 undici 内建重试，非 200 的退避由本函数统一控制
        retryNum: 0,
        headers: {
          'User-Agent': UA,
          ...headers,
        },
      })
    } catch (err) {
      if (isAborted(signal) || attempt >= retryLeft) {
        if (!isAborted(signal)) log.debug('[mediaMatch][qq] request failed', err)
        return null
      }
      await sleepWithJitter(resolveRetryDelayMs(null, attempt) ?? 500)
      continue
    }

    const statusCode = response.statusCode ?? 0
    if (statusCode !== 200) {
      if (attempt >= retryLeft) {
        log.debug('[mediaMatch][qq] unexpected status', statusCode)
        return null
      }
      // 非 200：按 Retry-After（若给）或指数退避重试，最多 2 次
      const delayMs = resolveRetryDelayMs(parseRetryAfterMs(response.headers['retry-after']), attempt) ?? 500
      await sleepWithJitter(delayMs)
      continue
    }

    const raw = response.raw
    if (!raw || raw.byteLength > MAX_BODY_SIZE) {
      log.debug('[mediaMatch][qq] response too large or empty', raw?.byteLength ?? 0)
      return null
    }
    try {
      return JSON.parse(Buffer.from(raw).toString('utf8')) as unknown
    } catch (err) {
      log.debug('[mediaMatch][qq] parse json failed', err)
      return null
    }
  }
  return null
}

/**
 * musicu.fcg GetPlayLyricInfo 请求体：qrc:1 与 crypt:1 都不能省
 * （少 qrc:1 会静默退化成 base64 行级 LRC）。
 */
const buildWordSyncBody = (songId: string): Record<string, unknown> => ({
  comm: { ct: '19', cv: '1859', uin: '0' },
  req: {
    method: 'GetPlayLyricInfo',
    module: 'music.musichallSong.PlayLyricInfo',
    param: {
      format: 'json',
      crypt: 1,
      ct: 19,
      cv: 1873,
      interval: 0,
      lrc_t: 0,
      qrc: 1,
      qrc_t: 0,
      roma: 1,
      roma_t: 0,
      songID: /^\d+$/.test(songId) ? Number(songId) : songId,
      trans: 1,
      trans_t: 0,
      type: -1,
    },
  },
})

const toWordSyncResult = (result: QrcLyricResult): LX.MediaMatch.WordSyncResult => ({
  lyric: result.lyric,
  lxlyric: result.lxlyric,
})

/**
 * 取 QQ QRC 逐字歌词：hex -> 3DES -> zlib -> XML/纯文本 -> lxlyric。
 * 任何一步失败都返回 null（调用方静默降级行级）。
 */
export const getWordSync = async(
  candidate: LX.MediaMatch.LyricsCandidate,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.WordSyncResult | null> => {
  if (candidate.source !== 'qq') return null
  const songId = candidate.trackId?.trim()
  if (!songId) return null
  const cached = wordSyncCache.get(songId)
  if (cached) return cached

  const json = await requestPostJson(WORD_SYNC_URL, buildWordSyncBody(songId), {
    // musicu 实测不挑 header，统一带上更稳
    Referer: 'https://y.qq.com/',
  }, signal)
  if (!json) return null

  const parsed = parseQqWordSyncResponse(json)
  if (!parsed.lyric) {
    log.debug('[mediaMatch][qq] word sync unavailable', {
      code: parsed.code,
      reqCode: parsed.reqCode,
      qrc: parsed.qrc,
    })
    return null
  }

  const decoded = await decodeQrc(parsed.lyric)
  if (!decoded) {
    log.debug('[mediaMatch][qq] word sync decode failed', { hexLength: parsed.lyric.length })
    return null
  }
  const result = parseQrcLyric(extractQrcLyricText(decoded))
  // 日志只记长度/数量，不打印歌词正文与密文
  log.debug('[mediaMatch][qq] word sync parsed', {
    hexLength: parsed.lyric.length,
    decodedLength: decoded.length,
    lineCount: result.lineCount,
    wordLineCount: result.wordLineCount,
    wordTagCount: result.wordTagCount,
  })
  if (!isUsableWordSync(result)) return null

  const wordSync = toWordSyncResult(result)
  lruPut(wordSyncCache, songId, wordSync)
  return wordSync
}

const provider: LX.MediaMatch.LyricsProvider = {
  id: 'qq',
  search,
  getLyric,
}

export default provider
