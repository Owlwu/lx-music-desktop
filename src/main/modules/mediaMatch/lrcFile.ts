import fs from 'node:fs/promises'
import path from 'node:path'
import type { Stats } from 'node:fs'

export type LrcErrorCode = 'invalid_file' | 'no_permission' | 'disk_full' | 'unknown'

export class LrcFileError extends Error {
  code: LrcErrorCode

  constructor(code: LrcErrorCode, message: string) {
    super(message)
    this.name = 'LrcFileError'
    this.code = code
  }
}

const lrcExtRxp = /\.(?:lrc|bak|tmp)$/i

/**
 * 由音频路径推导同名 LRC / 备份 / 临时文件路径
 */
export const getLrcPaths = (filePath: string): {
  lrcPath: string
  backupPath: string
  tmpPath: string
} => {
  const ext = path.extname(filePath)
  const lrcPath = filePath.slice(0, filePath.length - ext.length) + '.lrc'
  return {
    lrcPath,
    backupPath: lrcPath + '.bak',
    tmpPath: lrcPath + '.tmp',
  }
}

const statOrNull = async(filePath: string): Promise<Stats | null> => {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}

/**
 * 仅允许真实存在、带扩展名、非 lrc/bak/tmp 的绝对文件路径
 */
export const isAudioFilePath = async(filePath: string): Promise<boolean> => {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  if (!path.extname(filePath) || lrcExtRxp.test(filePath)) return false
  const stats = await statOrNull(filePath)
  return !!stats?.isFile()
}

const getErrnoCode = (err: unknown): string => {
  return (err as NodeJS.ErrnoException | null)?.code ?? ''
}

const classifyError = (err: unknown): LrcErrorCode => {
  if (err instanceof LrcFileError) return err.code
  switch (getErrnoCode(err)) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'no_permission'
    case 'ENOSPC':
      return 'disk_full'
    default:
      return 'unknown'
  }
}

const toLrcError = (err: unknown): LrcFileError => {
  if (err instanceof LrcFileError) return err
  const code = classifyError(err)
  const message = err instanceof Error ? err.message : String(err)
  return new LrcFileError(code, message)
}

const removeTmpIfExists = async(tmpPath: string): Promise<void> => {
  try {
    await fs.rm(tmpPath, { force: true, recursive: true })
  } catch {}
}

const unlinkIfExists = async(filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath)
  } catch (err) {
    if (getErrnoCode(err) !== 'ENOENT') throw err
  }
}

/**
 * 写入同名 LRC：先备份原文件（仅第一次）、临时文件 + rename、失败恢复
 */
export const applyLrc = async(filePath: string, text: string): Promise<{
  lrcPath: string
  backupCreated: boolean
}> => {
  if (!await isAudioFilePath(filePath)) {
    throw new LrcFileError('invalid_file', 'invalid audio file path')
  }

  const { lrcPath, backupPath, tmpPath } = getLrcPaths(filePath)
  let backupCreated = false

  try {
    const lrcStats = await statOrNull(lrcPath)
    const backupStats = await statOrNull(backupPath)
    if (lrcStats?.isFile() && !backupStats) {
      await fs.rename(lrcPath, backupPath)
      backupCreated = true
    }

    await removeTmpIfExists(tmpPath)
    // UTF-8 无 BOM
    await fs.writeFile(tmpPath, text, { encoding: 'utf8' })
    await fs.rename(tmpPath, lrcPath)

    return { lrcPath, backupCreated }
  } catch (err) {
    await removeTmpIfExists(tmpPath)
    if (backupCreated) {
      const lrcStats = await statOrNull(lrcPath)
      if (!lrcStats) {
        try {
          await fs.rename(backupPath, lrcPath)
        } catch {}
      }
    }
    throw toLrcError(err)
  }
}

/**
 * 回退：把备份内容原子写回 LRC，成功后再删除备份；任一步失败都不丢当前数据，可重试
 */
export const rollbackLrc = async(filePath: string): Promise<boolean> => {
  if (!await isAudioFilePath(filePath)) {
    throw new LrcFileError('invalid_file', 'invalid audio file path')
  }

  const { lrcPath, backupPath } = getLrcPaths(filePath)
  const rollbackTmpPath = lrcPath + '.rollback.tmp'
  const backupStats = await statOrNull(backupPath)
  if (!backupStats?.isFile()) return false

  try {
    // 先读备份内容，写临时文件后 rename 覆盖 lrc（lrc 在写入成功前保持原样）
    const backupData = await fs.readFile(backupPath)
    await removeTmpIfExists(rollbackTmpPath)
    await fs.writeFile(rollbackTmpPath, backupData)
    await fs.rename(rollbackTmpPath, lrcPath)
    await unlinkIfExists(backupPath)
    return true
  } catch (err) {
    await removeTmpIfExists(rollbackTmpPath)
    throw toLrcError(err)
  }
}

/**
 * 查询同名 LRC / 备份状态
 */
export const getLrcState = async(filePath: string): Promise<LX.MediaMatch.LrcState> => {
  if (!await isAudioFilePath(filePath)) {
    return { lrcExists: false, backupExists: false }
  }

  const { lrcPath, backupPath } = getLrcPaths(filePath)
  const [lrcStats, backupStats] = await Promise.all([statOrNull(lrcPath), statOrNull(backupPath)])
  const state: LX.MediaMatch.LrcState = {
    lrcExists: !!lrcStats?.isFile(),
    backupExists: !!backupStats?.isFile(),
  }
  if (lrcStats?.isFile()) {
    state.lrcSize = lrcStats.size
    state.lrcMtime = lrcStats.mtimeMs
  }
  return state
}
