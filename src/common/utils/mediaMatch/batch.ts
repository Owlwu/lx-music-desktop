import { getMissingFlags } from './fileState'
import type { MissingFlags } from './fileState'

/**
 * 一键补全缺失歌词/封面的批次编排（纯逻辑，不依赖 Vue/Electron）
 *
 * 由渲染层 `views/List/MusicList/useBatchMatch.js` 注入 IPC/文件状态/刷新回调；
 * 单测直接注入假依赖，覆盖扫描真值表、自动选择顺序、限速与取消。
 */

export type BatchMatchPhase = 'idle' | 'scanning' | 'matching' | 'done'

export interface BatchMatchProgress {
  phase: BatchMatchPhase
  current: number
  total: number
  name: string
  lyric: number
  cover: number
  failed: number
  skipped: number
  /**
   * 已处理（完成补全阶段单曲循环）的歌曲数；取消汇总用
   */
  processed: number
  canceled: boolean
  none: boolean
}

export interface BatchMatchSummary extends Omit<BatchMatchProgress, 'phase' | 'current' | 'total' | 'name'> {
  totalLocal: number
  pending: number
  noLocal: boolean
}

export interface BatchMatchDeps {
  getListMusics: (listId: string) => Promise<LX.Music.MusicInfo[]>
  getFileState: (filePath: string) => Promise<LX.MediaMatch.FileState | null | undefined>
  searchLyricCandidates: (musicInfo: LX.Music.MusicInfo) => Promise<LX.MediaMatch.LyricsCandidate[]>
  getCandidateLyric: (candidate: LX.MediaMatch.LyricsCandidate) => Promise<LX.MediaMatch.LyricResult | null | undefined>
  applyLyric: (musicInfo: LX.Music.MusicInfo, candidate: LX.MediaMatch.LyricsCandidate) => Promise<unknown>
  searchCoverCandidates: (musicInfo: LX.Music.MusicInfo) => Promise<LX.CoverMatch.CoverCandidate[]>
  applyCover: (musicInfo: LX.Music.MusicInfo, candidate: LX.CoverMatch.CoverCandidate) => Promise<unknown>
  /**
   * 歌词写入成功后：持久化 `meta.lyricSource='lrc'` + 刷新当前播放歌词
   */
  onLyricApplied?: (musicInfo: LX.Music.MusicInfo) => Promise<void> | void
  /**
   * 封面写入成功后：刷新当前播放封面
   */
  onCoverApplied?: (musicInfo: LX.Music.MusicInfo) => Promise<void> | void
  onProgress?: (progress: BatchMatchProgress) => void
  onError?: (err: unknown, context: string) => void
  sleep?: (ms: number) => Promise<void>
  /**
   * 每首之间的间隔（ms），默认 200
   */
  intervalMs?: number
}

/**
 * 歌词无有效结果时，沿排序最多再试 4 个候选
 */
export const MAX_LYRIC_FALLBACK = 4
/**
 * 封面下载/写入失败时，最多再试后续 2 个候选
 */
export const MAX_COVER_FALLBACK = 2
/**
 * 歌词回退候选的最低分
 */
export const MIN_LYRIC_SCORE = 0.6
/**
 * 每首之间的默认间隔（ms）
 */
export const DEFAULT_BATCH_INTERVAL = 200

const defaultSleep = async(ms: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms)
})

export const isLocalMusicInfo = (musicInfo: LX.Music.MusicInfo | null | undefined): musicInfo is LX.Music.MusicInfo => {
  return !!musicInfo && musicInfo.source === 'local' && !!musicInfo.meta?.filePath
}

/**
 * 统计当前列表中的本地歌曲数（确认框/空列表判断用）
 */
export const countLocalMusics = (musics: LX.Music.MusicInfo[] | null | undefined): number => {
  if (!Array.isArray(musics)) return 0
  return musics.filter(isLocalMusicInfo).length
}

/**
 * 构造可 structured clone 的普通歌曲对象（Vue 响应式 Proxy 跨 IPC 会抛 clone 错误）
 */
export const toPlainMusicInfo = (musicInfo: LX.Music.MusicInfo | null | undefined): LX.Music.MusicInfo | null => {
  if (!musicInfo) return null
  return {
    id: musicInfo.id,
    name: musicInfo.name,
    singer: musicInfo.singer,
    source: musicInfo.source,
    interval: musicInfo.interval,
    meta: { ...musicInfo.meta },
  }
}

