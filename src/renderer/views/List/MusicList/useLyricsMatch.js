import { ref } from '@common/utils/vueTools'
import { dialog } from '@renderer/plugins/Dialog'
import { refreshPlayLyric, setMusicLyricSource } from '@renderer/core/music/lyricSource'

const getFileName = (filePath) => (filePath ?? '').replace(/^.*[\\/]/, '')

export default () => {
  const isShowLyricsMatch = ref(false)
  const matchMusicInfo = ref(null)
  let matchListId = null

  const openLyricsMatch = (musicInfo, listId) => {
    if (!musicInfo || musicInfo.source !== 'local') return
    matchMusicInfo.value = musicInfo
    matchListId = listId ?? null
    isShowLyricsMatch.value = true
  }

  const closeLyricsMatch = () => {
    isShowLyricsMatch.value = false
  }

  const handleLyricsMatchApplied = async(applied) => {
    const musicInfo = matchMusicInfo.value
    if (!musicInfo) return
    // 应用成功后来源切到 LRC 文件（只改列表 meta，不写文件）
    await setMusicLyricSource(musicInfo, 'lrc', matchListId)
    await refreshPlayLyric(musicInfo)
    await dialog({
      message: window.i18n.t('lyrics_match__apply_success', { file: getFileName(applied?.lrcPath) }),
    })
  }

  return {
    isShowLyricsMatch,
    matchMusicInfo,
    openLyricsMatch,
    closeLyricsMatch,
    handleLyricsMatchApplied,
  }
}
