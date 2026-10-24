import { toRaw, markRawList } from '@common/utils/vueTools'
import { clearPlayedList } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { dislikeInfo } from '@renderer/store/dislikeList'
import { setPowerSaveBlocker as setPowerSaveBlockerRemote } from '@renderer/utils/ipc'

/**
 * 过滤列表中已播放的歌曲
 */
export const filterList = async({ playedList, listId, list, playerMusicInfo, isNext }: {
  playedList: LX.Player.PlayMusicInfo[]
  listId: string
  list: LX.Music.MusicInfo[]
  playerMusicInfo?: LX.Music.MusicInfo
  isNext: boolean
}) => {
  // if (this.list.listName === null) return
  // console.log(isCheckFile)
  let { filteredList, canPlayList, playerIndex } = await window.lx.worker.main.filterMusicList({
    listId,
    list: list.map(m => toRaw(m)),
    playedList: toRaw(playedList),
    playerMusicInfo: toRaw(playerMusicInfo),
    dislikeInfo: { names: toRaw(dislikeInfo.names), musicNames: toRaw(dislikeInfo.musicNames), singerNames: toRaw(dislikeInfo.singerNames) },
    isNext,
  })

  if (!filteredList.length && playedList.length) {
    clearPlayedList()
    return { filteredList: markRawList(canPlayList), playerIndex }
  }
  return { filteredList: markRawList(filteredList), playerIndex }
}

let timeout: NodeJS.Timeout | null = null
const clearTimer = () => {
  if (!timeout) return
  clearTimeout(timeout)
  timeout = null
}
export const setPowerSaveBlocker = (enabled: boolean, force = false) => {
  if (enabled) {
    clearTimer()
    if (!force && !appSetting['player.powerSaveBlocker']) return
    setPowerSaveBlockerRemote(true)
  } else if (force) {
    clearTimer()
    setPowerSaveBlockerRemote(false)
  } else {
    if (timeout) return
    timeout = setTimeout(() => {
      setPowerSaveBlockerRemote(false)
    }, 60_000 * 1.5)
  }
}
