import { getSocket } from '../client/client'
import { getReadyClientSockets } from '../server/server'

/** 本地音乐文件同步只需要这几个远端方法，两种角色的 socket.remote 都具备 */
export interface MusicFilePeer {
  musicFile_get_root: () => Promise<string>
  musicFile_get_index: (scope: string[]) => Promise<LX.Sync.MusicFile.FileIndex>
  musicFile_read_file: (path: string, offset: number, size: number) => Promise<LX.Sync.MusicFile.ReadFileResult>
  musicFile_write_file: (path: string, offset: number, data: string, isLast: boolean) => Promise<void>
  musicFile_delete_file: (path: string) => Promise<void>
}

/**
 * 找到当前用于传输文件的对端连接：
 * - 本机作为同步服务端时，取第一个已就绪的客户端连接
 * - 本机作为同步客户端时，取自身连接
 */
export const getPeer = (): MusicFilePeer | null => {
  if (global.lx.appSetting['sync.mode'] === 'server') {
    const socket = getReadyClientSockets().find(client => client.moduleReadys?.musicFile)
    return socket ? socket.remote : null
  }
  const socket = getSocket()
  if (!socket?.isReady || !socket.moduleReadys?.musicFile) return null
  return socket.remote
}

export const getPeerDeviceName = (): string => {
  if (global.lx.appSetting['sync.mode'] === 'server') {
    return getReadyClientSockets().find(client => client.moduleReadys?.musicFile)?.keyInfo.deviceName ?? ''
  }
  return getSocket()?.data.keyInfo.serverName ?? ''
}
