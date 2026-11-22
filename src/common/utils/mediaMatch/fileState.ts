import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * 单曲歌词/封面存在性判定（主进程与批次补全共用）
 *
 * - 同目录歌词：`.lrc/.LRC/.krc/.KRC`，封面：`.jpg/.png`，只认 >0 字节文件（空文件按不存在）
 * - 内嵌：`common.lyrics`（M4A `©lyr` 等）+ native `LYRICS`/`USLT`；封面 `common.picture`
 * - 同目录歌词与封面都已存在时跳过 `music-metadata` 解析（性能）
 * - 解析失败（损坏/无权限）按「无内嵌」处理，不抛错中断批次
 */

/**
 * 只声明判定所需的最小元数据结构，避免共享层依赖 `music-metadata` 的具体类型
 * （`music-metadata` 的 `IAudioMetadata` 结构上兼容）
 */
export interface AudioMetadataLike {
  common?: {
    lyrics?: Array<{
      text?: string
      syncText?: Array<{ text?: string }>
    }>
    picture?: unknown[]
  }
  native?: Record<string, Array<{ id?: string, value?: unknown }>>
}

export type AudioMetadataParser = (filePath: string) => Promise<AudioMetadataLike>

export interface FileStateDeps {
  /**
   * music-metadata 解析器；未传时只判定同目录文件（测试/纯统计用）
   */
  parseAudioMetadata?: AudioMetadataParser
  /**
   * 解析失败回调（主进程用于写 debug 日志）；失败本身不抛出
   */
  onParseError?: (err: unknown) => void
}

export interface MissingFlags {
  missingLyric: boolean
  missingCover: boolean
  /**
   * 歌词或封面任意一项缺失
   */
  missing: boolean
}

const SIDECAR_LYRIC_EXTS = ['.lrc', '.LRC', '.krc', '.KRC']
const SIDECAR_COVER_EXTS = ['.jpg', '.png']

/**
 * 内嵌歌词最小长度（与播放链路 `getLocalMusicFileEmbeddedLyric` 的 native 判定保持一致）
 */
export const MIN_EMBEDDED_LYRIC_LENGTH = 10

export const createEmptyFileState = (): LX.MediaMatch.FileState => ({
  fileExists: false,
  hasEmbeddedLyric: false,
  hasSidecarLyric: false,
  hasEmbeddedCover: false,
  hasSidecarCover: false,
})

/**
 * 由音频路径推导同目录同名路径（保留原目录与文件名，只换扩展名）
 */
export const getAudioStem = (filePath: string): string => {
  const ext = path.extname(filePath)
  return ext ? filePath.slice(0, filePath.length - ext.length) : filePath
}

export const getSidecarLyricPaths = (filePath: string): string[] => {
  const stem = getAudioStem(filePath)
  return SIDECAR_LYRIC_EXTS.map(ext => stem + ext)
}

export const getSidecarCoverPaths = (filePath: string): string[] => {
  const stem = getAudioStem(filePath)
  return SIDECAR_COVER_EXTS.map(ext => stem + ext)
}

