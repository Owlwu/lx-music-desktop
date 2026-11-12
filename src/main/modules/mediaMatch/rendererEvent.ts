import { MEDIA_MATCH_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { buildLrcText } from '@common/utils/mediaMatch/lrcText'
import { checkPath } from '@common/utils/nodejs'
import { log } from '@common/utils'
import { createQuery, getCandidateLyric, searchCandidates } from './matcher'
import { applyLrc, getLrcState, LrcFileError, rollbackLrc } from './lrcFile'

const SEARCH_TIMEOUT = 15000
const mediaMatchErrorPrefix = 'MEDIA_MATCH_ERR:'
const lrcFileErrorPrefix = 'MEDIA_MATCH_LRC_ERR:'

const mediaMatchError = (code: string): Error => new Error(mediaMatchErrorPrefix + code)

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
  if (!candidate?.id || (candidate.source !== 'lrclib' && candidate.source !== 'qq')) {
    throw mediaMatchError('invalid_candidate')
  }
  return candidate
}

const applyLyricFile = async(
  musicInfo: LX.Music.MusicInfo,
  candidate: LX.MediaMatch.LyricsCandidate,
): Promise<LX.MediaMatch.ApplyResult> => {
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

  try {
    return await applyLrc(musicInfo.meta.filePath, text)
  } catch (err) {
    throw toIpcError(err, lrcFileErrorPrefix)
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

  mainHandle<LX.MediaMatch.ApplyParams, LX.MediaMatch.ApplyResult>(MEDIA_MATCH_EVENT_NAME.apply_lrc, async({ params }) => {
    const musicInfo = await assertMusicInfo(params?.musicInfo)
    const candidate = assertCandidate(params?.candidate)
    return applyLyricFile(musicInfo, candidate)
  })

  mainHandle<LX.MediaMatch.FilePathParams, LX.MediaMatch.RollbackResult>(MEDIA_MATCH_EVENT_NAME.rollback_lrc, async({ params }) => {
    const filePath = params?.filePath
    await assertFileExist(filePath)
    try {
      return { restored: await rollbackLrc(filePath) }
    } catch (err) {
      throw toIpcError(err, lrcFileErrorPrefix)
    }
  })

  mainHandle<LX.MediaMatch.FilePathParams, LX.MediaMatch.LrcState>(MEDIA_MATCH_EVENT_NAME.get_lrc_state, async({ params }) => {
    const filePath = params?.filePath
    if (!filePath || !await checkPath(filePath)) return { lrcExists: false, backupExists: false }
    return getLrcState(filePath)
  })
}
