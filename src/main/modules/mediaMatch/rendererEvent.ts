import { MEDIA_MATCH_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { buildExtendedLrcText, buildLrcText, sanitizeExtendedLyric } from '@common/utils/mediaMatch/lrcText'
import { buildAwlrcLrcText } from '@common/utils/mediaMatch/qrcLyric'
import { checkPath } from '@common/utils/nodejs'
import { log } from '@common/utils'
import { mediaMatchError } from './errors'
import { getFileState } from './fileState'
import { createQuery, getCandidateLyric, getCandidateWordSync, searchCandidates } from './matcher'
import { applyLrc, getLrcState, LrcFileError, rollbackLrc } from './lrcFile'

const SEARCH_TIMEOUT = 15000
const lrcFileErrorPrefix = 'MEDIA_MATCH_LRC_ERR:'

const toIpcError = (err: unknown, prefix: string): Error => {
  if (err instanceof LrcFileError) return new Error(prefix + err.code)
  return err instanceof Error ? err : new Error(prefix + 'unknown')
}

const assertMusicInfo = async(musicInfo: LX.Music.MusicInfo | null | undefined): Promise<LX.Music.MusicInfo> => {
  if (!musicInfo || musicInfo.source !== 'local' || !musicInfo.meta?.filePath) {
    throw mediaMatchError('invalid_music')
  }
  if (!await checkPath(musicInfo.meta.filePath)) {
    throw mediaMatchError('file_not_found')
  }
  return musicInfo
}

const assertFileExist = async(filePath: string): Promise<void> => {
  if (!filePath || !await checkPath(filePath)) throw mediaMatchError('file_not_found')
}

const assertCandidate = (candidate: LX.MediaMatch.LyricsCandidate | null | undefined): LX.MediaMatch.LyricsCandidate => {
  if (!candidate?.id || (candidate.source !== 'lrclib' && candidate.source !== 'qq' && candidate.source !== 'netease')) {
    throw mediaMatchError('invalid_candidate')
  }
  return candidate
}

const applyLyricFile = async(
  musicInfo: LX.Music.MusicInfo,
  candidate: LX.MediaMatch.LyricsCandidate,
): Promise<LX.MediaMatch.ApplyResult> => {
  // QQ 候选先尝试逐字：成功且可用 → 正文用 QRC 转出的行级歌词，并追加 [awlrc:]
  // 逐字路径不合并翻译/罗马音：QRC 时间轴与第三方行级翻译可能错位，保持二期行为不变。
  const wordSync = candidate.source === 'qq' ? await getCandidateWordSync(candidate) : null
  if (wordSync?.lyric.trim() && wordSync.lxlyric.trim()) {
    const body = buildLrcText({
      name: musicInfo.name,
      singer: musicInfo.singer,
      albumName: musicInfo.meta.albumName,
      lyric: wordSync.lyric,
      isSynced: true,
    })
    if (!body) throw mediaMatchError('no_lyric')
    try {
      const result = await applyLrc(musicInfo.meta.filePath, buildAwlrcLrcText(body, wordSync.lxlyric))
      return { ...result, hasWordSync: true }
    } catch (err) {
      throw toIpcError(err, lrcFileErrorPrefix)
    }
  }

  // 一期逻辑（无逐字 / 逐字失败时完全不变）
  const lyricResult = await getCandidateLyric(candidate)
  if (!lyricResult?.lyric.trim()) throw mediaMatchError('no_lyric')

  const text = buildLrcText({
    name: musicInfo.name,
    singer: musicInfo.singer,
    albumName: musicInfo.meta.albumName,
    lyric: lyricResult.lyric,
    isSynced: lyricResult.isSynced,
  })
  if (!text) throw mediaMatchError('no_lyric')

  // 普通路径：翻译/罗马音行级扩展段与正文同一份 `.lrc`；无扩展数据时输出与旧版逐字节一致
  const tlyric = sanitizeExtendedLyric(lyricResult.tlyric)
  const rlyric = sanitizeExtendedLyric(lyricResult.rlyric)
  const extendedText = buildExtendedLrcText(text, { tlyric, rlyric })

  try {
    const result = await applyLrc(musicInfo.meta.filePath, extendedText)
    return {
      ...result,
      hasWordSync: false,
      hasTranslation: !!tlyric,
      hasRomaji: !!rlyric,
    }
  } catch (err) {
    throw toIpcError(err, lrcFileErrorPrefix)
  }
}

/**
 * 应用/回退外挂 LRC 后清掉该曲的 DB 歌词覆盖（raw 缓存 + 已编辑/偏移快照）。
 *
 * 否则 `getLyricInfo` 里旧的用户快照仍优先于文件，表现为「点了应用但歌词/翻译/罗马音没生效」。
 */
const clearDbLyricOverride = async(musicId: string): Promise<boolean> => {
  if (!musicId) return false
  try {
    const dbService = global.lx.worker.dbService
    const [edited, raw] = await Promise.all([
      dbService.getEditedLyric(musicId),
      dbService.getRawLyric(musicId),
    ])
    if (!edited?.lyric && !raw?.lyric) return false
    await dbService.rawLyricRemove([musicId])
    await dbService.editedLyricRemove([musicId])
    // 只有真的存在「已编辑/偏移」快照时才算清掉了用户改动；raw 只是旧版本的歌词缓存
    return !!edited?.lyric
  } catch (err) {
    log.debug('[mediaMatch] clear db lyric override failed', err)
    return false
  }
}

export default () => {
  mainHandle<LX.MediaMatch.SearchParams, LX.MediaMatch.SearchResult>(MEDIA_MATCH_EVENT_NAME.search, async({ params }) => {
    const musicInfo = await assertMusicInfo(params?.musicInfo)
    const query = createQuery(musicInfo, params?.keyword)
    log.debug('[mediaMatch] search start', {
      name: query.name,
      singer: query.singer,
      album: query.albumName,
      variants: query.variants.length,
    })

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, SEARCH_TIMEOUT)
    try {
      const candidates = await searchCandidates(query, controller.signal)
      return { candidates }
    } finally {
      clearTimeout(timer)
    }
  })

  mainHandle<LX.MediaMatch.GetLyricParams, LX.MediaMatch.LyricResult | null>(MEDIA_MATCH_EVENT_NAME.get_lyric, async({ params }) => {
    const candidate = assertCandidate(params?.candidate)
    return getCandidateLyric(candidate)
  })

  mainHandle<LX.MediaMatch.GetWordSyncParams, LX.MediaMatch.WordSyncResult | null>(MEDIA_MATCH_EVENT_NAME.get_word_sync, async({ params }) => {
    const candidate = assertCandidate(params?.candidate)
    return getCandidateWordSync(candidate)
  })

  mainHandle<LX.MediaMatch.ApplyParams, LX.MediaMatch.ApplyResult>(MEDIA_MATCH_EVENT_NAME.apply_lrc, async({ params }) => {
    const musicInfo = await assertMusicInfo(params?.musicInfo)
    const candidate = assertCandidate(params?.candidate)
    const result = await applyLyricFile(musicInfo, candidate)
    // 新 LRC 已成为该曲歌词的唯一来源：清掉旧快照，避免刷新时被 DB 缓存盖住
    const clearedDbLyric = await clearDbLyricOverride(musicInfo.id)
    return { ...result, clearedDbLyric }
  })

  mainHandle<LX.MediaMatch.RollbackParams, LX.MediaMatch.RollbackResult>(MEDIA_MATCH_EVENT_NAME.rollback_lrc, async({ params }) => {
    const filePath = params?.filePath
    await assertFileExist(filePath)
    try {
      const restored = await rollbackLrc(filePath)
      if (restored) await clearDbLyricOverride(params?.musicId ?? '')
      return { restored }
    } catch (err) {
      throw toIpcError(err, lrcFileErrorPrefix)
    }
  })

  mainHandle<LX.MediaMatch.FilePathParams, LX.MediaMatch.LrcState>(MEDIA_MATCH_EVENT_NAME.get_lrc_state, async({ params }) => {
    const filePath = params?.filePath
    if (!filePath || !await checkPath(filePath)) return { lrcExists: false, backupExists: false }
    return getLrcState(filePath)
  })

  // 批次补全用：一次解析拿到内嵌歌词/封面 + 同目录文件存在性（不抛错，坏文件按无内嵌处理）
  mainHandle<LX.MediaMatch.FilePathParams, LX.MediaMatch.FileState>(MEDIA_MATCH_EVENT_NAME.get_file_state, async({ params }) => {
    return getFileState(params?.filePath)
  })
}
