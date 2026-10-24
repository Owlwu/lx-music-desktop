import { getEnvParams, getViewPrevState, sendInited } from '@renderer/utils/ipc'

import { proxy, isFullscreen, themeId } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'

import useSync from './useSync'
import useStatusbarLyric from './useStatusbarLyric'
import useDataInit from './useDataInit'
import useHandleEnvParams from './useHandleEnvParams'
import useEventListener from './useEventListener'
import usePlayer from './usePlayer'
import useSettingSync from './useSettingSync'
import { useRouter } from '@common/utils/vueRouter'


export default () => {
  proxy.enable = appSetting['network.proxy.enable']
  proxy.host = appSetting['network.proxy.host']
  proxy.port = appSetting['network.proxy.port']
  isFullscreen.value = appSetting['common.startInFullscreen']
  themeId.value = appSetting['theme.id']

  const router = useRouter()
  const initSyncService = useSync()
  const initStatusbarLyric = useStatusbarLyric()
  useEventListener()
  const initPlayer = usePlayer()
  const handleEnvParams = useHandleEnvParams()
  const initData = useDataInit()

  useSettingSync()

  void getEnvParams().then(envParams => {
    const envProxy = envParams.cmdParams['proxy-server']
    if (envProxy && typeof envProxy == 'string') {
      const [host, port = ''] = envProxy.split(':')
      proxy.envProxy = {
        host,
        port,
      }
    }

    void getViewPrevState().then(state => {
      void router.push({ path: state.url, query: state.query })
    })

    // 初始化我的列表等数据
    void initData().then(() => {
      initPlayer()
      handleEnvParams(envParams) // 处理传入的启动参数
      void initSyncService()
      void initStatusbarLyric()
      sendInited()
    })
  })
}
