// 这个文件导出的方法将暴露给对方设备调用，第一个参数固定为当前 socket 对象
import { getIndex, getRoot, readChunk, writeChunk } from './service'

type HandlerSocket = LX.Sync.Client.Socket | LX.Sync.Server.Socket

/** 握手没有完成前拒绝一切文件读写，避免半握手状态被对端驱动 */
const assertReady = (socket: HandlerSocket) => {
  if (!socket.moduleReadys?.musicFile) throw new Error('musicFile feature is not ready')
}

/**
 * 两种角色都实现同一组方法：握手阶段不做任何传输，
 * 实际的文件读写由用户在某端的界面手动发起同步时调用。
 */
const handler: LX.Sync.ClientSyncHandlerMusicFilePeerActions<HandlerSocket> = {
  async musicFile_get_root(socket) {
    assertReady(socket)
    return getRoot()
  },

  async musicFile_get_index(socket) {
    assertReady(socket)
    return getIndex()
  },

  async musicFile_read_file(socket, path, offset, size) {
    assertReady(socket)
    return readChunk(path, offset, size)
  },

  async musicFile_write_file(socket, path, offset, data, isLast) {
    assertReady(socket)
    await writeChunk(path, offset, data, isLast)
  },
}

export default handler
