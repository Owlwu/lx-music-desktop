import fsp from 'node:fs/promises'
import path from 'node:path'
import { File } from '@common/constants_sync'

/**
 * 上次同步基线：记录上一次同步结束时两端都存在的文件相对路径。
 * 只有发起同步的一端才需要保存基线。
 */
const getDirPath = () => path.join(global.lxDataPath, File.syncDir, File.musicFileDir)

export const getBaselinePath = () => path.join(getDirPath(), File.musicFileBaselineJSON)

export const loadBaseline = async(): Promise<string[]> => {
  try {
    const data = await fsp.readFile(getBaselinePath(), 'utf-8')
    const parsed = JSON.parse(data)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export const saveBaseline = async(paths: string[]) => {
  await fsp.mkdir(getDirPath(), { recursive: true })
  await fsp.writeFile(getBaselinePath(), JSON.stringify(paths), 'utf-8')
}

export const clearBaseline = async() => {
  try {
    await fsp.unlink(getBaselinePath())
  } catch {}
}