const statOrNull = async(filePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> => {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}

const isNonEmptyFile = async(filePath: string): Promise<boolean> => {
  const stats = await statOrNull(filePath)
  return !!stats?.isFile() && stats.size > 0
}

const readLyricTagText = (value: unknown): string => {
  if (typeof value === 'string') return value
  const text = (value as { text?: unknown } | null | undefined)?.text
  return typeof text === 'string' ? text : ''
}

const getNativeTags = (metadata: AudioMetadataLike | null | undefined): Array<{ id?: string, value?: unknown }> => {
  const native = metadata?.native
  if (!native || typeof native !== 'object') return []
  const tags: Array<{ id?: string, value?: unknown }> = []
  for (const list of Object.values(native)) {
    if (Array.isArray(list)) tags.push(...list)
  }
  return tags
}

/**
 * 内嵌歌词判定：
 * - `common.lyrics`（含 `syncText`）trim 后非空即算，覆盖 M4A `©lyr` 等常见内嵌歌词
 * - native `LYRICS` / `USLT` 与既有播放链路一致，要求 >10 字符，避免把短标签当歌词
 */
export const hasEmbeddedLyricMetadata = (metadata: AudioMetadataLike | null | undefined): boolean => {
  const commonLyrics = metadata?.common?.lyrics
  if (Array.isArray(commonLyrics)) {
    for (const lyric of commonLyrics) {
      if (typeof lyric?.text === 'string' && !!lyric.text.trim()) return true
      if (Array.isArray(lyric?.syncText) && lyric.syncText.some(item => typeof item?.text === 'string' && !!item.text.trim())) return true
    }
  }

  for (const tag of getNativeTags(metadata)) {
    if (tag.id !== 'LYRICS' && tag.id !== 'USLT') continue
    if (readLyricTagText(tag.value).trim().length > MIN_EMBEDDED_LYRIC_LENGTH) return true
  }
  return false
}

/**
 * 内嵌封面判定：`common.picture` 非空即可（music-metadata 已过滤无法解析的图片）
 */
export const hasEmbeddedCoverMetadata = (metadata: AudioMetadataLike | null | undefined): boolean => {
  const pictures = metadata?.common?.picture
  return Array.isArray(pictures) && pictures.length > 0
}

/**
 * 同目录歌词与封面都已存在时无需再解析音频（性能）
 */
export const shouldParseAudioMetadata = (hasSidecarLyric: boolean, hasSidecarCover: boolean): boolean => {
  return !(hasSidecarLyric && hasSidecarCover)
}

/**
 * 缺失判定真值表：内嵌或独立文件任一存在即不算缺失；空文件已在上游按不存在处理
 */
export const getMissingFlags = (state: Pick<LX.MediaMatch.FileState, 'hasEmbeddedLyric' | 'hasSidecarLyric' | 'hasEmbeddedCover' | 'hasSidecarCover'> | null | undefined): MissingFlags => {
  const hasLyric = !!state?.hasEmbeddedLyric || !!state?.hasSidecarLyric
  const hasCover = !!state?.hasEmbeddedCover || !!state?.hasSidecarCover
  return {
    missingLyric: !hasLyric,
    missingCover: !hasCover,
    missing: !hasLyric || !hasCover,
  }
}

/**
 * 读取单曲文件状态（主进程 IPC `media_match_get_file_state` 的实现主体）
 */
export const getFileState = async(filePath: string, deps: FileStateDeps = {}): Promise<LX.MediaMatch.FileState> => {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return createEmptyFileState()

  const audioStats = await statOrNull(filePath)
  if (!audioStats?.isFile()) return createEmptyFileState()

  const [lyricPaths, coverPaths] = [getSidecarLyricPaths(filePath), getSidecarCoverPaths(filePath)]
  const [lyricFlags, coverFlags] = await Promise.all([
    Promise.all(lyricPaths.map(isNonEmptyFile)),
    Promise.all(coverPaths.map(isNonEmptyFile)),
  ])

  const state: LX.MediaMatch.FileState = {
    fileExists: true,
    hasEmbeddedLyric: false,
    hasSidecarLyric: lyricFlags.some(Boolean),
    hasEmbeddedCover: false,
    hasSidecarCover: coverFlags.some(Boolean),
  }

  if (!shouldParseAudioMetadata(state.hasSidecarLyric, state.hasSidecarCover) || !deps.parseAudioMetadata) return state

  try {
    const metadata = await deps.parseAudioMetadata(filePath)
    state.hasEmbeddedLyric = hasEmbeddedLyricMetadata(metadata)
    state.hasEmbeddedCover = hasEmbeddedCoverMetadata(metadata)
  } catch (err) {
    // 损坏/无权限文件按「无内嵌」处理：绝不抛出打断整批扫描
    deps.onParseError?.(err)
  }
  return state
}
