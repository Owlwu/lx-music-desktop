import { createMainWorker } from './utils'


export default () => {
  return {
    main: createMainWorker(),
  }
}
