import initRendererEvent from './rendererEvent'

let isRegistered = false

export default () => {
  if (isRegistered) return
  initRendererEvent()
  isRegistered = true
}
