import { log } from '@common/utils'
import { removeFile } from '@common/utils/nodejs'
import { getLocalMusicSidecarPaths, isAbsoluteLocalMusicPath } from '@common/utils/musicSidecar'

/**
 * 删除本地歌曲文件，并一并清理同目录同名附属文件：
 * 歌词 `.lrc/.LRC/.krc/.KRC`（含 `.bak`、临时文件）与同名封面 `.jpg/.png`（含 `.bak`、临时文件）。
 *
 * 仅在设置 `list.isDeleteLocalFileWhenRemove` 开启时由移除流程调用。
 * 先删音频、成功后再删附属文件，避免出现「音频还在、歌词与封面已丢」的半删状态；
 * 音频删除失败只记录日志并保留附属文件，附属文件删除失败静默忽略，均不阻断列表移除。
 */
export const deleteLocalMusicFiles = async(musicInfo: LX.Music.MusicInfoLocal): Promise<void> => {
  const filePath = musicInfo.meta.filePath
  // 只处理本地绝对路径；URI/相对路径等异常数据直接跳过
  if (!isAbsoluteLocalMusicPath(filePath)) return

  try {
    await removeFile(filePath)
  } catch (err) {
    log.warn(`delete local music file failed: ${filePath}\n${(err as Error).message}`)
    return
  }

  const sidecarPaths = getLocalMusicSidecarPaths(filePath)
  await Promise.all(sidecarPaths.map(async sidecarPath => {
    try {
      await removeFile(sidecarPath)
    } catch {}
  }))
}
