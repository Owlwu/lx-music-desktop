import { ref, reactive, markRaw, computed, watch } from '@common/utils/vueTools'
import { windowSizeList as configWindowSizeList } from '@common/config'
import { appSetting } from './setting'
import pkg from '../../../package.json'
process.versions.app = pkg.version

export const proxy: {
  enable: boolean
  host: string
  port: string

  envProxy?: {
    host: string
    port: string
  }
} = {
  enable: false,
  host: '',
  port: '',
}

export const sync: {
  enable: boolean
  mode: LX.AppSetting['sync.mode']
  isShowSyncMode: boolean
  isShowAuthCodeModal: boolean
  deviceName: string
  type: keyof LX.Sync.ModeTypes
  server: {
    port: string
    status: {
      status: boolean
      message: string
      address: string[]
      code: string
      devices: LX.Sync.ServerKeyInfo[]
    }
  }
  client: {
    host: string
    status: {
      status: boolean
      message: string
      address: string[]
    }
  }
  musicFile: {
    progress: LX.Sync.MusicFile.Progress
  }
} = reactive({
  enable: false,
  mode: 'server',
  isShowSyncMode: false,
  isShowAuthCodeModal: false,
  deviceName: '',
  type: 'list',
  server: {
    port: '',
    status: {
      status: false,
      message: '',
      address: [],
      code: '',
      devices: [],
    },
  },
  client: {
    host: '',
    status: {
      status: false,
      message: '',
      address: [],
    },
  },
  musicFile: {
    progress: {
      running: false,
      stage: 'idle',
      kind: '',
      path: '',
      actionIndex: 0,
      actionTotal: 0,
      fileBytes: 0,
      fileBytesTotal: 0,
      totalBytes: 0,
      doneBytes: 0,
      message: '',
      errors: [],
    },
  },
})

export const windowSizeActive = computed(() => {
  return windowSizeList.find(i => i.id === appSetting['common.windowSizeId']) ?? windowSizeList[0]
})

export const windowSizeList = markRaw(configWindowSizeList)

export const isShowPact = ref(false)

export const isFullscreen = ref(false)
watch(isFullscreen, isFullscreen => {
  window.lx.rootOffset = window.dt || isFullscreen ? 0 : 8
}, { immediate: true })

export const themeShouldUseDarkColors = ref(window.shouldUseDarkColors)

export const themeId = ref('green')
export const themeInfo: LX.ThemeInfo = {
  themes: [],
  userThemes: [],
  dataPath: '',
}
