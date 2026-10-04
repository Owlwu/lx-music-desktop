import { sendSyncAction } from '@main/modules/winMain'
import {
  buildActions,
  buildBaseline,
  buildPlan,
  MUSIC_FILE_CHUNK_SIZE,
  normalizeScope,
  type TransferAction,
} from './diff'
import * as localFs from './localFs'
import { loadBaseline, saveBaseline } from './baseline'
import { getPeer, type MusicFilePeer } from './peer'

const createProgress = (): LX.Sync.MusicFile.Progress => ({
  running: false,
  stage: 'idle',
  kind: '',
  path: '',
  actionIndex: 0,
  actionTotal: 0,
  fileBytes: 0,
  fileBytesTotal: 0,
  totalBytes: 0,
  doneBytes: 0,
  message: '',
  errors: [],
})

let progress = createProgress()
let running = false
let cancelled = false

const updateProgress = (patch: Partial<LX.Sync.MusicFile.Progress>) => {
  progress = { ...progress, ...patch }
  sendSyncAction({ action: 'musicFile_progress', data: { ...progress } })
}

export const getProgress = () => ({ ...progress })

export const getConfig = (): LX.Sync.MusicFile.Config => ({
  root: localFs.getRootPath(),
  scope: localFs.getScope(),
})

export const getFolders = async() => {
  const root = localFs.getRootPath()
  if (!root) throw new Error('未设置同步歌曲存放路径')
  if (!await localFs.rootExists(root)) throw new Error('同步歌曲存放路径不存在')
  return localFs.scanFolderTree(root)
}

const requirePeer = async(): Promise<{ peer: MusicFilePeer, root: string, scope: string[] }> => {
  if (running) throw new Error('同步正在进行中')
  const peer = getPeer()
  if (!peer) throw new Error('未连接到对端设备，或对端版本不支持本地音乐同步')
  const root = localFs.getRootPath()
  if (!root) throw new Error('未设置同步歌曲存放路径')
  if (!await localFs.rootExists(root)) throw new Error('同步歌曲存放路径不存在')
  return { peer, root, scope: normalizeScope(localFs.getScope()) }
}

/** 扫描两端并生成变更清单 */
export const compare = async(): Promise<LX.Sync.MusicFile.CompareResult> => {
  const { peer, root, scope } = await requirePeer()
  running = true
  updateProgress({ ...createProgress(), running: true, stage: 'comparing', message: '正在扫描本地文件…' })
  try {
    const localIndex = await localFs.scanIndex(root, scope)
    updateProgress({ message: '正在读取对端文件列表…' })
    const remoteRoot = await peer.musicFile_get_root()
    if (!remoteRoot) throw new Error('对端未设置同步歌曲存放路径')
    const remoteIndex = await peer.musicFile_get_index(scope)
    const baseline = await loadBaseline()
    const plan = buildPlan(localIndex, remoteIndex, baseline)
    return { plan, localRoot: root, remoteRoot }
  } finally {
    running = false
    updateProgress({ ...createProgress(), stage: 'idle', message: '' })
  }
}

const transferDownloadFile = async(peer: MusicFilePeer, root: string, relPath: string, onBytes: (bytes: number) => void) => {
  let offset = 0
  for (;;) {
    if (cancelled) throw new Error('已取消')
    const chunk = await peer.musicFile_read_file(relPath, offset, MUSIC_FILE_CHUNK_SIZE)
    const size = Buffer.from(chunk.data, 'base64').length
    await localFs.writeFileChunk(root, relPath, offset, chunk.data, chunk.eof)
    offset += size
    onBytes(size)
    if (chunk.eof) break
    if (size === 0) break
  }
}

const transferUploadFile = async(peer: MusicFilePeer, root: string, relPath: string, onBytes: (bytes: number) => void) => {
  let offset = 0
  for (;;) {
    if (cancelled) throw new Error('已取消')
    const chunk = await localFs.readFileChunk(root, relPath, offset, MUSIC_FILE_CHUNK_SIZE)
    const size = Buffer.from(chunk.data, 'base64').length
    await peer.musicFile_write_file(relPath, offset, chunk.data, chunk.eof)
    offset += size
    onBytes(size)
    if (chunk.eof) break
    if (size === 0) break
  }
}

const lyricRelPath = (relPath: string) => {
  const index = relPath.lastIndexOf('.')
  return (index > 0 ? relPath.substring(0, index) : relPath) + '.lrc'
}

/** 按相对路径索引伴生歌词的大小，用于把歌词算进进度总量 */
const buildLyricSizeMap = (index: LX.Sync.MusicFile.FileIndex) => {
  const map = new Map<string, number>()
  for (const file of index.files) map.set(file.path, file.lyric?.size ?? 0)
  return map
}