/**
 * 构造可 structured clone 的普通候选对象（只带主进程需要的字段）
 */
export const toPlainLyricCandidate = (candidate: LX.MediaMatch.LyricsCandidate): LX.MediaMatch.LyricsCandidate => ({
  source: candidate.source,
  id: candidate.id,
  name: candidate.name,
  singer: candidate.singer,
  albumName: candidate.albumName,
  durationSec: candidate.durationSec,
  hasSynced: candidate.hasSynced,
  instrumental: candidate.instrumental,
  score: candidate.score,
  trackId: candidate.trackId,
  hasWordSync: candidate.hasWordSync,
})

export const toPlainCoverCandidate = (candidate: LX.CoverMatch.CoverCandidate): LX.CoverMatch.CoverCandidate => ({
  source: candidate.source,
  id: candidate.id,
  name: candidate.name,
  singer: candidate.singer,
  albumName: candidate.albumName,
  durationSec: candidate.durationSec,
  coverUrl: candidate.coverUrl,
  thumbnailUrl: candidate.thumbnailUrl,
  score: candidate.score,
})

/**
 * 歌词尝试顺序：第 1 个必试；其余只在 `start+1..start+4` 内挑非 instrumental 且 `score >= 0.6`
 */
export const getLyricCandidateIndexes = (
  candidates: Array<Pick<LX.MediaMatch.LyricsCandidate, 'instrumental' | 'score'>> | null | undefined,
  startIndex = 0,
): number[] => {
  if (!Array.isArray(candidates) || !candidates.length) return []
  const start = Number.isInteger(startIndex) && startIndex > 0 ? Math.min(startIndex, candidates.length - 1) : 0
  const order = [start]
  const maxIndex = Math.min(start + MAX_LYRIC_FALLBACK, candidates.length - 1)
  for (let index = start + 1; index <= maxIndex; index++) {
    const candidate = candidates[index]
    if (!candidate || candidate.instrumental) continue
    if (typeof candidate.score === 'number' && candidate.score >= MIN_LYRIC_SCORE) order.push(index)
  }
  return order
}

/**
 * 封面尝试顺序：第 1 个必试，失败按排序再试后续 2 个
 */
export const getCoverCandidateIndexes = (
  candidates: unknown[] | null | undefined,
  startIndex = 0,
): number[] => {
  if (!Array.isArray(candidates) || !candidates.length) return []
  const start = Number.isInteger(startIndex) && startIndex > 0 ? Math.min(startIndex, candidates.length - 1) : 0
  const order: number[] = []
  const maxIndex = Math.min(start + MAX_COVER_FALLBACK, candidates.length - 1)
  for (let index = start; index <= maxIndex; index++) order.push(index)
  return order
}

/**
 * 歌词是否可用：占位/纯音乐/接口失败通常返回空串或 null
 */
export const isUsableLyricResult = (result: LX.MediaMatch.LyricResult | null | undefined): boolean => {
  return typeof result?.lyric === 'string' && !!result.lyric.trim()
}

const matchLyric = async(musicInfo: LX.Music.MusicInfo, deps: BatchMatchDeps): Promise<boolean> => {
  const candidates = await deps.searchLyricCandidates(musicInfo)
  for (const index of getLyricCandidateIndexes(candidates)) {
    const candidate = candidates[index]
    if (!candidate) continue

    let result: LX.MediaMatch.LyricResult | null | undefined
    try {
      result = await deps.getCandidateLyric(candidate)
    } catch (err) {
      deps.onError?.(err, 'get_candidate_lyric')
      continue
    }
    if (!isUsableLyricResult(result)) continue

    try {
      await deps.applyLyric(musicInfo, candidate)
    } catch (err) {
      // 该候选写入失败（网络/目录权限等）：按顺序尝试下一个可用候选
      deps.onError?.(err, 'apply_lyric')
      continue
    }

    try {
      await deps.onLyricApplied?.(musicInfo)
    } catch (err) {
      // 文件已经写入成功，后续刷新失败不应把歌词计为失败
      deps.onError?.(err, 'on_lyric_applied')
    }
    return true
  }
  return false
}

const matchCover = async(musicInfo: LX.Music.MusicInfo, deps: BatchMatchDeps): Promise<boolean> => {
  const candidates = await deps.searchCoverCandidates(musicInfo)
  for (const index of getCoverCandidateIndexes(candidates)) {
    const candidate = candidates[index]
    if (!candidate) continue
    try {
      await deps.applyCover(musicInfo, candidate)
    } catch (err) {
      deps.onError?.(err, 'apply_cover')
      continue
    }
    try {
      await deps.onCoverApplied?.(musicInfo)
    } catch (err) {
      deps.onError?.(err, 'on_cover_applied')
    }
    return true
  }
  return false
}

