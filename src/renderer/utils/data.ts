/* eslint-disable @typescript-eslint/no-dynamic-delete */
import {
  saveListPositionInfo as saveListPositionInfoFromData,
  getListPositionInfo as getListPositionInfoFromData,
  saveListPrevSelectId as saveListPrevSelectIdFromData,
  getListPrevSelectId as getListPrevSelectIdFromData,
  saveViewPrevState as saveViewPrevStateFromData,
} from '@renderer/utils/ipc'
import { throttle } from '@common/utils'
import { type DEFAULT_SETTING, LIST_IDS } from '@common/constants'

let listPosition: LX.List.ListPositionInfo
let listPrevSelectId: string

const saveListPositionThrottle = throttle(() => {
  saveListPositionInfoFromData(listPosition)
}, 1000)
const saveViewPrevStateThrottle = throttle((state) => {
  saveViewPrevStateFromData(state)
}, 1000)

const initPosition = async() => {
  // eslint-disable-next-line require-atomic-updates
  listPosition ??= await getListPositionInfoFromData() ?? {}
}
export const getListPosition = async(id: string): Promise<number> => {
  await initPosition()
  return listPosition[id] ?? 0
}
export const setListPosition = async(id: string, position?: number) => {
  await initPosition()
  listPosition[id] = position ?? 0
  saveListPositionThrottle()
}
export const removeListPosition = async(id: string) => {
  await initPosition()
  if (listPosition[id] == null) return
  delete listPosition[id]
  saveListPositionThrottle()
}
export const overwriteListPosition = async(ids: string[]) => {
  await initPosition()
  const removedIds = []
  for (const id of Object.keys(listPosition)) {
    if (ids.includes(id)) continue
    removedIds.push(id)
  }
  for (const id of removedIds) delete listPosition[id]
  saveListPositionThrottle()
}

const saveListPrevSelectIdThrottle = throttle(() => {
  saveListPrevSelectIdFromData(listPrevSelectId)
}, 200)
export const getListPrevSelectId = async() => {
  // eslint-disable-next-line require-atomic-updates
  listPrevSelectId ??= await getListPrevSelectIdFromData() ?? LIST_IDS.DEFAULT
  return listPrevSelectId ?? LIST_IDS.DEFAULT
}
export const saveListPrevSelectId = (id: string) => {
  listPrevSelectId = id
  saveListPrevSelectIdThrottle()
}

export const saveViewPrevState = (state: typeof DEFAULT_SETTING['viewPrevState']) => {
  saveViewPrevStateThrottle(state)
}
