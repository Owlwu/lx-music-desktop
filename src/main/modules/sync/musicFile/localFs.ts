import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  assertSafeRelPath,
  buildIndex,
  canonicalizeRelPath,
  getLyricRelPath,
  getRelDir,
  isAudioFileName,
  isLyricFileName,
  shortenRelPath,
  type FileIndex,
  type ScanEntry,
} from './diff'
import log from './logger'

/** 递归扫描的最大深度，防止异常目录结构导致栈溢出 */
const MAX_SCAN_DEPTH = 32

export const getRootPath = () => (global.lx.appSetting['sync.musicFile.root'] ?? '').trim()

export const getScope = (): string[] => global.lx.appSetting['sync.musicFile.scope'] ?? []

/** 把协议的相对路径还原成本机绝对路径（含安全校验） */
export const toAbsPath = (root: string, relPath: string) => {
  assertSafeRelPath(relPath)
  return path.join(root, ...relPath.split('/'))
}

/**
 * 索引统一用 NFC 规范路径，但磁盘上的名字可能是等价的 NFD 形式。
 *
 * NTFS 按字面存储：`ほ`（U+307C）与 `ほ+゙`（U+307B U+3099）是两个不同的名字，
 * 用 NFC 路径打不开 NFD 文件。而且 NFC/NFD 可以**逐段混合**（顶层目录是 NFD、
 * 文件名是 NFC，或反过来），所以一次性把整条路径换成 NFC 或 NFD 都不够，
 * 必须逐段解析：每一段先在目录里找 NFC 写法，找不到再找 NFD 写法。
 *
 * 目录解析结果按下标缓存：同步时路径是聚集的，避免每片都重新遍历目录。
 */
const dirNameCache = new Map<string, string[]>()

const readDirNames = async(dir: string): Promise<string[]> => {
  const cached = dirNameCache.get(dir)
  if (cached) return cached
  let names: string[] = []
  try {
    names = (await fsp.readdir(dir, { withFileTypes: true })).map(entry => entry.name)
  } catch {
    names = []
  }
  if (dirNameCache.size > 512) dirNameCache.clear()
  dirNameCache.set(dir, names)
  return names
}

/** 按段解析出磁盘上真实存在的绝对路径；找不到返回 null */
const resolveExistingAbsPath = async(root: string, relPath: string): Promise<string | null> => {
  let current = root
  for (const segment of canonicalizeRelPath(relPath).split('/')) {
    const names = await readDirNames(current)
    // 同一段可能以多种等价写法存在于磁盘上，按「字面 -> NFC -> NFD -> NFKC」依次匹配。
    // NFKC 用于兼容写法（例如半角 `!` 与全角 `！` 是两个不同的目录名）。
    const exact = names.includes(segment)
      ? segment
      : names.find(name => name.normalize('NFC') === segment)
        ?? names.find(name => name.normalize('NFD') === segment.normalize('NFD'))
        ?? names.find(name => name.normalize('NFKC') === segment.normalize('NFKC'))
        ?? null
    if (exact == null) return null
    current = path.join(current, exact)
  }
  return current
}

/** 写入时统一用 NFC 名字，避免再产生新的等价写法 */
const toWriteAbsPath = (root: string, relPath: string) => toAbsPath(root, canonicalizeRelPath(relPath))

/** 该文件夹是否可能包含 scope 内的文件 */
const dirAllowed = (relDir: string, scope: readonly string[]) => {
  if (!scope.length) return true
  if (!relDir.length) return true
  return scope.some(folder => relDir === folder || relDir.startsWith(folder + '/') || folder.startsWith(relDir + '/'))
}

const readDirEntries = async(dirPath: string) => {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true })
  } catch (err: any) {
    log.warn('scan', `readdir failed path=${dirPath} err=${err?.message ?? err}`)
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
      } catch (err: any) {
        // 文件在扫描过程中被删除等情况：忽略，但要留痕
        log.warn('scan', `stat failed during scan relPath=${relPath} abs=${path.join(absDir, name)} err=${err?.message ?? err}`)
      }
    }
  }
  await walk(root, '', 0)
  return entries
}

export const scanIndex = async(root: string, scope: readonly string[] = getScope()): Promise<FileIndex> => {
  if (!root) throw new Error('music file root is empty')
  log.info('scan', `root=${root} scope=${JSON.stringify(scope)}`)
  const entries = await scanEntries(root, scope)
  const index = buildIndex(entries)
  log.info('scan', `done root=${root} entries=${entries.length} folders=${index.folders.length} files=${index.files.length}`)
  return index
}

/** 扫描根目录下的文件夹树，附带音频数量，用于同步范围选择 */
export const scanFolderTree = async(root: string): Promise<LX.Sync.MusicFile.FolderNode[]> => {
  log.info('scanTree', `root=${root}`)
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
  const tree = await build(root, '')
  log.info('scanTree', `done root=${root} folders=${tree.length}`)
  return tree
}

/**
 * 读取失败时尽量还原现场：文件是否还在、父目录有什么。
 * 这类信息是排查 ENOENT（路径对不上）最关键的证据。
 */
