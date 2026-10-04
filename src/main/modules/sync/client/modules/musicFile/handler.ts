// 这个文件导出的方法将暴露给服务端调用，第一个参数固定为当前 socket 对象
import peerHandler from '@main/modules/sync/musicFile/handler'

const handler: LX.Sync.ClientSyncHandlerMusicFileActions<LX.Sync.Client.Socket> = {
  ...peerHandler,

  async musicFile_sync_finished(socket) {
    socket.moduleReadys.musicFile = true
  },
}

export default handler
