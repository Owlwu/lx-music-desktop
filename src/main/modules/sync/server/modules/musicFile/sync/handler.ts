// 这个文件导出的方法将暴露给客户端调用，第一个参数固定为当前 socket 对象
import peerHandler from '@main/modules/sync/musicFile/handler'

const handler: LX.Sync.ServerSyncHandlerMusicFilePeerActions<LX.Sync.Server.Socket> = peerHandler

export default handler
