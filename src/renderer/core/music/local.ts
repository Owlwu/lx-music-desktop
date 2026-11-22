import { encodePath } from '@common/utils/common'
import { getPreferredLyricSource, resolveLyricSource } from '@common/utils/mediaMatch/source'
import { updateListMusics } from '@renderer/store/list/action'
import { appSetting } from '@renderer/store/setting'
import { getLocalFilePath } from '@renderer/utils/music'

import {
  buildLyricInfo,
  getCachedLyricInfo,
} from './utils'


export const getMusicUrl = async({ musicInfo, isRefresh }: {
  musicInfo: LX.Music.MusicInfo
  isRefresh?: boolean
}): Promise<string> => {
  const path = await getLocalFilePath(musicInfo)
  if (path) return encodePath(path)

  throw new Error('本地文件不存在')
}

export const getPicUrl = async({ musicInfo, listId, isRefresh }: {
  musicInfo: LX.Music.MusicInfo
  listId?: string | null
  isRefresh?: boolean
}): Promise<string> => {
  if (!isRefresh) {
    const pic = await window.lx.worker.main.getMusicFilePic(musicInfo.meta.filePath)
    if (pic) return pic

    if (musicInfo.meta.picUrl) return musicInfo.meta.picUrl
  }

  return ''
}

export const getLyricInfo = async({ musicInfo, isRefresh }: {
  musicInfo: LX.Music.MusicInfo
  isRefresh?: boolean
}): Promise<LX.Player.LyricInfo> => {
  if (!isRefresh) {
    const [lyricInfo, fileLyric] = await Promise.all([
      getCachedLyricInfo(musicInfo),
      window.lx.worker.main.getMusicFileLyric(musicInfo.meta.filePath),
    ])
    const preferred = getPreferredLyricSource(musicInfo.meta.lyricSource, appSetting['player.lyricSource'])
    const actualSource = resolveLyricSource(
      !!fileLyric?.embedded?.lyric,
      !!fileLyric?.lrc?.lyric,
      preferred,
    )
    const fileLyricInfo = actualSource === 'lrc'
      ? fileLyric?.lrc
      : actualSource === 'embedded' ? fileLyric?.embedded : null

    // 只有用户手动编辑/调过偏移的歌词（DB edited）才优先于文件：
    // 旧版本遗留的 raw 歌词缓存不能盖住新写入的 .lrc，否则在线匹配「应用」后看不到任何变化
    if (lyricInfo?.isEdited && lyricInfo.lyric) {
      return buildLyricInfo({ ...lyricInfo, rawlrcInfo: fileLyricInfo ?? lyricInfo.rawlrcInfo })
    }

    if (fileLyricInfo) return buildLyricInfo(fileLyricInfo)
    // 文件里没有歌词时才退回 DB 缓存（旧版本的 raw 缓存）
    if (lyricInfo?.lyric) return buildLyricInfo(lyricInfo)
  }

  return buildLyricInfo({ lyric: '', tlyric: '', rlyric: '', lxlyric: '' })
}

// 本地歌曲的封面缓存更新（供后续在线匹配封面使用）
export const updateLocalPic = (listId: string, musicInfo: LX.Music.MusicInfo, url: string) => {
  musicInfo.meta.picUrl = url
  void updateListMusics([{ id: listId, musicInfo }])
}
