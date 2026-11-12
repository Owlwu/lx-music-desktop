import { log } from '@common/utils'
import { createKeywordQuery, createMatchQuery } from '@common/utils/mediaMatch/query'
import { rankCandidates } from '@common/utils/mediaMatch/score'
import lrclib from './providers/lrclib'
import qq, { getWordSync as getQqWordSync } from './providers/qq'

// 源启用顺序固定：lrclib -> qq；单源失败自动跳过
const providers: LX.MediaMatch.LyricsProvider[] = [lrclib, qq]

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
  const results = await Promise.allSettled(providers.map(async provider => await provider.search(query, signal)))
  const candidates: LX.MediaMatch.LyricsCandidate[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') candidates.push(...result.value)
    else log.debug('[mediaMatch] provider failed', providers[index].id, result.reason)
  })
  const ranked = rankCandidates(query, candidates)
  log.debug('[mediaMatch] search aggregated', {
    cost: Date.now() - startedAt,
    total: candidates.length,
    returned: ranked.length,
  })
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
