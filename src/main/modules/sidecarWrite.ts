import fs from 'node:fs/promises'
import path from 'node:path'

const pendingWrites = new Map<string, Promise<unknown>>()

// 同名文件的写入和删除按调用顺序执行。
export const withSidecarWrite = async<T>(filePath: string, write: () => Promise<T>): Promise<T> => {
  const key = path.normalize(filePath)
  const previous = pendingWrites.get(key)
  const current = previous ? previous.catch(() => {}).then(write) : write()
  pendingWrites.set(key, current)
  try {
    return await current
  } finally {
    if (pendingWrites.get(key) === current) pendingWrites.delete(key)
  }
}

export const unlinkSidecar = async(filePath: string): Promise<boolean> => {
  try {
    await fs.unlink(filePath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return false
    throw err
  }
}
