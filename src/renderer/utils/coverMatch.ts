export type CoverMatchErrorCode =
  | 'invalid_music'
  | 'file_not_found'
  | 'invalid_candidate'
  | 'download_failed'
  | 'image_invalid'
  | 'image_too_large'
  | 'no_permission'
  | 'disk_full'
  | 'unknown'

const coverMatchRxp = /COVER_MATCH_ERR:(\w+)/

/**
 * 解析主进程返回的封面匹配错误码（用于区分下载失败/目录不可写/磁盘已满等）
 */
export const getCoverMatchErrorCode = (err: unknown): CoverMatchErrorCode => {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const result = coverMatchRxp.exec(message)
  if (!result) return 'unknown'
  switch (result[1]) {
    case 'invalid_music': return 'invalid_music'
    case 'file_not_found': return 'file_not_found'
    case 'invalid_candidate': return 'invalid_candidate'
    case 'download_failed': return 'download_failed'
    case 'image_invalid': return 'image_invalid'
    case 'image_too_large': return 'image_too_large'
    case 'no_permission': return 'no_permission'
    case 'disk_full': return 'disk_full'
    default: return 'unknown'
  }
}

/**
 * 封面匹配错误码对应的 i18n key
 */
export const getCoverMatchErrorKey = (code: CoverMatchErrorCode): string => {
  switch (code) {
    case 'invalid_music': return 'cover_match__err_invalid_music'
    case 'file_not_found': return 'cover_match__err_file_not_found'
    case 'invalid_candidate': return 'cover_match__err_invalid_candidate'
    case 'download_failed': return 'cover_match__err_download_failed'
    case 'image_invalid': return 'cover_match__err_image_invalid'
    case 'image_too_large': return 'cover_match__err_image_too_large'
    case 'no_permission': return 'cover_match__err_no_permission'
    case 'disk_full': return 'cover_match__err_disk_full'
    default: return 'cover_match__err_unknown'
  }
}