export interface BatchMatcher {
  run: (listId: string) => Promise<BatchMatchSummary>
  cancel: () => void
  isCanceled: () => boolean
}

export const createBatchMatcher = (deps: BatchMatchDeps): BatchMatcher => {
  let canceled = false
  const state = { running: false }
  const intervalMs = deps.intervalMs ?? DEFAULT_BATCH_INTERVAL
  const sleep = deps.sleep ?? defaultSleep

  const createSummary = (): BatchMatchSummary => ({
    totalLocal: 0,
    pending: 0,
    lyric: 0,
    cover: 0,
    failed: 0,
    skipped: 0,
    processed: 0,
    canceled: false,
    none: false,
    noLocal: false,
  })

  const run = async(listId: string): Promise<BatchMatchSummary> => {
    if (state.running) throw new Error('batch match is already running')
    state.running = true
    canceled = false
    const summary = createSummary()

    const emitProgress = (phase: BatchMatchPhase, current: number, total: number, name: string) => {
      deps.onProgress?.({
        phase,
        current,
        total,
        name,
        lyric: summary.lyric,
        cover: summary.cover,
        failed: summary.failed,
        skipped: summary.skipped,
        processed: summary.processed,
        canceled: summary.canceled,
        none: summary.none,
      })
    }

    try {
      const musics = await deps.getListMusics(listId)
      const localMusics = (Array.isArray(musics) ? musics : []).filter(isLocalMusicInfo)
      summary.totalLocal = localMusics.length
      if (!localMusics.length) {
        summary.noLocal = true
        return summary
      }

      // 扫描阶段：逐首检查内嵌/同目录文件，只留下确实缺失的歌曲
      const tasks: Array<{ musicInfo: LX.Music.MusicInfo, flags: MissingFlags }> = []
      for (let index = 0; index < localMusics.length; index++) {
        if (canceled) {
          summary.canceled = true
          break
        }
        const musicInfo = localMusics[index]
        emitProgress('scanning', index + 1, localMusics.length, musicInfo.name)

        let state: LX.MediaMatch.FileState | null | undefined
        let readFailed = false
        try {
          state = await deps.getFileState(musicInfo.meta.filePath)
        } catch (err) {
          deps.onError?.(err, 'get_file_state')
          readFailed = true
        }
        if (readFailed) {
          summary.failed++
          continue
        }
        // 本地文件不存在按 skipped（不是失败），避免坏路径污染失败数
        if (!state?.fileExists) {
          summary.skipped++
          continue
        }
        const flags = getMissingFlags(state)
        if (flags.missing) tasks.push({ musicInfo, flags })
      }

      summary.pending = tasks.length
      if (canceled) summary.canceled = true
      else if (!tasks.length) summary.none = true

      // 补全阶段：串行逐首处理，取消后不再开始新歌曲（当前歌曲做完再收尾）
      if (!summary.canceled && tasks.length) {
        for (let index = 0; index < tasks.length; index++) {
          if (canceled) {
            summary.canceled = true
            break
          }
          const { musicInfo, flags } = tasks[index]
          emitProgress('matching', index + 1, tasks.length, musicInfo.name)

          let failedThisSong = false
          if (flags.missingLyric) {
            let ok = false
            try {
              ok = await matchLyric(musicInfo, deps)
            } catch (err) {
              deps.onError?.(err, 'match_lyric')
            }
            if (ok) summary.lyric++
            else failedThisSong = true
          }
          if (flags.missingCover) {
            let ok = false
            try {
              ok = await matchCover(musicInfo, deps)
            } catch (err) {
              deps.onError?.(err, 'match_cover')
            }
            if (ok) summary.cover++
            else failedThisSong = true
          }
          if (failedThisSong) summary.failed++
          summary.processed++

          if (index < tasks.length - 1 && !canceled) await sleep(intervalMs)
        }
        if (canceled) summary.canceled = true
        if (!summary.processed) summary.none = true
      }

      return summary
    } finally {
      state.running = false
      emitProgress('done', summary.pending, summary.pending, '')
    }
  }

  return {
    run,
    cancel: () => {
      canceled = true
    },
    isCanceled: () => canceled,
  }
}
