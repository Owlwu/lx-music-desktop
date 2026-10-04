/**
 * 本地音乐文件同步在服务端的握手：
 * 只做特性协商与就绪标记，文件传输由用户在任一端界面手动发起。
 */
export const sync = async(socket: LX.Sync.Server.Socket) => {
  if (!socket.feature.musicFile) throw new Error('musicFile feature options not available')
  await socket.remote.musicFile_sync_finished()
  socket.moduleReadys.musicFile = true
}
