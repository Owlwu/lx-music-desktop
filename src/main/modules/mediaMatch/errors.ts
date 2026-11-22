/**
 * 歌词匹配错误码前缀：渲染进程按前缀解析成具体提示（`getMediaMatchErrorCode`）
 */
export const mediaMatchErrorPrefix = 'MEDIA_MATCH_ERR:'

export const mediaMatchError = (code: string): Error => new Error(mediaMatchErrorPrefix + code)
