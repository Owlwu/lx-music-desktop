import registerWinMain from './winMain'
import registerHotKey from './hotKey'
import registerTray from './tray'
import registerAppMenu from './appMenu'
import registerWinLyric from './winLyric'
import registerCommonRenderers from './commonRenderers'
import registerMediaMatch from './mediaMatch'

let isRegistered = false
export default () => {
  if (isRegistered) return
  registerCommonRenderers()
  registerWinMain()
  registerMediaMatch()
  registerHotKey()
  registerTray()
  registerAppMenu()
  registerWinLyric()
  isRegistered = true
}
