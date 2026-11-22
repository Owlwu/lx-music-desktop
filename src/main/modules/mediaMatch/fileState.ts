import { log } from '@common/utils'
import { createEmptyFileState, getFileState as readFileState, type AudioMetadataLike } from '@common/utils/mediaMatch/fileState'

/**
 * 一次 music-metadata 解析同时判定内嵌歌词/内嵌封面；同目录文件用 fs.stat 判断（>0 字节）
 *
 * 性能：同目录歌词与封面都已存在时不调用 `parseFile`（见 common/utils/mediaMatch/fileState）。
 * 健壮性：文件不存在/损坏/无权限一律返回「无内嵌」，不抛错打断批次扫描。
 */
const parseAudioMetadata = async(filePath: string): Promise<AudioMetadataLike> => {
  const { parseFile } = await import('music-metadata')
  return await parseFile(filePath, { duration: false })
}

export const getFileState = async(filePath?: string | null): Promise<LX.MediaMatch.FileState> => {
  if (!filePath || typeof filePath !== 'string') return createEmptyFileState()
  return readFileState(filePath, {
    parseAudioMetadata,
    onParseError: (err) => {
      log.debug('[mediaMatch] read file state failed', err)
    },
  })
}
