import { ref } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { refreshPlayCover } from '@renderer/core/music/cover'

const getFileName = (filePath) => (filePath ?? '').replace(/^.*[\\/]/, '')

export default () => {
  const isShowCoverMatch = ref(false)
  const matchCoverMusicInfo = ref(null)

  const openCoverMatch = (musicInfo) => {
    if (!musicInfo || musicInfo.source !== 'local') return
    matchCoverMusicInfo.value = musicInfo
    isShowCoverMatch.value = true
  }

  const closeCoverMatch = () => {
    isShowCoverMatch.value = false
  }

  const handleCoverMatchApplied = async(result) => {
    const musicInfo = matchCoverMusicInfo.value
    if (!musicInfo) return
    await dialog({
      message: window.i18n.t('cover_match__apply_success', { file: getFileName(result?.imagePath) }),
    })
    await refreshPlayCover(musicInfo)
    closeCoverMatch()
  }

  const handleCoverMatchDeleted = async(musicInfo) => {
    await refreshPlayCover(musicInfo)
  }

  return {
    isShowCoverMatch,
    matchCoverMusicInfo,
    openCoverMatch,
    closeCoverMatch,
    handleCoverMatchApplied,
    handleCoverMatchDeleted,
  }
}
