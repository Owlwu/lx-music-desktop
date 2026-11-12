import fs from 'node:fs/promises'
import path from 'node:path'
import type { Stats } from 'node:fs'

/**
 * 同名封面文件规则（只写歌曲同目录同名 jpg/png，不内嵌、不改音频）
 *
 * - 只接受 JPEG(`FF D8 FF`) / PNG(`89 50 4E 47 0D 0A 1A 0A`)
 * - 宽高 200–4000px，体积 ≤ 8MB
 * - 写入目标扩展名：JPEG → `.jpg`，PNG → `.png`
 * - 覆盖前先备份为 `.bak`（只保留第一次的原始备份）；`.tmp` + rename 原子写
 * - 回退：把 `.bak` 原子写回原图，成功后删除 `.bak`
 */

export type CoverFileErrorCode =
  | 'invalid_file'
  | 'image_invalid'
  | 'image_too_large'
  | 'no_permission'
  | 'disk_full'
  | 'unknown'

export class CoverFileError extends Error {
  code: CoverFileErrorCode

  constructor(code: CoverFileErrorCode, message: string) {
    super(message)
    this.name = 'CoverFileError'
    this.code = code
  }
}

export type ImageFormat = 'jpg' | 'png'

export interface ImageInfo {
  format: ImageFormat
  width: number
  height: number
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MIN_IMAGE_DIMENSION = 200
export const MAX_IMAGE_DIMENSION = 4000

const IMAGE_FORMATS: ImageFormat[] = ['jpg', 'png']

const audioExtRxp = /\.(?:lrc|bak|tmp|jpg|jpeg|png|webp)$/i

const statOrNull = async(filePath: string): Promise<Stats | null> => {
  try {
    return await fs.stat(filePath)
  } catch {
    return null
  }
}

const getErrnoCode = (err: unknown): string => {
  return (err as NodeJS.ErrnoException | null)?.code ?? ''
}

const classifyError = (err: unknown): CoverFileErrorCode => {
  if (err instanceof CoverFileError) return err.code
  switch (getErrnoCode(err)) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'no_permission'
    case 'ENOSPC':
      return 'disk_full'
    default:
      return 'unknown'
  }
}

const toCoverFileError = (err: unknown): CoverFileError => {
  if (err instanceof CoverFileError) return err
  const code = classifyError(err)
  const message = err instanceof Error ? err.message : String(err)
  return new CoverFileError(code, message)
}

const removeIfExists = async(filePath: string): Promise<void> => {
  try {
    await fs.rm(filePath, { force: true, recursive: true })
  } catch {}
}

const unlinkIfExists = async(filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath)
  } catch (err) {
    if (getErrnoCode(err) !== 'ENOENT') throw err
  }
}

/**
 * 由音频路径推导同名图片路径（小写扩展名）
 */
export const getImagePath = (filePath: string, format: ImageFormat): string => {
  const ext = path.extname(filePath)
  const stem = ext ? filePath.slice(0, filePath.length - ext.length) : filePath
  return `${stem}.${format}`
}

export const getBackupPath = (filePath: string, format: ImageFormat): string => {
  return getImagePath(filePath, format) + '.bak'
}

export const getOtherFormat = (format: ImageFormat): ImageFormat => {
  return format === 'jpg' ? 'png' : 'jpg'
}

/**
 * 仅允许真实存在、带扩展名、非歌词/备份/临时/图片的绝对文件路径
 */
export const isAudioFilePath = async(filePath: string): Promise<boolean> => {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  if (!path.extname(filePath) || audioExtRxp.test(filePath)) return false
  const stats = await statOrNull(filePath)
  return !!stats?.isFile()
}