const describeReadFailure = async(absPath: string, root: string, relPath: string) => {
  const relDir = getRelDir(relPath)
  const absDir = relDir ? path.join(root, ...relDir.split('/')) : root
  const parts: string[] = [
    `root=${root}`,
    `relPath=${relPath}`,
    `absPath=${absPath}`,
    `rootExists=${await rootExists(root)}`,
    `parentDir=${absDir}`,
  ]
  parts.push(`parentDirExists=${fs.existsSync(absDir)}`)
  const siblings = await readDirEntries(absDir)
  parts.push(`parentEntryCount=${siblings.length}`)
  parts.push(`parentEntries=${JSON.stringify(siblings.slice(0, 50).map(item => item.name))}`)
  return parts.join(' ')
}

/** 打开一个用于分片读取的句柄：逐段解析出磁盘上的真实路径 */
const openForRead = async(root: string, relPath: string): Promise<{ handle: fsp.FileHandle, absPath: string }> => {
  const resolved = await resolveExistingAbsPath(root, relPath)
  const target = resolved ?? toAbsPath(root, relPath)
  return { handle: await fsp.open(target, 'r'), absPath: target }
}

/** 读取一个 base64 分片 */
export const readFileChunk = async(root: string, relPath: string, offset: number, size: number): Promise<LX.Sync.MusicFile.ReadFileResult> => {
  let handle: fsp.FileHandle
  let absPath: string
  try {
    ({ handle, absPath } = await openForRead(root, relPath))
  } catch (err: any) {
    log.err('read', `open failed: ${await describeReadFailure(toAbsPath(root, relPath), root, relPath)} err=${err?.message ?? err}`)
    throw err
  }
  try {
    const stat = await handle.stat()
    const start = Math.max(0, Math.min(offset, stat.size))
    const length = Math.max(0, Math.min(size, stat.size - start))
    const buffer = Buffer.alloc(length)
    if (length > 0) await handle.read(buffer, 0, length, start)
    log.info('read', `ok relPath=${relPath} absPath=${absPath} offset=${start} length=${length} total=${stat.size} eof=${start + length >= stat.size}`)
    return { data: buffer.toString('base64'), eof: start + length >= stat.size }
  } catch (err: any) {
    log.err('read', `read failed: offset=${offset} size=${size} ${await describeReadFailure(absPath, root, relPath)} err=${err?.message ?? err}`)
    throw err
  } finally {
    await handle.close()
  }
}

/**
 * 写入一个 base64 分片：offset 为 0 时重建文件，之后顺序追加。
 *
 * 单个路径名上限 255 字节（UTF-8），日文/中文长标题很容易超过，
 * 直写会抛 ENAMETOOLONG 让整个文件同步失败。因此落盘时统一压限：
 * 名字取自原始全名的短哈希，所以同名文件在任何一次同步里都得到同一个名字。
 */
export const writeFileChunk = async(root: string, relPath: string, offset: number, data: string, isLast: boolean) => {
  const outRelPath = shortenRelPath(canonicalizeRelPath(relPath))
  const absPath = toWriteAbsPath(root, outRelPath)
  const buffer = Buffer.from(data, 'base64')
  try {
    if (offset === 0) {
      await fsp.mkdir(path.dirname(absPath), { recursive: true })
      await fsp.writeFile(absPath, buffer)
      log.info('write', `create relPath=${outRelPath} bytes=${buffer.length} isLast=${isLast}`)
      return
    }
    await fsp.appendFile(absPath, buffer)
    log.info('write', `append relPath=${outRelPath} offset=${offset} bytes=${buffer.length} isLast=${isLast}`)
  } catch (err: any) {
    log.err('write', `failed: offset=${offset} ${await describeReadFailure(absPath, root, outRelPath)} err=${err?.message ?? err}`)
    throw err
  }
  void isLast
}

/**
 * 删除文件；withLyric 为真时同时删除伴生 .lrc
 *
 * 磁盘上的名字可能是 NFD，且各段形式可混合，因此逐段解析；
 * 解析不到时再补一次「整条转 NFD」的兜底，避免留下残file。
 */
export const deleteFileWithLyric = async(root: string, relPath: string, withLyric: boolean) => {
  const outRelPath = shortenRelPath(canonicalizeRelPath(relPath))
  log.info('delete', `relPath=${outRelPath} withLyric=${withLyric}`)
  const targets = [outRelPath]
  if (withLyric) targets.push(shortenRelPath(canonicalizeRelPath(getLyricRelPath(relPath))))
  for (const target of targets) {
    const resolved = await resolveExistingAbsPath(root, target)
    if (resolved) await removeIfExists(resolved)
    else {
      await removeIfExists(toAbsPath(root, target))
      await removeIfExists(toAbsPath(root, target.split('/').map(segment => segment.normalize('NFD')).join('/')))
    }
  }
}

const removeIfExists = async(absPath: string) => {
  try {
    await fsp.unlink(absPath)
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      log.err('delete', `unlink failed absPath=${absPath} err=${err?.message ?? err}`)
      throw err
    }
    log.info('delete', `skip missing absPath=${absPath}`)
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
