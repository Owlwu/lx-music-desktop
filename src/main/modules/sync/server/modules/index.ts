import { sync as listSync } from './list'
import { sync as dislikeSync } from './dislike'
import { sync as musicFileSync } from './musicFile'

export const callObj = Object.assign({},
  listSync.handler,
  dislikeSync.handler,
  musicFileSync.handler,
)

export const modules = {
  list: listSync,
  dislike: dislikeSync,
  musicFile: musicFileSync,
}


export { ListManage } from './list'

export { DislikeManage } from './dislike'

export const featureVersion = {
  list: 1,
  dislike: 1,
  musicFile: 1,
} as const
