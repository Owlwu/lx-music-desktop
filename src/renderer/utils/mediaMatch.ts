export type MediaMatchErrorCode =
  | 'invalid_music'
  | 'file_not_found'
  | 'invalid_candidate'
  | 'no_lyric'
  | 'instrumental'
  | 'lrc_no_permission'
  | 'lrc_disk_full'
  | 'lrc_unknown'
  | 'unknown'

const mediaMatchRxp = /MEDIA_MATCH_ERR:(\w+)/
const lrcFileRxp = /MEDIA_MATCH_LRC_ERR:(\w+)/

/**
 * 解析主进程返回的匹配错误码（用于区分目录不可写/磁盘已满等）
 */
export const getMediaMatchErrorCode = (err: unknown): MediaMatchErrorCode => {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lrcFileResult = lrcFileRxp.exec(message)
  if (lrcFileResult) {
    switch (lrcFileResult[1]) {
      case 'no_permission': return 'lrc_no_permission'
      case 'disk_full': return 'lrc_disk_full'
      case 'invalid_file': return 'invalid_music'
      default: return 'lrc_unknown'
    }
  }
  const mediaMatchResult = mediaMatchRxp.exec(message)
  if (mediaMatchResult) {
    switch (mediaMatchResult[1]) {
      case 'invalid_music': return 'invalid_music'
      case 'file_not_found': return 'file_not_found'
      case 'invalid_candidate': return 'invalid_candidate'
      case 'no_lyric': return 'no_lyric'
      case 'instrumental': return 'instrumental'
      default: return 'unknown'
    }
  }
  return 'unknown'
}

/**
 * 匹配错误码对应的 i18n key
 */
export const getMediaMatchErrorKey = (code: MediaMatchErrorCode): string => {
  switch (code) {
    case 'file_not_found':
      return 'lyrics_match__err_file_not_found'
    case 'invalid_music':
      return 'lyrics_match__err_no_file'
    case 'invalid_candidate':
      return 'lyrics_match__err_invalid_candidate'
    case 'no_lyric':
      return 'lyrics_match__not_found'
    case 'instrumental':
      return 'lyrics_match__instrumental'
    case 'lrc_no_permission':
      return 'lyrics_match__err_no_permission'
    case 'lrc_disk_full':
      return 'lyrics_match__err_disk_full'
    case 'lrc_unknown':
      return 'lyrics_match__err_unknown'
    default:
      return 'lyrics_match__err_unknown'
  }
}