/** 执行用户在清单中勾选的传输动作 */
export const apply = async(selection: LX.Sync.MusicFile.Selection): Promise<LX.Sync.MusicFile.ApplyResult> => {
  const { peer, root, scope } = await requirePeer()
  running = true
  cancelled = false
  const result: LX.Sync.MusicFile.ApplyResult = { downloaded: 0, uploaded: 0, deletedLocal: 0, deletedRemote: 0, errors: [] }
  try {
    updateProgress({ ...createProgress(), running: true, stage: 'comparing', message: '正在重新核对文件列表…' })
    const localIndex = await localFs.scanIndex(root, scope)
    const remoteRoot = await peer.musicFile_get_root()
    if (!remoteRoot) throw new Error('对端未设置同步歌曲存放路径')
    const remoteIndex = await peer.musicFile_get_index(scope)
    const plan = buildPlan(localIndex, remoteIndex, await loadBaseline())
    const actions = buildActions(plan, selection.checked, selection.direction)
    const localLyricSizes = buildLyricSizeMap(localIndex)
    const remoteLyricSizes = buildLyricSizeMap(remoteIndex)
    const totalBytes = actions.reduce((sum, action) => {
      if (!('size' in action)) return sum
      const lyricSizes = action.kind === 'download' ? remoteLyricSizes : localLyricSizes
      return sum + action.size + (action.hasLyric ? lyricSizes.get(action.path) ?? 0 : 0)
    }, 0)

    let doneBytes = 0
    updateProgress({
      running: true,
      stage: 'transferring',
      actionIndex: 0,
      actionTotal: actions.length,
      totalBytes,
      doneBytes: 0,
      errors: [],
      message: '',
    })

    const targetsOf = (action: TransferAction) => {
      const list = [action.path]
      if (action.hasLyric) list.push(lyricRelPath(action.path))
      return list
    }

    for (let index = 0; index < actions.length; index++) {
      const action = actions[index]
      updateProgress({ actionIndex: index + 1, kind: action.kind, path: action.path, fileBytes: 0 })
      try {
        switch (action.kind) {
          case 'download':
            for (const target of targetsOf(action)) {
              await transferDownloadFile(peer, root, target, (bytes) => {
                doneBytes += bytes
                updateProgress({ fileBytes: progress.fileBytes + bytes, doneBytes })
              })
            }
            result.downloaded++
            break
          case 'upload':
            for (const target of targetsOf(action)) {
              await transferUploadFile(peer, root, target, (bytes) => {
                doneBytes += bytes
                updateProgress({ fileBytes: progress.fileBytes + bytes, doneBytes })
              })
            }
            result.uploaded++
            break
          case 'delete_local':
            await localFs.deleteFileWithLyric(root, action.path, action.hasLyric)
            result.deletedLocal++
            break
          case 'delete_remote':
            await peer.musicFile_delete_file(action.path, action.hasLyric)
            result.deletedRemote++
            break
        }
      } catch (err: any) {
        if (cancelled) throw err
        const message = `${action.path}: ${err?.message ?? err}`
        result.errors.push(message)
        updateProgress({ errors: [...result.errors] })
      }
    }

    updateProgress({ stage: 'finishing', message: '正在更新同步基线…' })
    const finalLocal = await localFs.scanIndex(root, scope)
    const finalRemote = await peer.musicFile_get_index(scope)
    await saveBaseline(buildBaseline(finalLocal, finalRemote))

    updateProgress({
      running: false,
      stage: result.errors.length ? 'error' : 'done',
      kind: '',
      path: '',
      message: result.errors.length ? `完成，但有 ${result.errors.length} 个文件失败` : '同步完成',
    })
    return result
  } finally {
    running = false
    // 出现意外异常时也要让界面上的进度条停下来
    if (progress.running) updateProgress({ running: false, stage: 'error' })
  }
}

export const cancel = () => {
  if (!running) return
  cancelled = true
  updateProgress({ message: '正在取消…' })
}

/** 协议：返回本机根目录（供对端展示） */
export const getRoot = () => localFs.getRootPath()

/** 协议：按 scope 扫描本机索引 */
export const getIndex = (scope: string[]) => localFs.scanIndex(localFs.getRootPath(), normalizeScope(scope ?? []))

/** 协议：读取本机文件分片 */
export const readChunk = (relPath: string, offset: number, size: number) => localFs.readFileChunk(localFs.getRootPath(), relPath, offset, size)

/** 协议：写入本机文件分片 */
export const writeChunk = (relPath: string, offset: number, data: string, isLast: boolean) => localFs.writeFileChunk(localFs.getRootPath(), relPath, offset, data, isLast)

/** 协议：删除本机文件 */
export const removeFile = (relPath: string, withLyric: boolean) => localFs.deleteFileWithLyric(localFs.getRootPath(), relPath, withLyric)
