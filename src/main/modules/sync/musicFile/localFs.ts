import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  assertSafeRelPath,
  buildIndex,
  getLyricRelPath,
  getRelDir,
  isAudioFileName,
  isLyricFileName,
  normalizeRelPath,
  type FileIndex,
  type ScanEntry,
} from './diff'

/** 递归扫描的最大深度，防止异常目录结构导致栈溢出 */
const MAX_SCAN_DEPTH = 32

export const getRootPath = () => (global.lx.appSetting['sync.musicFile.root'] ?? '').trim()

export const getScope = (): string[] => global.lx.appSetting['sync.musicFile.scope'] ?? []

/** 把协议的相对路径还原成本机绝对路径（含安全校验） */
export const toAbsPath = (root: string, relPath: string) => {
  assertSafeRelPath(relPath)
  return path.join(root, ...relPath.split('/'))
}

/** 该文件夹是否可能包含 scope 内的文件 */
const dirAllowed = (relDir: string, scope: readonly string[]) => {
  if (!scope.length) return true
  if (!relDir.length) return true
  return scope.some(folder => relDir === folder || relDir.startsWith(folder + '/') || folder.startsWith(relDir + '/'))
}

const readDirEntries = async(dirPath: string) => {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 扫描 scope 内所有文件夹下的音频与歌词文件（返回原始条目，由 buildIndex 完成配对） */
export const scanEntries = async(root: string, scope: readonly string[] = getScope()): Promise<ScanEntry[]> => {
  const entries: ScanEntry[] = []
  const walk = async(absDir: string, relDir: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH) return
    const dirents = await readDirEntries(absDir)
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue
      const name = dirent.name
      const relPath = relDir.length ? `${relDir}/${name}` : name
      if (dirent.isDirectory()) {
        if (!dirAllowed(relPath, scope)) continue
        await walk(path.join(absDir, name), relPath, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      if (!isAudioFileName(name) && !isLyricFileName(name)) continue
      try {
        const stat = await fsp.stat(path.join(absDir, name))
        entries.push({ path: relPath, size: stat.size, mtime: stat.mtimeMs })
      } catch {
        // 文件在扫描过程中被删除等情况：忽略
      }
    }
  }
  await walk(root, '', 0)
  return entries
}

export const scanIndex = async(root: string, scope: readonly string[] = getScope()): Promise<FileIndex> => {
  if (!root) throw new Error('music file root is empty')
  return buildIndex(await scanEntries(root, scope))
}

/** 扫描根目录下的文件夹树，附带音频数量，用于同步范围选择 */
export const scanFolderTree = async(root: string): Promise<LX.Sync.MusicFile.FolderNode[]> => {
  const build = async(absDir: string, relDir: string): Promise<LX.Sync.MusicFile.FolderNode[]> => {
    const dirents = await readDirEntries(absDir)
    const nodes: LX.Sync.MusicFile.FolderNode[] = []
    for (const dirent of dirents) {
      if (!dirent.isDirectory() || dirent.isSymbolicLink()) continue
      const relPath = relDir.length ? `${relDir}/${dirent.name}` : dirent.name
      const children = await build(path.join(absDir, dirent.name), relPath)
      const own = (await readDirEntries(path.join(absDir, dirent.name)))
        .filter(file => file.isFile() && isAudioFileName(file.name))
        .length
      nodes.push({
        name: dirent.name,
        path: relPath,
        audioCount: own,
        totalCount: own + children.reduce((sum, child) => sum + child.totalCount, 0),
        children,
      })
    }
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    return nodes
  }
  return build(root, '')
}

/** 读取一个 base64 分片 */
export const readFileChunk = async(root: string, relPath: string, offset: number, size: number): Promise<LX.Sync.MusicFile.ReadFileResult> => {
  const absPath = toAbsPath(root, relPath)
  const handle = await fsp.open(absPath, 'r')
  try {
    const stat = await handle.stat()
    const start = Math.max(0, Math.min(offset, stat.size))
    const length = Math.max(0, Math.min(size, stat.size - start))
    const buffer = Buffer.alloc(length)
    if (length > 0) await handle.read(buffer, 0, length, start)
    return { data: buffer.toString('base64'), eof: start + length >= stat.size }
  } finally {
    await handle.close()
  }
}

/** 写入一个 base64 分片：offset 为 0 时重建文件，之后顺序追加 */
export const writeFileChunk = async(root: string, relPath: string, offset: number, data: string, isLast: boolean) => {
  const absPath = toAbsPath(root, relPath)
  const buffer = Buffer.from(data, 'base64')
  if (offset === 0) {
    await fsp.mkdir(path.dirname(absPath), { recursive: true })
    await fsp.writeFile(absPath, buffer)
    return
  }
  await fsp.appendFile(absPath, buffer)
  void isLast
}

/** 删除文件；withLyric 为真时同时删除伴生 .lrc */
export const deleteFileWithLyric = async(root: string, relPath: string, withLyric: boolean) => {
  const absPath = toAbsPath(root, relPath)
  await removeIfExists(absPath)
  if (withLyric) await removeIfExists(toAbsPath(root, getLyricRelPath(relPath)))
}

/** 读取本机某个相对路径对应的绝对路径（仅用于日志/展示） */
export const describePath = (root: string, relPath: string) => path.join(root, ...normalizeRelPath(relPath).split('/'))

export const relDirOf = getRelDir

const removeIfExists = async(absPath: string) => {
  try {
    await fsp.unlink(absPath)
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
}

export const rootExists = async(root: string) => {
  if (!root) return false
  try {
    const stat = await fs.promises.stat(root)
    return stat.isDirectory()
  } catch {
    return false
  }
}
