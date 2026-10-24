import { init } from './db'
import { exposeWorker } from '../utils/worker'
import { list, lyric, dislike_list } from './modules/index'


const common = {
  init,
}

exposeWorker(Object.assign(common, list, lyric, dislike_list))

export type workerDBSeriveTypes = typeof common
  & typeof list
  & typeof lyric
  & typeof dislike_list
