const timestampRxp = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?]/g
const placeholderRxp = /未经许可|不得翻唱|纯音乐|暂无歌词/
// 源歌词自带的头部标签行；写入时统一由本地歌曲信息生成，避免重复
const metaTagLineRxp = /^\s*\[(?:ti|ar|al|by):[^\]]*]\s*$/i
// 逐字歌词的词级时间标签（如 <0,300>），.lrc 只保留行级时间轴，写入前剔除
const wordTimingRxp = /<[\d:.,]+>/g

export interface LyricValidation {
  /**
   * 是否含 ≥1 个时间标签
   */
  isSynced: boolean
  /**
   * 是否可作为歌词应用（长度足够且不是版权占位文本）
   */
  usable: boolean
  /**
   * 是否命中版权/纯音乐占位文本
   */
  placeholder: boolean
}

/**
 * 取词后的有效性校验（两端一致）：时间标签、长度、占位文本
 */
export const validateLyric = (lyric: string): LyricValidation => {
  const text = (lyric ?? '').replace(/\r\n?/g, '\n')
  const isPlaceholder = placeholderRxp.test(text)
  const isSynced = (text.match(timestampRxp) ?? []).length > 0
  return {
    isSynced,
    usable: text.trim().length >= 20 && !isPlaceholder,
    placeholder: isPlaceholder,
  }
}

const cleanMeta = (value: string): string => (value ?? '').replace(/[\r\n]+/g, ' ').trim()

const normalizeBody = (lyric: string, isSynced: boolean): string[] => {
  const lines = (lyric ?? '').replace(/\r\n?/g, '\n').split('\n')
  const result: string[] = []
  for (const rawLine of lines) {
    let line = rawLine.trimEnd()
    // 剔除源歌词自带的 [ti:]/[ar:]/[al:]/[by:] 行，保留 [offset:] 等其他标签
    if (metaTagLineRxp.test(line)) continue
    // 逐字歌词的词级时间标签先剔除，.lrc 只保留行级时间轴
    line = line.replace(wordTimingRxp, '').trimEnd()
    if (!isSynced) line = line.replace(timestampRxp, '').trimEnd()
    if (!line) {
      // 连续空行合并为一个
      if (result.length && result[result.length - 1] !== '') result.push('')
      continue
    }
    result.push(line)
  }
  // 去掉结尾空行，结尾统一补一个换行
  while (result.length && result[result.length - 1] === '') result.pop()
  return result
}

/**
 * 生成写入磁盘的 LRC 文本（UTF-8 无 BOM，\n 换行）
 */
export const buildLrcText = (candidate: {
  name: string
  singer: string
  albumName: string
  lyric: string
  isSynced: boolean
}): string => {
  const header: string[] = []
  const title = cleanMeta(candidate.name)
  const artist = cleanMeta(candidate.singer)
  const album = cleanMeta(candidate.albumName)
  if (title) header.push(`[ti:${title}]`)
  if (artist) header.push(`[ar:${artist}]`)
  if (album) header.push(`[al:${album}]`)

  const body = normalizeBody(candidate.lyric, candidate.isSynced)
  const lines = [...header, ...body]
  return lines.length ? lines.join('\n') + '\n' : ''
}
