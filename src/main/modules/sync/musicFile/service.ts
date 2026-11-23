import { sendSyncAction } from '@main/modules/winMain'
import {
  applyExecutedToBaseline,
  buildActions,
  buildPlan,
  computeNextBaseline,
  getActionTargets,
  MUSIC_FILE_CHUNK_SIZE,
  normalizeScope,
  seedBaselineFromLegacy,
  type BaselineKey,
  type FileIndex,
  type TransferAction,
} from './diff'
import * as localFs from './localFs'
import { backupBaselineFile, loadBaselineState, saveBaseline } from './baseline'
import { getPeerRef, type MusicFilePeer } from './peer'
import { CANCELLED_MESSAGE, CancelledError, runActions } from './executor'
import log from './logger'

/** 两端的诊断日志都带上根目录与 scope，便于直接对照 */
const describeSide = (root: string, scope: readonly string[]) => `root=${root} scope=${JSON.stringify(scope)}`

/**
 * 基线绑定「对端配对 + 两端根目录」。
 * 本地根目录必须参与：换到空目录后如果沿用旧基线，对端仍有的文件会被判成「删除对端」。
 */
const getBaselineKey = (localRoot: string, remoteRoot: string, pairId: string): BaselineKey => ({ pairId, localRoot, remoteRoot })

const LEGACY_BASELINE_NOTICE = '检测到旧版同步基线，无法确认它属于哪台设备或哪个目录；已按两端当前都存在的文件重建基线。本次清单不做默认勾选，请复核后再同步。'

/**
 * 读取当前组合的基线；旧格式或损坏数据先做一次性迁移：
 * 只保留两端当前都存在的路径，避免旧目录的记忆把当前目录里对端仍有的文件判成删除。
 * 迁移前尽力备份；备份失败只记提示，不阻断（基线可重建，不值得为它挡住同步）。
 */
const loadBaselineFor = async(localIndex: FileIndex, remoteIndex: FileIndex, key: BaselineKey) => {
  const state = await loadBaselineState(key)
  if (state.status === 'missing') return { baseline: [], needsConfirm: false, pendingMigration: false, backupWarning: null }
  if (state.status === 'ok') {
    const pending = state.pendingMigration === true
    return { baseline: state.paths, needsConfirm: pending, pendingMigration: pending, backupWarning: null }
  }
  const seeded = seedBaselineFromLegacy(state.paths, localIndex, remoteIndex)
  const backupWarning = await backupBaselineFile()
  await saveBaseline(key, seeded, true)
  log.info('baseline', `migrated status=${state.status} pair=${key.pairId} raw=${state.paths.length} seeded=${seeded.length} backup=${backupWarning ?? 'ok'}`)
  return { baseline: seeded, needsConfirm: true, pendingMigration: true, backupWarning }
}

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

const requirePeer = async(): Promise<{ peer: MusicFilePeer, root: string, scope: string[], pairId: string, deviceName: string }> => {
  if (running) throw new Error('同步正在进行中')
  const ref = getPeerRef()
  if (!ref) throw new Error('未连接到对端设备，或对端版本不支持本地音乐同步')
  const root = localFs.getRootPath()
  if (!root) throw new Error('未设置同步歌曲存放路径')
  if (!await localFs.rootExists(root)) throw new Error('同步歌曲存放路径不存在')
  return { peer: ref.peer, root, scope: normalizeScope(localFs.getScope()), pairId: ref.pairId, deviceName: ref.deviceName }
}

