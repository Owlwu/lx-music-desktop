import { computed, ref, shallowReactive, reactive, nextTick } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { hasDislike } from '@renderer/core/dislikeList'
import { checkPath } from '@common/utils/nodejs'

export default ({
  emit,

  handlePlayMusic,
  handlePlayMusicLater,
  handleShowMusicAddModal,
  handleShowMusicMoveModal,
  handleShowSortModal,
  handleCopyName,
  handleOpenFolder,
  handleMatchLyrics,
  handleMatchCover,
  handleDislikeMusic,
  handleRemoveMusic,
}) => {
  const itemMenuControl = reactive({
    play: true,
    playLater: true,
    matchLyrics: true,
    matchCover: true,
    copyName: true,
    openFolder: true,
    addTo: true,
    moveTo: true,
    sort: true,
    dislike: true,
    remove: true,
  })
  const t = useI18n()
  const menuLocation = shallowReactive({ x: 0, y: 0 })
  const isShowItemMenu = ref(false)

  const menus = computed(() => {
    return [
      {
        name: t('list__play'),
        action: 'play',
        disabled: !itemMenuControl.play,
      },
      {
        name: t('list__play_later'),
        action: 'playLater',
        disabled: !itemMenuControl.playLater,
      },
      {
        name: t('list__match_lyrics'),
        action: 'matchLyrics',
        disabled: !itemMenuControl.matchLyrics,
      },
      {
        name: t('list__match_cover'),
        action: 'matchCover',
        disabled: !itemMenuControl.matchCover,
      },
      {
        name: t('list__add_to'),
        action: 'addTo',
        disabled: !itemMenuControl.addTo,
      },
      {
        name: t('list__move_to'),
        action: 'moveTo',
        disabled: !itemMenuControl.moveTo,
      },
      {
        name: t('list__sort'),
        action: 'sort',
        disabled: !itemMenuControl.sort,
      },
      {
        name: t('list__copy_name'),
        action: 'copyName',
        disabled: !itemMenuControl.copyName,
      },
      {
        name: t('list__open_folder'),
        action: 'openFolder',
        disabled: !itemMenuControl.openFolder,
      },
      {
        name: t('list__dislike'),
        action: 'dislike',
        disabled: !itemMenuControl.dislike,
      },
      {
        name: t('list__remove'),
        action: 'remove',
        disabled: !itemMenuControl.remove,
      },
    ]
  })

  const showMenu = async(event, musicInfo) => {
    itemMenuControl.dislike = !hasDislike(musicInfo)
    const fileExists = musicInfo.source === 'local' &&
      !!musicInfo.meta?.filePath &&
      await checkPath(musicInfo.meta.filePath)
    itemMenuControl.matchLyrics = fileExists
    itemMenuControl.matchCover = fileExists

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowItemMenu.value) return

    emit('show-menu')
    nextTick(() => {
      isShowItemMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowItemMenu.value = false
  }

  const menuClick = (action, index) => {
    hideMenu()
    if (!action) return
    switch (action.action) {
      case 'play':
        handlePlayMusic(index)
        break
      case 'playLater':
        handlePlayMusicLater(index)
        break
      case 'matchLyrics':
        handleMatchLyrics(index)
        break
      case 'matchCover':
        handleMatchCover(index)
        break
      case 'copyName':
        handleCopyName(index)
        break
      case 'openFolder':
        handleOpenFolder(index)
        break
      case 'addTo':
        handleShowMusicAddModal(index)
        break
      case 'moveTo':
        handleShowMusicMoveModal(index)
        break
      case 'sort':
        handleShowSortModal(index)
        break
      case 'dislike':
        handleDislikeMusic(index)
        break
      case 'remove':
        handleRemoveMusic(index)
        break
    }
  }

  return {
    menus,
    menuLocation,
    isShowItemMenu,
    showMenu,
    menuClick,
  }
}
