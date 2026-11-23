import fsp from 'node:fs/promises'
import path from 'node:path'
import { File } from '@common/constants_sync'
import {
  BASELINE_VERSION,
  mergeBaselineEntries,
  parseBaselineEntries,
  parseBaselineState,
  type BaselineKey,
  type BaselineState,
} from './diff'

/**
 * 上次同步基线：按「对端配对 + 本地根目录 + 对端根目录」分别保存。
 * 只有发起同步的一端才需要保存基线。
 *
 * 旧版格式（裸数组 / v1 / v2）无法确认归属，由 `loadBaselineState` 标记为 legacy，
 * 调用方做一次性迁移（只保留两端当前都存在的路径），并在界面上提示本次清单需人工复核。
 */
export type { BaselineKey, BaselineState }

interface BaselineFile {
  version: typeof BASELINE_VERSION
  entries: ReturnType<typeof mergeBaselineEntries>
}

const getDirPath = () => path.join(global.lxDataPath, File.syncDir, File.musicFileDir)

export const getBaselinePath = () => path.join(getDirPath(), File.musicFileBaselineJSON)

const readRaw = async(): Promise<string> => {
  try {
    return await fsp.readFile(getBaselinePath(), 'utf-8')
  } catch {
    return ''
  }
}

export const loadBaselineState = async(key: BaselineKey): Promise<BaselineState> => {
  const raw = await readRaw()
  if (!raw) return { paths: [], legacy: false }
  return parseBaselineState(raw, key)
}

export const loadBaseline = async(key: BaselineKey): Promise<string[]> => (await loadBaselineState(key)).paths

export const saveBaseline = async(key: BaselineKey, paths: readonly string[]) => {
  await fsp.mkdir(getDirPath(), { recursive: true })
  // 读旧文件只为保留其他目录组合的基线，解析失败就只写当前组合
  const entries = parseBaselineEntries(await readRaw())
  const merged = mergeBaselineEntries(entries, key, paths, Date.now())
  const data: BaselineFile = { version: BASELINE_VERSION, entries: merged }
  await fsp.writeFile(getBaselinePath(), JSON.stringify(data), 'utf-8')
}

/** 迁移旧格式前留一份原文件，方便出问题时人工核对 */
export const backupBaselineFile = async() => {
  try {
    await fsp.copyFile(getBaselinePath(), `${getBaselinePath()}.legacy`)
  } catch {}
}

export const clearBaseline = async() => {
  try {
    await fsp.unlink(getBaselinePath())
  } catch {}
}
