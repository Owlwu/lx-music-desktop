import { type workerMainTypes } from '@renderer/worker/main/index'


declare global {
  namespace LX {
    type WorkerMainTypes = workerMainTypes
  }
}
