import { log } from '@common/utils'
import { request } from '@common/utils/request'

/**
 * iTunes 封面源（回退源）
 *
 * - CJK 查询用 `country=jp`，否则 `us`；0 结果时换另一 store 重试一次
 * - 用 `artworkUrl100` 把 `100x100bb` 换成 `600x600bb` 作为大图
 * - 按 collectionId 去重（在 rankCoverCandidates 里统一处理）
 */

const SEARCH_URL = 'https://itunes.apple.com/search'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT = 10000
const REQUEST_INTERVAL = 300
const MAX_BODY_SIZE = 4 * 1024 * 1024
const MAX_KEYWORDS = 2
const LIMIT = 15

const cjkRxp = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

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
 * 歌名/歌手/专辑含 CJK 字符时用日本 store（华语曲目在 jp 命中率明显更高，cn store 常为 0）
 */
export const getItunesStore = (query: LX.MediaMatch.MatchQuery): 'jp' | 'us' => {
  return cjkRxp.test([query.name, query.singer, query.albumName].join(' ')) ? 'jp' : 'us'
}

export const buildItunesCoverUrl = (artworkUrl100: string): string => {
  return artworkUrl100.replace('100x100bb', '600x600bb')
}

const parseSearchResponse = (json: unknown): LX.CoverMatch.CoverCandidate[] => {
  if (!isRecord(json) || !Array.isArray(json.results)) return []

  const candidates: LX.CoverMatch.CoverCandidate[] = []
  for (const item of json.results) {
    if (!isRecord(item)) continue
    const collectionId = toNumber(item.collectionId)?.toString() ?? ''
    const artworkUrl100 = asString(item.artworkUrl100).trim()
    const name = asString(item.trackName).trim()
    if (!collectionId || !artworkUrl100 || !name) continue
    const trackTimeMillis = toNumber(item.trackTimeMillis)
    candidates.push({
      source: 'itunes',
      id: collectionId,
      name,
      singer: asString(item.artistName).trim(),
      albumName: asString(item.collectionName).trim(),
      durationSec: trackTimeMillis == null ? null : trackTimeMillis / 1000,
      coverUrl: buildItunesCoverUrl(artworkUrl100),
      thumbnailUrl: artworkUrl100,
      score: 0,
    })
  }
  return candidates
}

const requestSearch = async(
  keyword: string,
  country: 'jp' | 'us',
  signal?: AbortSignal,
): Promise<unknown | null> => {
  if (signal?.aborted) return null
  await waitInterval()
  if (signal?.aborted) return null
  try {
    const response = await request(SEARCH_URL, {
      query: {
        term: keyword,
        entity: 'song',
        limit: LIMIT,
        country,
      },
      timeout: REQUEST_TIMEOUT,
      signal,
      needRaw: true,
      retryNum: 0,
      headers: { 'User-Agent': UA },
    })
    if (response.statusCode !== 200) {
      log.debug('[coverMatch][itunes] unexpected status', response.statusCode)
      return null
    }
    const raw = response.raw
    if (!raw?.byteLength || raw.byteLength > MAX_BODY_SIZE) {
      log.debug('[coverMatch][itunes] response too large or empty', raw?.byteLength ?? 0)
      return null
    }
    return JSON.parse(Buffer.from(raw).toString('utf8')) as unknown
  } catch (err) {
    if (!signal?.aborted) log.debug('[coverMatch][itunes] request failed', err)
    return null
  }
}

const searchStore = async(
  keyword: string,
  country: 'jp' | 'us',
  signal?: AbortSignal,
): Promise<LX.CoverMatch.CoverCandidate[]> => {
  const json = await requestSearch(keyword, country, signal)
  return json ? parseSearchResponse(json) : []
}

export const search = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.CoverMatch.CoverCandidate[]> => {
  const startedAt = Date.now()
  const preferredStore = getItunesStore(query)
  for (const keyword of query.variants.slice(0, MAX_KEYWORDS)) {
    if (signal?.aborted) return []
    let candidates = await searchStore(keyword, preferredStore, signal)
    if (!candidates.length) {
      // 0 结果时换另一 store 重试一次
      const fallbackStore = preferredStore === 'jp' ? 'us' : 'jp'
      candidates = await searchStore(keyword, fallbackStore, signal)
    }
    if (!candidates.length) continue
    log.debug('[coverMatch][itunes] search done', {
      cost: Date.now() - startedAt,
      count: candidates.length,
      store: preferredStore,
    })
    return candidates
  }
  log.debug('[coverMatch][itunes] search empty', { cost: Date.now() - startedAt })
  return []
}

export default {
  id: 'itunes' as const,
  search,
}
