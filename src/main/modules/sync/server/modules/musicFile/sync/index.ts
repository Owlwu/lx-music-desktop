export { default as handler } from './handler'
export { sync } from './sync'

/** 本地音乐文件同步不需要监听本地变更事件，这里提供空实现以统一定义 */
export const registerEvent = (_wss: LX.Sync.Server.SocketServer) => {}
export const unregisterEvent = () => {}
