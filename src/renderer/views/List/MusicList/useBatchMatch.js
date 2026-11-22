import { reactive, ref } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { dialog } from '@renderer/plugins/Dialog'
import { getListMusics } from '@renderer/store/list/action'
import {
  coverMatchApply,
  coverMatchSearch,
  mediaMatchApplyLrc,
  mediaMatchGetFileState,
  mediaMatchGetLyric,
  mediaMatchSearch,
} from '@renderer/utils/ipc'
import { refreshPlayLyric, setMusicLyricSource } from '@renderer/core/music/lyricSource'
import { refreshPlayCover } from '@renderer/core/music/cover'
import {
  countLocalMusics,
  createBatchMatcher,
  toPlainCoverCandidate,
  toPlainLyricCandidate,
  toPlainMusicInfo,
} from '@common/utils/mediaMatch/batch'

const sleep = async(ms) => new Promise(resolve => {
  setTimeout(resolve, ms)
})

const createEmptyProgress = () => ({
  phase: 'idle',
  current: 0,
  total: 0,
  name: '',
  lyric: 0,
  cover: 0,
  failed: 0,
  skipped: 0,
  processed: 0,
  canceled: false,
  none: false,
})

/**
 * 一键补全当前列表缺失歌词/封面
 *
 * 编排逻辑在 `@common/utils/mediaMatch/batch`（纯逻辑、可单测）；这里只做 IPC/刷新接线。
 * 注意：所有跨 IPC 参数都用普通对象（Vue 响应式 Proxy 无法 structured clone）。
 */
export default ({ props }) => {
  const t = useI18n()
  const isShowBatchMatch = ref(false)
  const isBatchRunning = ref(false)
  const batchProgress = reactive(createEmptyProgress())
  const runningMatcher = ref(null)

  const updateProgress = (progress) => {
    Object.assign(batchProgress, progress)
  }

  const createMatcher = () => createBatchMatcher({
    getListMusics: async(listId) => {
      const musics = await getListMusics(listId)
      return musics.map(musicInfo => toPlainMusicInfo(musicInfo)).filter(Boolean)
    },
    getFileState: async(filePath) => await mediaMatchGetFileState(filePath),
    searchLyricCandidates: async(musicInfo) => {
      const result = await mediaMatchSearch({ musicInfo: toPlainMusicInfo(musicInfo) })
      return result?.candidates ?? []
    },
    getCandidateLyric: async(candidate) => {
      return await mediaMatchGetLyric({ candidate: toPlainLyricCandidate(candidate) })
    },
    applyLyric: async(musicInfo, candidate) => {
      return await mediaMatchApplyLrc({
        musicInfo: toPlainMusicInfo(musicInfo),
        candidate: toPlainLyricCandidate(candidate),
      })
    },
    searchCoverCandidates: async(musicInfo) => {
      const result = await coverMatchSearch({ musicInfo: toPlainMusicInfo(musicInfo) })
      return result?.candidates ?? []
    },
    applyCover: async(musicInfo, candidate) => {
      return await coverMatchApply({
        musicInfo: toPlainMusicInfo(musicInfo),
        candidate: toPlainCoverCandidate(candidate),
      })
    },
    onLyricApplied: async(musicInfo) => {
      // 写入列表 meta 也必须传普通对象：Proxy 里的 meta 会让 updateListMusics 的 IPC 克隆失败
      const plainMusicInfo = toPlainMusicInfo(musicInfo)
      await setMusicLyricSource(plainMusicInfo, 'lrc', props.listId)
      await refreshPlayLyric(plainMusicInfo)
    },
    onCoverApplied: async(musicInfo) => {
      await refreshPlayCover(toPlainMusicInfo(musicInfo))
    },
    onProgress: updateProgress,
    onError: (err, context) => {
      console.log('[batchMatch]', context, err)
    },
    sleep,
    intervalMs: 200,
  })

  const startBatchMatch = async() => {
    if (isBatchRunning.value) return

    // 确认框需要本地歌曲总数；没有本地歌曲时只提示、不发请求
    let localCount = 0
    try {
      localCount = countLocalMusics(await getListMusics(props.listId))
    } catch (err) {
      console.log(err)
      await dialog({ message: t('batch_match__error') })
      return
    }
    if (!localCount) {
      await dialog({ message: t('batch_match__no_local') })
      return
    }

    const confirm = await dialog.confirm({
      message: t('batch_match__confirm', { total: localCount }),
      confirmButtonText: t('btn_confirm'),
      cancelButtonText: t('btn_cancel'),
    })
    if (!confirm) return

    Object.assign(batchProgress, createEmptyProgress(), {
      phase: 'scanning',
      total: localCount,
    })
    isShowBatchMatch.value = true
    isBatchRunning.value = true
    runningMatcher.value = createMatcher()
    try {
      await runningMatcher.value.run(props.listId)
    } catch (err) {
      console.log(err)
      isShowBatchMatch.value = false
      await dialog({ message: t('batch_match__error') })
    } finally {
      isBatchRunning.value = false
      runningMatcher.value = null
    }
  }

  const cancelBatchMatch = () => {
    runningMatcher.value?.cancel()
  }

  const closeBatchMatch = () => {
    if (isBatchRunning.value) return
    isShowBatchMatch.value = false
  }

  return {
    isShowBatchMatch,
    isBatchRunning,
    batchProgress,
    startBatchMatch,
    cancelBatchMatch,
    closeBatchMatch,
  }
}