/** 扫描两端并生成变更清单 */
export const compare = async(): Promise<LX.Sync.MusicFile.CompareResult> => {
  const { peer, root, scope, pairId } = await requirePeer()
  running = true
  updateProgress({ ...createProgress(), running: true, stage: 'comparing', message: '正在扫描本地文件…' })
  try {
    log.info('compare', `start role=initiator local(${describeSide(root, scope)})`)
    const localIndex = await localFs.scanIndex(root, scope)
    updateProgress({ message: '正在读取对端文件列表…' })
    const remoteRoot = await peer.musicFile_get_root()
    if (!remoteRoot) throw new Error('对端未设置同步歌曲存放路径')
    const remoteIndex = await peer.musicFile_get_index(scope)
    log.info('compare', `remote(${describeSide(remoteRoot, scope)}) folders=${remoteIndex.folders.length} files=${remoteIndex.files.length}`)
    const { baseline, needsConfirm, backupWarning } = await loadBaselineFor(localIndex, remoteIndex, getBaselineKey(root, remoteRoot, pairId))
    const plan = buildPlan(localIndex, remoteIndex, baseline)
    if (needsConfirm) {
      // 旧基线迁移/损坏恢复尚未确认：本次不做默认勾选，要求用户逐项复核，避免静默改变操作方向
      for (const items of Object.values(plan)) {
        for (const item of items) item.defaultChecked = false
      }
    }
    const notice = needsConfirm ? [LEGACY_BASELINE_NOTICE, backupWarning].filter(Boolean).join(' ') : undefined
    log.info('compare', `plan ${JSON.stringify(Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, v.length])))} baseline=${baseline.length} localFiles=${localIndex.files.length} remoteFiles=${remoteIndex.files.length}`)
    return { plan, localRoot: root, remoteRoot, notice }
  } finally {
    running = false
    updateProgress({ ...createProgress(), stage: 'idle', message: '' })
  }
}

const transferDownloadFile = async(peer: MusicFilePeer, root: string, relPath: string, onBytes: (bytes: number) => void) => {
  log.info('transfer', `download start relPath=${relPath} -> localRoot=${root}`)
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
  log.info('transfer', `download done relPath=${relPath} bytes=${offset}`)
}

const transferUploadFile = async(peer: MusicFilePeer, root: string, relPath: string, onBytes: (bytes: number) => void) => {
  log.info('transfer', `upload start relPath=${relPath} from localRoot=${root}`)
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
  log.info('transfer', `upload done relPath=${relPath} bytes=${offset}`)
}

/**
 * 全部动作的总字节数：音频 size + 每个伴生文件 size。
 * 删除动作不产生字节数（`sidecars` 不计入）。
 */
export const sumActionBytes = (actions: readonly TransferAction[]): number => {
  return actions.reduce((sum, action) => {
    if (action.kind !== 'download' && action.kind !== 'upload') return sum
    const sidecarBytes = action.sidecars.reduce((total, item) => total + item.size, 0)
    return sum + action.size + sidecarBytes
  }, 0)
}

