import { encodePath } from '@common/utils/common'
import { updateListMusics } from '@renderer/store/list/action'
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
    const [lyricInfo, fileLyricInfo] = await Promise.all([getCachedLyricInfo(musicInfo), window.lx.worker.main.getMusicFileLyric(musicInfo.meta.filePath)])
    // console.log(lyricInfo, fileLyricInfo)
    if (lyricInfo?.lyric && lyricInfo.lyric != fileLyricInfo?.lyric) {
      // 存在已编辑歌词
      return buildLyricInfo({ ...lyricInfo, rawlrcInfo: fileLyricInfo ?? lyricInfo.rawlrcInfo })
    }

    if (fileLyricInfo) return buildLyricInfo(fileLyricInfo)
    if (lyricInfo?.lyric) return buildLyricInfo(lyricInfo)
  }

  return buildLyricInfo({ lyric: '', tlyric: '', rlyric: '', lxlyric: '' })
}

// 本地歌曲的封面缓存更新（供后续在线匹配封面使用）
export const updateLocalPic = (listId: string, musicInfo: LX.Music.MusicInfo, url: string) => {
  musicInfo.meta.picUrl = url
  void updateListMusics([{ id: listId, musicInfo }])
}
