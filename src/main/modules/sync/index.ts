// import Event from './event/event'

import { disconnectServer } from './client'
import { stopServer } from './server'

// import eventNames from './event/name'
export {
  startServer,
  stopServer,
  getStatus as getServerStatus,
  generateCode,
  getDevices as getServerDevices,
  removeDevice as removeServerDevice,
} from './server'

export {
  connectServer,
  disconnectServer,
  getStatus as getClientStatus,
} from './client'

export {
  apply as musicFileApply,
  cancel as musicFileCancel,
  compare as musicFileCompare,
  getConfig as musicFileGetConfig,
  getProgress as musicFileGetProgress,
  getPeerDeviceName as musicFileGetPeerDeviceName,
} from './musicFile'

export default () => {
  global.lx.event_app.on('main_window_close', () => {
    if (global.lx.appSetting['sync.mode'] == 'server') {
      void stopServer()
    } else {
      void disconnectServer()
    }
  })
}
