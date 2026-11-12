import { log } from '@common/utils'
import { createKeywordQuery, createMatchQuery } from '@common/utils/mediaMatch/query'
import { rankCoverCandidates } from '@common/utils/coverMatch/score'
import { request } from '@common/utils/request'
import { MAX_IMAGE_BYTES } from './coverFile'
import itunes from './providers/itunes'
import qq from './providers/qq'

const providers: Array<{ id: LX.CoverMatch.CoverSource, search: (query: LX.MediaMatch.MatchQuery, signal?: AbortSignal) => Promise<LX.CoverMatch.CoverCandidate[]> }> = [qq, itunes]

const DOWNLOAD_TIMEOUT = 10000
const DOWNLOAD_RETRY = 1
const DOWNLOAD_RETRY_DELAY = 300
const DOWNLOAD_CACHE_LIMIT = 10
const MAX_RESULT_COUNT = 20

export type CoverMatchErrorCode = 'download_failed' | 'image_too_large'

export class CoverMatchError extends Error {
  code: CoverMatchErrorCode

  constructor(code: CoverMatchErrorCode, message: string) {
    super(message)
    this.name = 'CoverMatchError'
    this.code = code
  }
}

const downloadCache = new Map<string, Uint8Array>()

const cacheGet = (url: string): Uint8Array | undefined => {
  const cached = downloadCache.get(url)
  if (!cached) return undefined
  // LRU：命中的条目移到队尾
  downloadCache.delete(url)
  downloadCache.set(url, cached)
  return cached
}

const cachePut = (url: string, data: Uint8Array): void => {
  if (downloadCache.has(url)) downloadCache.delete(url)
  downloadCache.set(url, data)
  while (downloadCache.size > DOWNLOAD_CACHE_LIMIT) {
    const first = downloadCache.keys().next().value
    if (first == null) break
    downloadCache.delete(first)
  }
}

const sleep = async(ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms)
})

export const createQuery = (
  musicInfo: LX.Music.MusicInfo,
  keyword?: string,
): LX.MediaMatch.MatchQuery => {
  const trimmedKeyword = keyword?.trim()
  return trimmedKeyword ? createKeywordQuery(trimmedKeyword, musicInfo) : createMatchQuery(musicInfo)
}

/**
 * 两源并行搜索；单源失败静默跳过，统一评分/专辑去重/截断
 */
export const searchCandidates = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.CoverMatch.CoverCandidate[]> => {
  const startedAt = Date.now()
  const results = await Promise.allSettled(providers.map(async provider => await provider.search(query, signal)))
  const candidates: LX.CoverMatch.CoverCandidate[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') candidates.push(...result.value)
    else log.debug('[coverMatch] provider failed', providers[index].id, result.reason)
  })
  const ranked = rankCoverCandidates(query, candidates, MAX_RESULT_COUNT)
  log.debug('[coverMatch] search aggregated', {
    cost: Date.now() - startedAt,
    total: candidates.length,
    returned: ranked.length,
  })
  return ranked
}

const normalizeContentType = (contentType: string | undefined): string => {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

const isSupportedContentType = (contentType: string): boolean => {
  // QQ 有时返回 image/jpg；只接受 jpeg/png，webp 一律拒绝
  return /^image\/(?:jpe?g|png)$/.test(contentType)
}

const downloadOnce = async(url: string, signal?: AbortSignal): Promise<Uint8Array> => {
  const response = await request(url, {
    timeout: DOWNLOAD_TIMEOUT,
    signal,
    needRaw: true,
    maxRedirect: 4,
    // 重试由本函数控制，避免 undici 内建重试叠加
    retryNum: 0,
    headers: { Accept: 'image/jpeg,image/png' },
  })
  if (response.statusCode !== 200) {
    throw new CoverMatchError('download_failed', `unexpected status: ${response.statusCode}`)
  }
  const contentType = normalizeContentType(response.headers['content-type'])
  if (!isSupportedContentType(contentType)) {
    throw new CoverMatchError('download_failed', `unexpected content type: ${contentType || 'unknown'}`)
  }
  const raw = response.raw
  if (!raw?.byteLength) throw new CoverMatchError('download_failed', 'empty image body')
  if (raw.byteLength > MAX_IMAGE_BYTES) throw new CoverMatchError('image_too_large', 'image body too large')
  return raw
}

/**
 * 主进程下载封面（10s 超时、≤8MB、最多 1 次重试），按 URL 做 10 条 LRU 缓存
 */
export const downloadCoverImage = async(url: string, signal?: AbortSignal): Promise<Uint8Array> => {
  const cached = cacheGet(url)
  if (cached) return cached

  let lastError: unknown = null
  for (let attempt = 0; attempt <= DOWNLOAD_RETRY; attempt++) {
    if (signal?.aborted) throw new CoverMatchError('download_failed', 'aborted')
    try {
      const data = await downloadOnce(url, signal)
      cachePut(url, data)
      return data
    } catch (err) {
      lastError = err
      // 体积超限是确定性错误，不重试
      if (err instanceof CoverMatchError && err.code === 'image_too_large') throw err
      if (attempt < DOWNLOAD_RETRY) await sleep(DOWNLOAD_RETRY_DELAY)
    }
  }
  log.debug('[coverMatch] download failed', url, lastError)
  if (lastError instanceof CoverMatchError) throw lastError
  throw new CoverMatchError('download_failed', lastError instanceof Error ? lastError.message : String(lastError))
}
