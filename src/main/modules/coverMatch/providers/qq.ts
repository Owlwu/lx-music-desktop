import { log } from '@common/utils'
import { htmlUnescape } from '@common/utils/mediaMatch/qqParse'
import { request } from '@common/utils/request'

/**
 * QQ 音乐封面源（主源）
 *
 * 复用一期 QQ 搜索 `client_search_cp`，从结果里取 `albummid` 拼封面 URL。
 * 实测封面请求不需要 Referer/UA，但显式 Accept image/webp 会返回 webp，
 * 因此下载时统一请求 jpeg/png（见 matcher 的 downloadCoverImage）。
 */

const SEARCH_URL = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp'
const COVER_URL = 'https://y.qq.com/music/photo_new/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 10000
const REQUEST_INTERVAL = 300
const MAX_BODY_SIZE = 2 * 1024 * 1024
const MAX_KEYWORDS = 2

let lastRequestTime = 0

const sleep = async(ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms)
})

const waitInterval = async(): Promise<void> => {
  const wait = REQUEST_INTERVAL - (Date.now() - lastRequestTime)
  lastRequestTime = Date.now()
  if (wait > 0) await sleep(wait)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const asString = (value: unknown): string => typeof value === 'string' ? value : ''

const toNumber = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * QQ 封面 URL：500 为大图（R500 实测真封面），150 为缩略图
 */
export const buildQqCoverUrl = (albummid: string, size: 150 | 500): string => {
  return `${COVER_URL}T002R${size}x${size}M000${albummid}.jpg`
}

const parseSearchResponse = (json: unknown): LX.CoverMatch.CoverCandidate[] => {
  if (!isRecord(json) || toNumber(json.code) !== 0) return []
  const data = json.data
  if (!isRecord(data)) return []
  const song = data.song
  if (!isRecord(song) || !Array.isArray(song.list)) return []

  const candidates: LX.CoverMatch.CoverCandidate[] = []
  for (const item of song.list) {
    if (!isRecord(item)) continue
    const albummid = asString(item.albummid).trim()
    if (!albummid) continue
    const name = htmlUnescape(asString(item.songname)).trim()
    if (!name) continue
    const singers = Array.isArray(item.singer)
      ? item.singer
        .map(singer => isRecord(singer) ? htmlUnescape(asString(singer.name)).trim() : '')
        .filter(Boolean)
      : []
    candidates.push({
      source: 'qq',
      id: albummid,
      name,
      singer: singers.join(' / '),
      albumName: htmlUnescape(asString(item.albumname)).trim(),
      durationSec: toNumber(item.interval),
      coverUrl: buildQqCoverUrl(albummid, 500),
      thumbnailUrl: buildQqCoverUrl(albummid, 150),
      score: 0,
    })
  }
  return candidates
}

const requestSearch = async(keyword: string, signal?: AbortSignal): Promise<unknown | null> => {
  if (signal?.aborted) return null
  await waitInterval()
  if (signal?.aborted) return null
  try {
    const response = await request(SEARCH_URL, {
      query: {
        format: 'json',
        n: 10,
        p: 1,
        w: keyword,
        cr: 1,
        g_tk: 5381,
      },
      timeout: REQUEST_TIMEOUT,
      signal,
      needRaw: true,
      maxRedirect: 4,
      // 失败直接降级到另一源，关闭 undici 内建重试避免额外等待
      retryNum: 0,
      headers: { 'User-Agent': UA },
    })
    if (response.statusCode !== 200) {
      log.debug('[coverMatch][qq] unexpected status', response.statusCode)
      return null
    }
    const raw = response.raw
    if (!raw?.byteLength || raw.byteLength > MAX_BODY_SIZE) {
      log.debug('[coverMatch][qq] response too large or empty', raw?.byteLength ?? 0)
      return null
    }
    // QQ 的 Content-Type 不可信（text/html 但 body 是 JSON），按文本解析
    return JSON.parse(Buffer.from(raw).toString('utf8')) as unknown
  } catch (err) {
    if (!signal?.aborted) log.debug('[coverMatch][qq] request failed', err)
    return null
  }
}

export const search = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.CoverMatch.CoverCandidate[]> => {
  const startedAt = Date.now()
  for (const keyword of query.variants.slice(0, MAX_KEYWORDS)) {
    if (signal?.aborted) return []
    const json = await requestSearch(keyword, signal)
    if (!json) continue
    const candidates = parseSearchResponse(json)
    if (!candidates.length) continue
    log.debug('[coverMatch][qq] search done', {
      cost: Date.now() - startedAt,
      count: candidates.length,
    })
    return candidates
  }
  log.debug('[coverMatch][qq] search empty', { cost: Date.now() - startedAt })
  return []
}

export default {
  id: 'qq' as const,
  search,
}
