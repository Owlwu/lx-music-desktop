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
 * 旧版格式（裸数组 / v1 / v2）由 `loadBaselineState` 标记为 legacy，损坏文件标记为 corrupt；
 * 调用方做一次性迁移（只保留两端当前都存在的路径），迁移前必须先成功备份，
 * 并在界面上提示本次清单需人工复核。
 */
export type { BaselineKey, BaselineState }

interface BaselineFile {
  version: typeof BASELINE_VERSION
  entries: ReturnType<typeof mergeBaselineEntries>
}

const getDirPath = () => path.join(global.lxDataPath, File.syncDir, File.musicFileDir)

export const getBaselinePath = () => path.join(getDirPath(), File.musicFileBaselineJSON)

/** 区分「文件不存在」和「文件存在但为空」：后者是损坏数据，不能当成首次同步 */
const readRaw = async(): Promise<{ exists: boolean, raw: string }> => {
  try {
    return { exists: true, raw: await fsp.readFile(getBaselinePath(), 'utf-8') }
  } catch {
    return { exists: false, raw: '' }
  }
}

export const loadBaselineState = async(key: BaselineKey): Promise<BaselineState> => {
  const { exists, raw } = await readRaw()
  if (!exists) return { status: 'missing', paths: [] }
  if (!raw.trim()) return { status: 'corrupt', paths: [] }
  return parseBaselineState(raw, key)
}

export const loadBaseline = async(key: BaselineKey): Promise<string[]> => (await loadBaselineState(key)).paths

export const saveBaseline = async(key: BaselineKey, paths: readonly string[], pendingMigration = false) => {
  await fsp.mkdir(getDirPath(), { recursive: true })
  // 读旧文件只为保留其他目录组合的基线；解析失败的单条会在写入时被丢弃（迁移前已备份原文件）
  const { raw } = await readRaw()
  const entries = parseBaselineEntries(raw)
  const merged = mergeBaselineEntries(entries, key, paths, Date.now(), pendingMigration)
  const data: BaselineFile = { version: BASELINE_VERSION, entries: merged }
  await fsp.writeFile(getBaselinePath(), JSON.stringify(data), 'utf-8')
}

/**
 * 迁移旧格式前尽力备份原文件，返回失败提示（成功时返回 null）。
 *
 * 不阻断迁移：基线只是分类提示，丢了最多退化成「按新增/删除重新确认」，不会丢音乐文件；
 * 备份和正式写入又共享同一目录，真正写不了时后面的写入也会失败。单用户场景下
 * 为一个备份失败挡住整次同步，代价大于收益。
 */
export const backupBaselineFile = async(): Promise<string | null> => {
  try {
    await fsp.copyFile(getBaselinePath(), `${getBaselinePath()}.legacy`)
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return `原基线备份失败（${message}），已继续迁移`
  }
}

export const clearBaseline = async() => {
  try {
    await fsp.unlink(getBaselinePath())
  } catch {}
}