/** 执行用户在清单中勾选的传输动作 */
export const apply = async(selection: LX.Sync.MusicFile.Selection): Promise<LX.Sync.MusicFile.ApplyResult> => {
  const { peer, root, scope, pairId } = await requirePeer()
  running = true
  cancelled = false
  const result: LX.Sync.MusicFile.ApplyResult = { downloaded: 0, uploaded: 0, deletedLocal: 0, deletedRemote: 0, errors: [] }
  try {
    updateProgress({ ...createProgress(), running: true, stage: 'comparing', message: '正在重新核对文件列表…' })
    log.info('apply', `start role=initiator local(${describeSide(root, scope)}) checked=${Object.keys(selection.checked ?? {}).length}`)
    const localIndex = await localFs.scanIndex(root, scope)
    const remoteRoot = await peer.musicFile_get_root()
    if (!remoteRoot) throw new Error('对端未设置同步歌曲存放路径')
    const remoteIndex = await peer.musicFile_get_index(scope)
    log.info('apply', `remote(${describeSide(remoteRoot, scope)}) folders=${remoteIndex.folders.length} files=${remoteIndex.files.length}`)
    const baselineKey = getBaselineKey(root, remoteRoot, pairId)
    const { baseline, pendingMigration } = await loadBaselineFor(localIndex, remoteIndex, baselineKey)
    const plan = buildPlan(localIndex, remoteIndex, baseline)
    const actions = buildActions(plan, selection.checked, selection.direction)
    log.info('apply', `actions=${actions.length} ${JSON.stringify(actions.map(a => `${a.kind}:${a.path}+${a.sidecars.length}`).slice(0, 200))}`)
    const totalBytes = sumActionBytes(actions)

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

    const run = await runActions(actions, {
      targetsOf: getActionTargets,
      download: async(relPath, onBytes) => transferDownloadFile(peer, root, relPath, onBytes),
      upload: async(relPath, onBytes) => transferUploadFile(peer, root, relPath, onBytes),
      deleteLocal: async(relPath) => localFs.deleteFile(root, relPath),
      // 不改 RPC 签名：对音频与每个伴生文件分别调用 delete_file(path, false)
      deleteRemote: async(relPath) => peer.musicFile_delete_file(relPath, false),
      isCancelled: () => cancelled,
      onActionStart: (action, index) => {
        updateProgress({ actionIndex: index + 1, kind: action.kind, path: action.path, fileBytes: 0 })
      },
      onActionDone: (action) => {
        switch (action.kind) {
          case 'download':
            result.downloaded++
            break
          case 'upload':
            result.uploaded++
            break
          case 'delete_local':
            result.deletedLocal++
            break
          case 'delete_remote':
            result.deletedRemote++
            break
        }
      },
      onActionError: (action, err) => {
        // 记录失败动作的类型与两端根目录，便于判断是“本地读”还是“远端读”出的问题
        const message = err instanceof Error ? err.message : String(err)
        log.err('apply', `action failed kind=${action.kind} path=${action.path} localRoot=${root} remoteRoot=${remoteRoot} err=${message}`)
        result.errors.push(`${action.path}: ${message}`)
        updateProgress({ errors: [...result.errors] })
      },
      onBytes: (bytes) => {
        doneBytes += bytes
        updateProgress({ fileBytes: progress.fileBytes + bytes, doneBytes })
      },
    })

    if (run.cancelled) {
      // 取消：只把已完成动作写回基线；未完成项保持原状态，下一轮继续提示
      await saveBaseline(baselineKey, applyExecutedToBaseline(baseline, run.executed), pendingMigration)
      updateProgress({ running: false, stage: 'error', message: CANCELLED_MESSAGE })
      throw new CancelledError()
    }

    updateProgress({ stage: 'finishing', message: '正在更新同步基线…' })
    const finalLocal = await localFs.scanIndex(root, scope)
    const finalRemote = await peer.musicFile_get_index(scope)
    // 执行完成视为用户已确认迁移结果，清除待确认标记
    await saveBaseline(baselineKey, computeNextBaseline(baseline, run.executed, finalLocal, finalRemote, scope), false)
    log.info('apply', `done downloaded=${result.downloaded} uploaded=${result.uploaded} deletedLocal=${result.deletedLocal} deletedRemote=${result.deletedRemote} errors=${result.errors.length}`)

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
export const getIndex = async(scope: string[]) => {
  const root = localFs.getRootPath()
  log.info('rpc', `getIndex called by peer localRoot=${root} scope=${JSON.stringify(scope ?? [])}`)
  return localFs.scanIndex(root, normalizeScope(scope ?? []))
}

/** 协议：读取本机文件分片 */
export const readChunk = async(relPath: string, offset: number, size: number) => {
  // 对端请求读取本机文件：这条日志能直接回答“到底是谁在找哪个文件”
  log.info('rpc', `readChunk called by peer relPath=${relPath} offset=${offset} size=${size} localRoot=${localFs.getRootPath()}`)
  return localFs.readFileChunk(localFs.getRootPath(), relPath, offset, size)
}

/** 协议：写入本机文件分片 */
export const writeChunk = async(relPath: string, offset: number, data: string, isLast: boolean) => {
  log.info('rpc', `writeChunk called by peer relPath=${relPath} offset=${offset} isLast=${isLast} localRoot=${localFs.getRootPath()}`)
  return localFs.writeFileChunk(localFs.getRootPath(), relPath, offset, data, isLast)
}

/** 协议：删除本机文件 */
export const removeFile = async(relPath: string, withLyric: boolean) => {
  log.info('rpc', `deleteFile called by peer relPath=${relPath} withLyric=${withLyric} localRoot=${localFs.getRootPath()}`)
  return localFs.deleteFileWithLyric(localFs.getRootPath(), relPath, withLyric)
}
