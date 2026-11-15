import { clipboardWriteText } from '@common/utils/electron'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'
import { removeListMusics } from '@renderer/store/list/action'
import { formatMusicName } from '@renderer/utils/index'
import { addDislikeInfo, hasDislike } from '@renderer/core/dislikeList'
import { playNext } from '@renderer/core/player'
import { playMusicInfo } from '@renderer/store/player/state'
import { openDirInExplorer } from '@renderer/utils/ipc'
import { checkPath } from '@common/utils/nodejs'
import { deleteLocalMusicFiles } from '@renderer/utils/localMusicFile'
import { appSetting } from '@renderer/store/setting'


export default ({ props, list, selectedList, removeAllSelect, openLyricsMatch, openCoverMatch }) => {
  const t = useI18n()

  const handleCopyName = index => {
    const minfo = list.value[index]
    clipboardWriteText(formatMusicName('歌名 - 歌手', minfo.name, minfo.singer))
  }

  const handleOpenFolder = async(index) => {
    const minfo = list.value[index]
    if (minfo.source !== 'local') return
    const filePath = minfo.meta.filePath
    if (!filePath || !await checkPath(filePath)) return
    await openDirInExplorer(filePath)
  }

  const handleMatchLyrics = (index) => {
    const minfo = list.value[index]
    if (!minfo || minfo.source !== 'local') return
    openLyricsMatch(minfo, props.listId)
  }

  const handleMatchCover = (index) => {
    const minfo = list.value[index]
    if (!minfo || minfo.source !== 'local') return
    openCoverMatch(minfo)
  }

  const handleDislikeMusic = async(index) => {
    const minfo = list.value[index]
    const confirm = await dialog.confirm({
      message: minfo.singer ? t('lists__dislike_music_singer_tip', { name: minfo.name, singer: minfo.singer }) : t('lists__dislike_music_tip', { name: minfo.name }),
      cancelButtonText: t('cancel_button_text_2'),
      confirmButtonText: t('confirm_button_text'),
    })
    if (!confirm) return
    await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
    if (hasDislike(playMusicInfo.musicInfo)) {
      playNext(true)
    }
  }

  // 开启「从列表移除本地歌曲时同时删除本地文件」后，移除本地歌曲时一并删除音频、歌词与同名封面；
  // 删除放到后台执行，避免网络盘/被占用文件拖慢列表刷新
  const handleDeleteLocalFiles = async(musicInfos) => {
    if (!appSetting['list.isDeleteLocalFileWhenRemove']) return
    for (const musicInfo of musicInfos) {
      if (!musicInfo || musicInfo.source !== 'local') continue
      await deleteLocalMusicFiles(musicInfo).catch(() => {})
    }
  }

  const handleRemoveMusic = async(index, single) => {
    const isDeleteLocalFile = appSetting['list.isDeleteLocalFileWhenRemove']
    if (selectedList.value.length && !single) {
      const musicInfos = [...selectedList.value]
      const hasLocal = isDeleteLocalFile && musicInfos.some(m => m.source === 'local')
      const confirm = await (musicInfos.length > 1 || hasLocal
        ? dialog.confirm({
          message: hasLocal
            ? t('lists__remove_music_local_file_tip', { len: musicInfos.length })
            : t('lists__remove_music_tip', { len: musicInfos.length }),
          confirmButtonText: t('lists__remove_tip_button'),
        })
        : Promise.resolve(true)
      )
      if (!confirm) return
      handleDeleteLocalFiles(musicInfos).catch(() => {})
      removeListMusics({ listId: props.listId, ids: musicInfos.map(m => m.id) })
      removeAllSelect()
    } else {
      const minfo = list.value[index]
      if (!minfo) return
      if (isDeleteLocalFile && minfo.source === 'local') {
        const confirm = await dialog.confirm({
          message: t('lists__remove_local_file_tip', { name: minfo.name }),
          confirmButtonText: t('lists__remove_tip_button'),
        })
        if (!confirm) return
      }
      handleDeleteLocalFiles([minfo]).catch(() => {})
      removeListMusics({ listId: props.listId, ids: [minfo.id] })
    }
  }

  return {
    handleCopyName,
    handleOpenFolder,
    handleMatchLyrics,
    handleMatchCover,
    handleDislikeMusic,
    handleRemoveMusic,
  }
}