const isSofMarker = (marker: number): boolean => {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

const parseJpegInfo = (data: Uint8Array): ImageInfo | null => {
  // 跳过 SOI 后逐段扫描，遇到 SOF 段时读取宽高
  let offset = 2
  while (offset + 1 < data.length) {
    if (data[offset] !== 0xff) {
      offset++
      continue
    }
    let marker = data[offset + 1]
    while (marker === 0xff) {
      offset++
      if (offset + 1 >= data.length) return null
      marker = data[offset + 1]
    }
    offset += 2
    // 无长度字段的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 1 >= data.length) return null
    const length = (data[offset] << 8) | data[offset + 1]
    if (length < 2) return null
    if (isSofMarker(marker)) {
      // 段内容：精度(1) + 高(2) + 宽(2) + 分量数(1) + ...
      if (offset + 7 > data.length) return null
      const height = (data[offset + 3] << 8) | data[offset + 4]
      const width = (data[offset + 5] << 8) | data[offset + 6]
      if (!width || !height) return null
      return { format: 'jpg', width, height }
    }
    offset += length
  }
  return null
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const readUint32 = (data: Uint8Array, offset: number): number => {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
}

const parsePngInfo = (data: Uint8Array): ImageInfo | null => {
  if (data.length < 24) return null
  for (let i = 0; i < pngSignature.length; i++) {
    if (data[i] !== pngSignature[i]) return null
  }
  // 第一个块必须是 IHDR，长度 13，含宽(4)/高(4)
  if (readUint32(data, 8) !== 13) return null
  if (data[12] !== 0x49 || data[13] !== 0x48 || data[14] !== 0x44 || data[15] !== 0x52) return null
  const width = readUint32(data, 16)
  const height = readUint32(data, 20)
  if (!width || !height) return null
  return { format: 'png', width, height }
}

/**
 * 解析图片 magic + 尺寸（不校验尺寸范围，便于单测尺寸边界）
 */
export const parseImageInfo = (data: Uint8Array): ImageInfo | null => {
  if (!data || data.length < 3) return null
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return parseJpegInfo(data)
  if (data[0] === 0x89 && data[1] === 0x50) return parsePngInfo(data)
  return null
}

export const isImageSizeAllowed = (width: number, height: number): boolean => {
  return width >= MIN_IMAGE_DIMENSION && width <= MAX_IMAGE_DIMENSION &&
    height >= MIN_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION
}

/**
 * 校验下载数据：体积上限、magic、尺寸范围；失败抛 CoverFileError
 */
export const validateImageData = (data: Uint8Array): ImageInfo => {
  if (!data?.length) throw new CoverFileError('image_invalid', 'empty image data')
  if (data.length > MAX_IMAGE_BYTES) throw new CoverFileError('image_too_large', 'image data too large')
  const info = parseImageInfo(data)
  if (!info) throw new CoverFileError('image_invalid', 'unsupported image format')
  if (!isImageSizeAllowed(info.width, info.height)) {
    throw new CoverFileError('image_invalid', `unsupported image size: ${info.width}x${info.height}`)
  }
  return info
}

/**
 * 查询同名封面 / 备份状态；读取规则与 `getLocalMusicFilePic` 一致：优先 jpg，再 png
 */
export const getCoverState = async(filePath: string): Promise<LX.CoverMatch.CoverState> => {
  if (!await isAudioFilePath(filePath)) return { imageExists: false, backupExists: false }

  const [jpgStats, pngStats, jpgBackupStats, pngBackupStats] = await Promise.all([
    statOrNull(getImagePath(filePath, 'jpg')),
    statOrNull(getImagePath(filePath, 'png')),
    statOrNull(getBackupPath(filePath, 'jpg')),
    statOrNull(getBackupPath(filePath, 'png')),
  ])

  const format: ImageFormat | undefined = jpgStats?.isFile() ? 'jpg' : pngStats?.isFile() ? 'png' : undefined
  const imageStats = format === 'jpg' ? jpgStats : format === 'png' ? pngStats : null

  const state: LX.CoverMatch.CoverState = {
    imageExists: !!format,
    backupExists: (jpgBackupStats?.isFile() ?? false) || (pngBackupStats?.isFile() ?? false),
  }
  if (format && imageStats) {
    state.imagePath = getImagePath(filePath, format)
    state.imageFormat = format
    state.imageSize = imageStats.size
    state.imageMtime = imageStats.mtimeMs
  }
  return state
}

interface CreatedBackup {
  originalPath: string
  backupPath: string
}

interface StagedImage {
  originalPath: string
  stagedPath: string
}

/**
 * 写入同名封面：先备份（只保留第一次的原始备份）→ `.tmp` + rename 原子写；失败恢复备份
 *
 * 若另一扩展名的旧图存在但其 `.bak` 已存在（无法再备份），先把旧图暂存为
 * `<image>.bak.replaced.tmp`，写入成功后删除、失败则改回原名，避免旧 jpg 遮住新 png。
 */
export const applyCoverImage = async(
  filePath: string,
  data: Uint8Array,
): Promise<{ imagePath: string, format: ImageFormat, backupCreated: boolean }> => {
  if (!await isAudioFilePath(filePath)) {
    throw new CoverFileError('invalid_file', 'invalid audio file path')
  }
  const info = validateImageData(data)

  const targetPath = getImagePath(filePath, info.format)
  const otherPath = getImagePath(filePath, getOtherFormat(info.format))
  const tmpPath = targetPath + '.tmp'
  const createdBackups: CreatedBackup[] = []
  const stagedImages: StagedImage[] = []
  let backupCreated = false

  try {
    // 目标扩展名与另一扩展名的旧图都要处理，避免出现「旧 jpg 遮住新 png」
    for (const imagePath of [targetPath, otherPath]) {
      const imageStats = await statOrNull(imagePath)
      if (!imageStats?.isFile()) continue
      const backupPath = imagePath + '.bak'
      if (await statOrNull(backupPath)) {
        // 目标扩展名的旧图稍后会被直接覆盖，保留旧 .bak 即可
        if (imagePath === targetPath) continue
        // 另一扩展名无法再备份：先暂存移走，保证新图可见
        const stagedPath = imagePath + '.bak.replaced.tmp'
        await removeIfExists(stagedPath)
        await fs.rename(imagePath, stagedPath)
        stagedImages.push({ originalPath: imagePath, stagedPath })
        continue
      }
      await fs.rename(imagePath, backupPath)
      createdBackups.push({ originalPath: imagePath, backupPath })
      backupCreated = true
    }

    await removeIfExists(tmpPath)
    await fs.writeFile(tmpPath, data)
    await fs.rename(tmpPath, targetPath)

    // 写入成功后才清理暂存的旧图
    for (const staged of stagedImages) await removeIfExists(staged.stagedPath)

    return { imagePath: targetPath, format: info.format, backupCreated }
  } catch (err) {
    await removeIfExists(tmpPath)
    // 写入失败：把本次刚备份的旧图改回原名（已有 .bak 的保持不动）
    for (const backup of createdBackups.reverse()) {
      try {
        if (!await statOrNull(backup.originalPath)) await fs.rename(backup.backupPath, backup.originalPath)
      } catch {}
    }
    // 写入失败：把暂存的旧图改回原名
    for (const staged of stagedImages.reverse()) {
      try {
        if (!await statOrNull(staged.originalPath)) await fs.rename(staged.stagedPath, staged.originalPath)
      } catch {}
      await removeIfExists(staged.stagedPath)
    }
    throw toCoverFileError(err)
  }
}

interface RollbackBackup {
  format: ImageFormat
  imagePath: string
  backupPath: string
}

/**
 * 回退：把 `.bak` 原子写回原图，成功后删除 `.bak`；失败不丢当前图，可重试
 *
 * 若当前可见图是本次匹配新生成、且该扩展名没有备份（说明原来不存在），
 * 先把它临时移开，恢复备份后再删除，避免「新图遮住恢复的原图」。
 */
export const rollbackCover = async(filePath: string): Promise<boolean> => {
  if (!await isAudioFilePath(filePath)) {
    throw new CoverFileError('invalid_file', 'invalid audio file path')
  }

  const backups: RollbackBackup[] = []
  for (const format of IMAGE_FORMATS) {
    const backupPath = getBackupPath(filePath, format)
    if (await statOrNull(backupPath)) {
      backups.push({ format, imagePath: getImagePath(filePath, format), backupPath })
    }
  }
  if (!backups.length) return false

  const state = await getCoverState(filePath)
  const currentFormat = state.imageFormat
  const currentBackedUp = currentFormat != null && backups.some(item => item.format === currentFormat)
  const stagedNewImage = currentFormat && !currentBackedUp ? state.imagePath ?? null : null
  const stagedNewPath = stagedNewImage ? stagedNewImage + '.rollback.tmp' : null

  if (stagedNewImage && stagedNewPath) {
    try {
      await fs.rename(stagedNewImage, stagedNewPath)
    } catch (err) {
      throw toCoverFileError(err)
    }
  }

  try {
    for (const item of backups) {
      const backupData = await fs.readFile(item.backupPath)
      const rollbackTmpPath = item.imagePath + '.rollback.tmp'
      await removeIfExists(rollbackTmpPath)
      await fs.writeFile(rollbackTmpPath, backupData)
      await fs.rename(rollbackTmpPath, item.imagePath)
    }
    for (const item of backups) await unlinkIfExists(item.backupPath)
    if (stagedNewPath) await unlinkIfExists(stagedNewPath)
    return true
  } catch (err) {
    for (const item of backups) await removeIfExists(item.imagePath + '.rollback.tmp')
    // 恢复暂存的新图：若对应路径已被恢复的备份占用则放弃（备份才是原图）
    if (stagedNewImage && stagedNewPath) {
      try {
        if (!await statOrNull(stagedNewImage)) await fs.rename(stagedNewPath, stagedNewImage)
      } catch {}
      await removeIfExists(stagedNewPath)
    }
    throw toCoverFileError(err)
  }
}
