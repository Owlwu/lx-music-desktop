import { log } from '@common/utils'
import { createKeywordQuery, createMatchQuery } from '@common/utils/mediaMatch/query'
import { rankCandidates } from '@common/utils/mediaMatch/score'
import { mediaMatchError } from './errors'
import lrclib from './providers/lrclib'
import qq, { getWordSync as getQqWordSync } from './providers/qq'
import netease from './providers/netease'

// 源启用顺序固定：lrclib -> qq -> netease（netease 额外提供翻译/罗马音）；单源失败自动跳过
const providers: LX.MediaMatch.LyricsProvider[] = [lrclib, qq, netease]

// 单源预算：慢源到点即中止，避免并行后仍被最慢的源拖住（原实现要等 allSettled 全部完成）
const SOURCE_TIMEOUT = 6000

interface SourceOutcome {
  candidates: LX.MediaMatch.LyricsCandidate[]
  failed: boolean
}

/**
 * 带单源超时的搜索：超时、异常都归为「该源失败」，不影响其他源已经拿到的候选
 */
const searchSource = async(
  provider: LX.MediaMatch.LyricsProvider,
  query: LX.MediaMatch.MatchQuery,
  parentSignal?: AbortSignal,
): Promise<SourceOutcome> => {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, SOURCE_TIMEOUT)
  const handleAbort = () => { controller.abort() }
  if (parentSignal?.aborted) handleAbort()
  else parentSignal?.addEventListener('abort', handleAbort)

  const startedAt = Date.now()
  try {
    const candidates = await provider.search(query, controller.signal)
    // 源在超时点被中止时可能返回半成品：空结果按失败处理，避免「超时」被当成「没匹配到」
    if (timedOut && !candidates.length) throw new Error('source timeout')
    log.debug('[mediaMatch] provider done', {
      source: provider.id,
      cost: Date.now() - startedAt,
      count: candidates.length,
    })
    return { candidates, failed: false }
  } catch (err) {
    log.debug('[mediaMatch] provider failed', provider.id, err)
    return { candidates: [], failed: true }
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', handleAbort)
  }
}

export const createQuery = (
  musicInfo: LX.Music.MusicInfo,
  keyword?: string,
): LX.MediaMatch.MatchQuery => {
  const trimmedKeyword = keyword?.trim()
  return trimmedKeyword ? createKeywordQuery(trimmedKeyword, musicInfo) : createMatchQuery(musicInfo)
}

export const searchCandidates = async(
  query: LX.MediaMatch.MatchQuery,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricsCandidate[]> => {
  const startedAt = Date.now()
  // 各源并行 + 单源超时：慢源不再拖住整体（原实现等 allSettled，总耗时由最慢的源决定）
  const outcomes = await Promise.all(providers.map(async provider => await searchSource(provider, query, signal)))
  const candidates: LX.MediaMatch.LyricsCandidate[] = []
  for (const outcome of outcomes) candidates.push(...outcome.candidates)
  const ranked = rankCandidates(query, candidates)
  log.debug('[mediaMatch] search aggregated', {
    cost: Date.now() - startedAt,
    total: candidates.length,
    returned: ranked.length,
    failed: outcomes.filter(outcome => outcome.failed).length,
  })
  // 渲染进程关闭弹窗时静默返回空结果（调用方会丢弃本轮结果）
  if (signal?.aborted) return ranked
  // 全部/部分源失败且 0 条：抛错让 UI 显示可重试的错误，否则网络失败会被当成「没匹配到」
  if (!ranked.length && outcomes.some(outcome => outcome.failed)) throw mediaMatchError('search_failed')
  return ranked
}

export const getCandidateLyric = async(
  candidate: LX.MediaMatch.LyricsCandidate,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.LyricResult | null> => {
  const provider = providers.find(item => item.id === candidate.source)
  if (!provider) return null
  try {
    return await provider.getLyric(candidate, signal)
  } catch (err) {
    log.debug('[mediaMatch] get lyric failed', candidate.source, err)
    return null
  }
}

/**
 * 取候选的逐字数据（目前只有 QQ 提供；其他源/失败返回 null，调用方静默降级行级）
 */
export const getCandidateWordSync = async(
  candidate: LX.MediaMatch.LyricsCandidate,
  signal?: AbortSignal,
): Promise<LX.MediaMatch.WordSyncResult | null> => {
  if (candidate.source !== 'qq') return null
  try {
    return await getQqWordSync(candidate, signal)
  } catch (err) {
    log.debug('[mediaMatch] get word sync failed', candidate.source, err)
    return null
  }
}
