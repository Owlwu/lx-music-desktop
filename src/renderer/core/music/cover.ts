import { getPicPath } from '@renderer/core/music'
import { setMusicInfo } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'

/**
 * 应用/恢复封面后刷新当前播放歌曲的封面
 *
 * 同名图片覆盖后 worker 会返回带 `?v=<mtimeMs>` 的路径（击穿 Chromium 图片缓存），
 * 这里重新取 pic 并通知界面刷新，不打断音频。
 */
export const refreshPlayCover = async(musicInfo?: LX.Music.MusicInfo): Promise<boolean> => {
  const currentMusicInfo = playMusicInfo.musicInfo
  if (!currentMusicInfo) return false
  if (musicInfo && currentMusicInfo.id != musicInfo.id) return false

  const pic = await getPicPath({ musicInfo: currentMusicInfo, listId: playMusicInfo.listId })
  if (!pic) return false
  setMusicInfo({ pic })
  window.app_event.picUpdated()
  return true
}
