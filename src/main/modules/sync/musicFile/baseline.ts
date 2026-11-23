import fsp from 'node:fs/promises'
import path from 'node:path'
import { File } from '@common/constants_sync'
import { BASELINE_VERSION, parseBaseline, type BaselineKey } from './diff'

/**
 * 上次同步基线：记录上一次同步结束时两端都存在的文件相对路径。
 * 只有发起同步的一端才需要保存基线。
 *
 * 基线绑定「对端配对 + 两端根目录」：换配对、换设备或换任一侧存放目录时视为首次同步，
 * 避免拿旧记忆去判断新增/删除。格式与解析规则见 `diff.ts`。
 */
export type { BaselineKey }

interface BaselineFile extends BaselineKey {
  version: typeof BASELINE_VERSION
  paths: string[]
}

const getDirPath = () => path.join(global.lxDataPath, File.syncDir, File.musicFileDir)

export const getBaselinePath = () => path.join(getDirPath(), File.musicFileBaselineJSON)

export const loadBaseline = async(key: BaselineKey): Promise<string[]> => {
  try {
    return parseBaseline(await fsp.readFile(getBaselinePath(), 'utf-8'), key)
  } catch {
    return []
  }
}

export const saveBaseline = async(key: BaselineKey, paths: readonly string[]) => {
  await fsp.mkdir(getDirPath(), { recursive: true })
  const data: BaselineFile = {
    version: BASELINE_VERSION,
    pairId: key.pairId,
    localRoot: key.localRoot,
    remoteRoot: key.remoteRoot,
    paths: [...paths],
  }
  await fsp.writeFile(getBaselinePath(), JSON.stringify(data), 'utf-8')
}

export const clearBaseline = async() => {
  try {
    await fsp.unlink(getBaselinePath())
  } catch {}
}
