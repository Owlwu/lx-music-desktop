import { getSocket } from '../client/client'

/** 本地音乐文件同步只需要这几个远端方法，两种角色的 socket.remote 都具备 */
export interface MusicFilePeer {
  musicFile_get_root: () => Promise<string>
  musicFile_get_index: (scope: string[]) => Promise<LX.Sync.MusicFile.FileIndex>
  musicFile_read_file: (path: string, offset: number, size: number) => Promise<LX.Sync.MusicFile.ReadFileResult>
  musicFile_write_file: (path: string, offset: number, data: string, isLast: boolean) => Promise<void>
  musicFile_delete_file: (path: string, withLyric: boolean) => Promise<void>
}

interface ReadyClientSocket {
  moduleReadys?: { musicFile?: boolean }
  remote: MusicFilePeer
  keyInfo: { clientId?: string, deviceName: string }
}

/** 对端引用：peer 与「配对标识」必须来自同一次连接解析，避免扫描期间连接列表变化导致错配 */
export interface MusicFilePeerRef {
  peer: MusicFilePeer
  /** 稳定标识：服务端模式用客户端 clientId，客户端模式用服务端名 + 地址 */
  pairId: string
  deviceName: string
}

/**
 * 服务端已就绪的客户端连接列表，延迟到调用时才解析。
 *
 * `../server/server` 会经由 server 的 modules 间接加载本文件
 * （`server/modules/index.ts` 在模块初始化阶段就读取文件同步的 handler），
 * 若在模块顶层静态导入它就会形成初始化环，导致启动时报
 * `Cannot access 'musicFile_handler' before initialization`。
 * 这里只在真正需要时才 require，保证模块图先完成初始化。
 */
const getReadyClientSockets = (): ReadyClientSocket[] => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports
  const server = require('../server/server') as typeof import('../server/server')
  return server.getReadyClientSockets() as unknown as ReadyClientSocket[]
}

/**
 * 找到当前用于传输文件的对端连接，并一次性取出配对标识。
 *
 * - 本机作为同步服务端时：取第一个已就绪的客户端连接，用它的 clientId 做配对；
 * - 本机作为同步客户端时：取自身连接，用服务端名 + 地址做配对（两者变化视为换端）。
 */
export const getPeerRef = (): MusicFilePeerRef | null => {
  if (global.lx.appSetting['sync.mode'] === 'server') {
    const socket = getReadyClientSockets().find(client => client.moduleReadys?.musicFile)
    if (!socket) return null
    const clientId = socket.keyInfo.clientId ?? ''
    return {
      peer: socket.remote,
      // 旧版本对端可能没有 clientId，退回设备名，至少同名设备仍可能共用基线
      pairId: `client:${clientId || socket.keyInfo.deviceName}`,
      deviceName: socket.keyInfo.deviceName,
    }
  }
  const socket = getSocket()
  if (!socket?.isReady || !socket.moduleReadys?.musicFile) return null
  const { serverName } = socket.data.keyInfo
  return {
    peer: socket.remote,
    pairId: `server:${serverName}@${socket.data.urlInfo.hostPath}`,
    deviceName: serverName,
  }
}

export const getPeer = (): MusicFilePeer | null => getPeerRef()?.peer ?? null

export const getPeerDeviceName = (): string => getPeerRef()?.deviceName ?? ''
