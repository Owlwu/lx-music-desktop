import { checkPath, extname, basename, readFile, getFileStats } from '@common/utils/nodejs'
import { formatPlayTime } from '@common/utils/common'
import { decodeKrc } from '@common/utils/lyricUtils/kg'
import { type IAudioMetadata } from 'music-metadata'

export const checkLocalFileAvailable = async(musicInfo: LX.Music.MusicInfoLocal): Promise<boolean> => {
  return checkPath(musicInfo.meta.filePath)
}

export const getLocalFilePath = async(musicInfo: LX.Music.MusicInfoLocal): Promise<string> => {
  return (await checkPath(musicInfo.meta.filePath)) ? musicInfo.meta.filePath : ''
}

/**
 * 创建本地音乐信息对象
 * @param path 文件路径
 * @returns
 */
export const createLocalMusicInfo = async(path: string): Promise<LX.Music.MusicInfoLocal | null> => {
  if (!await checkPath(path)) return null
  const { parseFile } = await import('music-metadata')

  let metadata
  try {
    metadata = await parseFile(path)
  } catch (err) {
    console.log(err)
    return null
  }

  // console.log(metadata)
  let ext = extname(path)
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  let name = (metadata.common.title || basename(path, ext)).trim()
  let singer = metadata.common.artists?.length ? metadata.common.artists.map(a => a.trim()).join('、') : ''
  let interval = metadata.format.duration ? formatPlayTime(metadata.format.duration) : ''
  let albumName = metadata.common.album?.trim() ?? ''

  return {
    id: path,
    name,
    singer,
    source: 'local',
    interval,
    meta: {
      albumName,
      filePath: path,
      songId: path,
      picUrl: '',
      ext: ext.replace(/^\./, ''),
    },
  }
}

let prevFileInfo: {
  path: string
  promise: Promise<LX.MusicMetadataModule.IAudioMetadata | null>
} = {
  path: '',
  promise: Promise.resolve(null),
}
const getFileMetadata = async(path: string) => {
  if (prevFileInfo.path == path) return prevFileInfo.promise
  prevFileInfo.path = path
  return prevFileInfo.promise = checkPath(path).then(async(isExist) => {
    return isExist ? import('music-metadata').then(async({ parseFile }) => parseFile(path)).catch(err => {
      console.log(err)
      return null
    }) : null
  })
}
/**
 * 获取歌曲文件封面图片
 * @param path 路径
 */
export const getLocalMusicFilePic = async(path: string) => {
  const filePath = new RegExp('\\' + extname(path) + '$')
  let picPath = path.replace(filePath, '.jpg')
  let stats = await getFileStats(picPath)
  if (stats) return picPath
  picPath = path.replace(filePath, '.png')
  stats = await getFileStats(picPath)
  if (stats) return picPath
  const metadata = await getFileMetadata(path)
  if (!metadata) return null
  const { selectCover } = await import('music-metadata')
  return selectCover(metadata.common.picture)
}

type IComment = NonNullable<IAudioMetadata['common']['comment']> extends Array<infer U> ? U : never

/**
 * 获取音频文件内嵌歌词（LYRICS / USLT）
 * @param path 路径
 */
export const getLocalMusicFileEmbeddedLyric = async(path: string): Promise<LX.Music.LyricInfo | null> => {
  const metadata = await getFileMetadata(path)
  if (!metadata) return null
  for (const info of Object.values(metadata.native)) {
    for (const ust of info) {
      switch (ust.id) {
        case 'LYRICS': {
          const value = typeof ust.value == 'string' ? ust.value : (ust as IComment).text
          if (value && value.length > 10) return { lyric: value }
          break
        }
        case 'USLT': {
          const value = ust.value as IComment
          if (value.text && value.text.length > 10) return { lyric: value.text }
          break
        }
      }
    }
  }
  return null
}

/**
 * 获取歌曲同目录下的同名 .lrc / .krc 外挂歌词（不含内嵌）
 * @param path 路径
 */
export const getLocalMusicFileLrcLyric = async(path: string): Promise<LX.Music.LyricInfo | null> => {
  const filePath = new RegExp('\\' + extname(path) + '$')

  // 尝试读取同目录下的同名lrc文件
  let lrcPath = path.replace(filePath, '.lrc')
  let stats = await getFileStats(lrcPath)
  if (stats && stats.size < 1024 * 1024 * 10) {
    const lrcBuf = await readFile(lrcPath)
    const { detect } = await import('jschardet')
    const { confidence, encoding } = detect(lrcBuf)
    if (confidence > 0.8) {
      const iconv = (await import('iconv-lite')).default
      if (iconv.encodingExists(encoding)) {
        const lrc = iconv.decode(lrcBuf, encoding)
        if (lrc) {
          return {
            lyric: lrc,
          }
        }
      }
    }
  }

  // 尝试读取同目录下的同名krc文件
  lrcPath = path.replace(filePath, '.krc')
  stats = await getFileStats(lrcPath)
  if (stats && stats.size < 1024 * 1024 * 10) {
    const lrcBuf = await readFile(lrcPath)
    try {
      return await decodeKrc(lrcBuf)
    } catch (e) {
      console.log(e)
    }
  }

  return null
}
