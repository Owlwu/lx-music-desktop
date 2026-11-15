// 本地歌曲同名附属文件（外挂歌词 / 同名封面）路径推导（纯函数，无平台依赖）
//
// 用于「从列表移除本地歌曲并同时删除本地文件」时一并清理同名附属文件：
// - 外挂歌词：`.lrc` / `.LRC`，以及桌面端读取链路兼容的 `.krc` / `.KRC`；含 `.bak`、临时文件
// - 同名封面：`.jpg` / `.png`；含 `.bak`、暂存/回滚临时文件（封面写入规则见 coverFile.ts）
// 只生成路径，不判断文件是否存在；是否真实用户文件由调用方先校验。

const windowsDriveRxp = /^[a-z]:[\\/]/i
const uriSchemeRxp = /^[a-z][a-z0-9+.-]*:\/\//i
const sidecarExtRxp = /\.(?:lrc|krc|bak|tmp|jpe?g|png|webp)$/i

/**
 * 是否本地绝对路径：Windows 盘符 / UNC / POSIX 根路径。
 * URI（`file://`、`content://` 等）与相对路径均返回 false。
 */
export const isAbsoluteLocalMusicPath = (filePath: string): boolean => {
  if (!filePath || typeof filePath !== 'string') return false
  if (uriSchemeRxp.test(filePath)) return false
  if (windowsDriveRxp.test(filePath)) return true
  if (filePath.startsWith('\\\\')) return true
  return filePath.startsWith('/')
}

/**
 * 去掉最后一个扩展名（分隔符兼容 `/` 与 `\`）。
 * 无扩展名时原样返回；`.hidden` 这类点开头的文件名不会被当成扩展名。
 */
const getStem = (filePath: string): string => {
  const dirIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const dotIndex = filePath.lastIndexOf('.')
  return dotIndex > dirIndex + 1 ? filePath.substring(0, dotIndex) : filePath
}

/**
 * 歌曲对应的同名附属文件路径（歌词在前，封面在后）。
 * 非绝对路径 / URI / 本身已是附属文件时返回空数组。
 */
export const getLocalMusicSidecarPaths = (filePath: string): string[] => {
  if (!isAbsoluteLocalMusicPath(filePath)) return []
  // 音频路径本身是歌词/图片/备份等附属文件时不做推导，避免把路径自身当成附属文件
  if (sidecarExtRxp.test(filePath)) return []
  const stem = getStem(filePath)
  if (!stem) return []

  const paths = [
    // 外挂歌词（桌面端读取 `.lrc`，并兼容 `.krc`）与备份/临时文件
    `${stem}.lrc`,
    `${stem}.LRC`,
    `${stem}.lrc.bak`,
    `${stem}.LRC.bak`,
    `${stem}.lrc.tmp`,
    `${stem}.LRC.tmp`,
    `${stem}.lrc.restore.tmp`,
    `${stem}.LRC.restore.tmp`,
    `${stem}.lrc.rollback.tmp`,
    `${stem}.LRC.rollback.tmp`,
    `${stem}.krc`,
    `${stem}.KRC`,
    // 同名封面（jpg 优先、png 其次）与备份/临时文件
    `${stem}.jpg`,
    `${stem}.png`,
    `${stem}.jpg.bak`,
    `${stem}.png.bak`,
    `${stem}.jpg.tmp`,
    `${stem}.png.tmp`,
    `${stem}.jpg.rollback.tmp`,
    `${stem}.png.rollback.tmp`,
    `${stem}.jpg.bak.replaced.tmp`,
    `${stem}.png.bak.replaced.tmp`,
  ]
  return [...new Set(paths)]
}
