import * as Comlink from 'comlink'

export type MainTypes = Comlink.Remote<LX.WorkerMainTypes>

export const createMainWorker = () => {
  const worker: Worker = new Worker(new URL(
    /* webpackChunkName: 'renderer.main.worker' */
    '../main',
    import.meta.url,
  ))
  return Comlink.wrap<LX.WorkerMainTypes>(worker)
}

// export const createWorker = <T>(url: string): Comlink.Remote<T> => {
//   // @ts-expect-error
//   const worker: Worker = new Worker(new URL(url, import.meta.url))
//   return Comlink.wrap<T>(worker)
//   // worker.addEventListener('message', (event: MessageEvent) => {

//   // })
// }

export const proxyCallback = <Args extends any[]>(callback: (...T: Args) => void) => {
  return Comlink.proxy(callback)
}
