import fs from 'node:fs/promises'
import path from 'node:path'
import type { Stats } from 'node:fs'
import { unlinkSidecar, withSidecarWrite } from '../sidecarWrite'

export type LrcErrorCode = 'invalid_file' | 'no_permission' | 'disk_full' | 'unknown'

export class LrcFileError extends Error {
  code: LrcErrorCode

  constructor(code: LrcErrorCode, message: string) {
    super(message)
    this.name = 'LrcFileError'
    this.code = code
  }
}

const lrcExtRxp = /\.(?:lrc|krc|bak|tmp|jpe?g|png|webp)$/i

const getLrcPath = (filePath: string): string => {
  const ext = path.extname(filePath)
  return filePath.slice(0, filePath.length - ext.length) + '.lrc'
}

const statOrNull = async(filePath: string): Promise<Stats | null> => {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}

/**
 * 仅允许真实存在、带扩展名、非附属文件的绝对路径
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

export const applyLrc = async(filePath: string, text: string): Promise<{ lrcPath: string }> => {
  if (!await isAudioFilePath(filePath)) {
    throw new LrcFileError('invalid_file', 'invalid audio file path')
  }

  const lrcPath = getLrcPath(filePath)
  return withSidecarWrite(lrcPath, async() => {
    const tmpPath = lrcPath + '.tmp'
    try {
      await unlinkSidecar(tmpPath)
      await fs.writeFile(tmpPath, text, { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tmpPath, lrcPath)
      return { lrcPath }
    } catch (err) {
      throw toLrcError(err)
    } finally {
      await unlinkSidecar(tmpPath).catch(() => {})
    }
  })
}

export const deleteLrc = async(filePath: string): Promise<boolean> => {
  if (!await isAudioFilePath(filePath)) {
    throw new LrcFileError('invalid_file', 'invalid audio file path')
  }

  const lrcPath = getLrcPath(filePath)
  return withSidecarWrite(lrcPath, async() => {
    try {
      const deleted = await unlinkSidecar(lrcPath)
      return await unlinkSidecar(lrcPath.slice(0, -4) + '.LRC') || deleted
    } catch (err) {
      throw toLrcError(err)
    }
  })
}

export const getLrcState = async(filePath: string): Promise<LX.MediaMatch.LrcState> => {
  if (!await isAudioFilePath(filePath)) return { lrcExists: false }
  const lrcPath = getLrcPath(filePath)
  const lower = await statOrNull(lrcPath)
  const stats = lower?.isFile() ? lower : await statOrNull(lrcPath.slice(0, -4) + '.LRC')
  if (!stats?.isFile()) return { lrcExists: false }
  return { lrcExists: true, lrcSize: stats.size, lrcMtime: stats.mtimeMs }
}
