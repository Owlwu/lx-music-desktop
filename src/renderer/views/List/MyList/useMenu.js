import { computed, ref, reactive, nextTick } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { userLists, defaultList, loveList } from '@renderer/store/list/state'
import { addLocalFile, addLocalFolder } from './actions'

export default ({
  emit,

  handleRename,
  handleDuplicateList,
  handleSortList,
  handleImportList,
  handleExportList,
  handleRemove,
}) => {
  const menuControl = reactive({
    rename: true,
    duplicate: true,
    sort: true,
    local_file: true,
    import: true,
    export: true,
    remove: true,
  })
  const t = useI18n()
  const menuLocation = reactive({ x: 0, y: 0 })
  const isShowMenu = ref(false)

  const menus = computed(() => {
    return [
      {
        name: t('lists__rename'),
        action: 'rename',
        disabled: !menuControl.rename,
      },
      {
        name: t('lists__sort_list'),
        action: 'sort',
        disabled: !menuControl.sort,
      },
      {
        name: t('lists__duplicate'),
        action: 'duplicate',
        disabled: !menuControl.duplicate,
      },
      {
        name: t('lists__select_local_file'),
        action: 'local_file',
        disabled: !menuControl.local_file,
      },
      {
        name: t('lists__select_local_folder'),
        action: 'local_folder',
        disabled: !menuControl.local_file,
      },
      {
        name: t('lists__import'),
        action: 'import',
        disabled: !menuControl.export,
      },
      {
        name: t('lists__export'),
        action: 'export',
        disabled: !menuControl.export,
      },
      {
        name: t('lists__remove'),
        action: 'remove',
        disabled: !menuControl.remove,
      },
    ]
  })

  const showMenu = (event, index) => {
    switch (index) {
      case -1:
      case -2:
        menuControl.rename = false
        menuControl.remove = false
        break
      default:
        menuControl.rename = true
        menuControl.remove = true
        break
    }

    menuLocation.x = event.pageX
    menuLocation.y = event.pageY

    if (isShowMenu.value) return
    emit('show-menu')
    nextTick(() => {
      isShowMenu.value = true
    })
  }

  const hideMenu = () => {
    isShowMenu.value = false
  }

  const getListInfo = (index) => {
    let list
    switch (index) {
      case -2:
        list = defaultList
        break
      case -1:
        list = loveList
        break
      default:
        list = userLists[index]
        if (!list) return null
        break
    }
    return list
  }

  const menuClick = (action, index) => {
    hideMenu()
    if (!action) return
    const listInfo = getListInfo(index)
    switch (action.action) {
      case 'rename':
        handleRename(index)
        break
      case 'duplicate':
        handleDuplicateList(listInfo)
        break
      case 'sort':
        handleSortList(listInfo)
        break
      case 'local_file':
        addLocalFile(listInfo)
        break
      case 'local_folder':
        addLocalFolder(listInfo)
        break
      case 'import':
        handleImportList(listInfo, index)
        break
      case 'export':
        handleExportList(listInfo)
        break
      case 'remove':
        handleRemove(listInfo)
        break
    }
  }

  return {
    menus,
    menuLocation,
    isShowMenu,
    showMenu,
    menuClick,
  }
}
