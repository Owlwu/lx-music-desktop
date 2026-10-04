import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  assertSafeRelPath,
  buildIndex,
  isAudioFileName,
  type FileIndex,
  type ScanEntry,
} from './diff'

/** 递归扫描的最大深度，防止异常目录结构导致栈溢出 */
const MAX_SCAN_DEPTH = 32

export const getRootPath = () => (global.lx.appSetting['sync.musicFile.root'] ?? '').trim()

/** 把协议的相对路径还原成本机绝对路径（含安全校验） */
export const toAbsPath = (root: string, relPath: string) => {
  assertSafeRelPath(relPath)
  return path.join(root, ...relPath.split('/'))
}

const readDirEntries = async(dirPath: string) => {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

/** 扫描根目录下所有音频文件（返回原始条目，由 buildIndex 完成整理） */
export const scanEntries = async(root: string): Promise<ScanEntry[]> => {
  const entries: ScanEntry[] = []
  const walk = async(absDir: string, relDir: string, depth: number) => {
    if (depth > MAX_SCAN_DEPTH) return
    const dirents = await readDirEntries(absDir)
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue
      const name = dirent.name
      const relPath = relDir.length ? `${relDir}/${name}` : name
      if (dirent.isDirectory()) {
        await walk(path.join(absDir, name), relPath, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      if (!isAudioFileName(name)) continue
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

export const scanIndex = async(root: string): Promise<FileIndex> => {
  if (!root) throw new Error('music file root is empty')
  return buildIndex(await scanEntries(root))
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

export const rootExists = async(root: string) => {
  if (!root) return false
  try {
    const stat = await fsp.stat(root)
    return stat.isDirectory()
  } catch {
    return false
  }
}
