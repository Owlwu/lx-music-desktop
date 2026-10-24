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


export default ({ props, list, selectedList, removeAllSelect }) => {
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

  const handleRemoveMusic = async(index, single) => {
    if (selectedList.value.length && !single) {
      const confirm = await (selectedList.value.length > 1
        ? dialog.confirm({
          message: t('lists__remove_music_tip', { len: selectedList.value.length }),
          confirmButtonText: t('lists__remove_tip_button'),
        })
        : Promise.resolve(true)
      )
      if (!confirm) return
      removeListMusics({ listId: props.listId, ids: selectedList.value.map(m => m.id) })
      removeAllSelect()
    } else {
      removeListMusics({ listId: props.listId, ids: [list.value[index].id] })
    }
  }

  return {
    handleCopyName,
    handleOpenFolder,
    handleDislikeMusic,
    handleRemoveMusic,
  }
}
