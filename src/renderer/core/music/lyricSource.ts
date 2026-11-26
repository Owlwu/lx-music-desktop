import { getPreferredLyricSource, resolveLyricSource } from '@common/utils/mediaMatch/source'
import { getLyricInfo } from '@renderer/core/music'
import { setMusicInfo } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { updateListMusics } from '@renderer/store/list/action'
import { appSetting } from '@renderer/store/setting'

/**
 * 持久化单曲歌词来源（写入列表 meta；只改数据，不写文件）
 */
export const setMusicLyricSource = async(
  musicInfo: LX.Music.MusicInfo,
  source: LX.MediaMatch.LyricSource,
  listId?: string | null,
): Promise<void> => {
  musicInfo.meta.lyricSource = source
  const targetListId = listId ?? playMusicInfo.listId
  if (!targetListId) return
  try {
    await updateListMusics([{ id: targetListId, musicInfo }])
  } catch (err) {
    console.log(err)
  }
}

/**
 * 当前播放歌曲的歌词来源状态（含自动回退后的实际来源）
 */
export const getFileLyricSourceInfo = async(musicInfo: LX.Music.MusicInfo): Promise<{
  preferred: LX.MediaMatch.LyricSource
  actual: LX.MediaMatch.LyricSource | null
  hasEmbedded: boolean
  hasLrc: boolean
}> => {
  const fileLyric = await window.lx.worker.main.getMusicFileLyric(musicInfo.meta.filePath)
  const hasEmbedded = !!fileLyric?.embedded?.lyric
  const hasLrc = !!fileLyric?.lrc?.lyric
  const preferred = getPreferredLyricSource(musicInfo.meta.lyricSource, appSetting['player.lyricSource'])
  return {
    preferred,
    actual: resolveLyricSource(hasEmbedded, hasLrc, preferred),
    hasEmbedded,
    hasLrc,
  }
}

/**
 * 重新读取当前播放歌曲的歌词并刷新显示
 */
export const refreshPlayLyric = async(musicInfo?: LX.Music.MusicInfo): Promise<void> => {
  const currentMusicInfo = playMusicInfo.musicInfo
  if (!currentMusicInfo) return
  if (musicInfo && currentMusicInfo.id != musicInfo.id) return

  const lyricInfo = await getLyricInfo({ musicInfo: currentMusicInfo })
  if (playMusicInfo.musicInfo?.id !== currentMusicInfo.id) return
  setMusicInfo({
    lrc: lyricInfo.lyric,
    tlrc: lyricInfo.tlyric,
    lxlrc: lyricInfo.lxlyric,
    rlrc: lyricInfo.rlyric,
    rawlrc: lyricInfo.rawlrcInfo.lyric,
  })
  window.app_event.lyricUpdated()
}
