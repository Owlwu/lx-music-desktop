import type { ExecutedAction, TransferAction } from './diff'

export const CANCELLED_MESSAGE = '已取消'

/** 用户取消：与普通失败区分，取消不记入错误列表，也不再开始后续动作 */
export class CancelledError extends Error {
  constructor() {
    super(CANCELLED_MESSAGE)
    this.name = 'CancelledError'
  }
}

export interface ActionOps {
  /** 一个动作要处理的路径：音频 + 伴生歌词/封面（由调用方传入，保持本模块无运行时依赖） */
  targetsOf: (action: TransferAction) => string[]
  download: (relPath: string, onBytes: (bytes: number) => void) => Promise<void>
  upload: (relPath: string, onBytes: (bytes: number) => void) => Promise<void>
  deleteLocal: (relPath: string) => Promise<void>
  deleteRemote: (relPath: string) => Promise<void>
  isCancelled: () => boolean
  onActionStart?: (action: TransferAction, index: number) => void
  onActionDone?: (action: TransferAction) => void
  onActionError?: (action: TransferAction, err: unknown) => void
  onBytes?: (bytes: number) => void
}

export interface ActionRunResult {
  /** 已开始的动作结果；取消/失败的动作也会记录（ok=false） */
  executed: ExecutedAction[]
  /** 失败动作的错误描述 */
  errors: string[]
  /** 是否因用户取消而提前结束 */
  cancelled: boolean
}

/**
 * 顺序执行传输/删除动作。
 *
 * 取消语义：每个动作开始前、每个目标（音频 / 伴生文件）处理前都检查一次，
 * 命中后立即结束，不开始新的动作；已完成的动作保留在 `executed` 里，
 * 由调用方据 `ok` 决定是否写回基线。
 */
export const runActions = async(actions: readonly TransferAction[], ops: ActionOps): Promise<ActionRunResult> => {
  const result: ActionRunResult = { executed: [], errors: [], cancelled: false }

  for (let index = 0; index < actions.length; index++) {
    const action = actions[index]
    if (ops.isCancelled()) {
      result.cancelled = true
      return result
    }
    ops.onActionStart?.(action, index)
    try {
      for (const target of ops.targetsOf(action)) {
        if (ops.isCancelled()) {
          result.cancelled = true
          return result
        }
        switch (action.kind) {
          case 'download':
            await ops.download(target, (bytes) => ops.onBytes?.(bytes))
            break
          case 'upload':
            await ops.upload(target, (bytes) => ops.onBytes?.(bytes))
            break
          case 'delete_local':
            await ops.deleteLocal(target)
            break
          case 'delete_remote':
            await ops.deleteRemote(target)
            break
        }
      }
      result.executed.push({ kind: action.kind, path: action.path, ok: true })
      ops.onActionDone?.(action)
    } catch (err) {
      // 传输中途被取消：按取消处理，不记成失败
      if (err instanceof CancelledError || ops.isCancelled()) {
        result.cancelled = true
        return result
      }
      ops.onActionError?.(action, err)
      result.errors.push(`${action.path}: ${err instanceof Error ? err.message : String(err)}`)
      result.executed.push({ kind: action.kind, path: action.path, ok: false })
    }
  }

  return result
}
