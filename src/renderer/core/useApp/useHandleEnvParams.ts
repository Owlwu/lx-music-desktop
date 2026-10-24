import { parseUrlParams } from '@common/utils/common'
import { defaultList, loveList, userLists } from '@renderer/store/list/state'
import { getListMusics } from '@renderer/store/list/action'
import { playList } from '@renderer/core/player'

const getListPlayIndex = (list: LX.Music.MusicInfo[], indexStr?: string): number => {
  let index: number
  if (indexStr == null) {
    index = 1
  } else {
    index = parseInt(indexStr)
    if (Number.isNaN(index)) {
      index = 1
    } else {
      if (index < 1) index = 1
      else if (index > list.length) index = list.length
    }
  }
  return index - 1
}

const useInitEnvParamPlay = () => {
  return async(playStr?: string) => {
    if (playStr == null || typeof playStr != 'string') return
    // -play="source=myList&name=名字"
    // -play="source=myList&name=名字&index=位置"
    const params = parseUrlParams(playStr)
    if (params.type != 'songList') return
    if (params.source != 'myList') return
    if (params.name == null) return
    let targetList
    const lists = [defaultList, loveList, ...userLists]
    for (const list of lists) {
      if (list.name === params.name) {
        targetList = list
        break
      }
    }
    if (!targetList) return

    playList(targetList.id, getListPlayIndex(await getListMusics(targetList.id), params.index as string))
  }
}

export default () => {
  // 处理启动参数 play
  const initEnvParamPlay = useInitEnvParamPlay()

  return (envParams: LX.EnvParams) => {
    void initEnvParamPlay(envParams.cmdParams.play)
  }
}
