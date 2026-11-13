const timestampRxp = /\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?]/g
const placeholderRxp = /未经许可|不得翻唱|纯音乐|暂无歌词/
// 源歌词自带的头部标签行；写入时统一由本地歌曲信息生成，避免重复
const metaTagLineRxp = /^\s*\[(?:ti|ar|al|by):[^\]]*]\s*$/i
// 逐字歌词的词级时间标签（如 <0,300>），.lrc 只保留行级时间轴，写入前剔除
const wordTimingRxp = /<[\d:.,]+>/g
// 行级时间标签（扩展段/预览对齐用）：mm:ss[.xx|.xxx]
const timedLineRxp = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?](.*)$/
// 扩展段只接受时间轴行，其余标签（ti/ar/al/by/offset/kana/language…）一律丢弃
const leadingTimestampsRxp = /^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?])+/

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

const parseTimedLineMs = (line: string): number | null => {
  const match = timedLineRxp.exec(line)
  if (!match) return null
  const fraction = (match[3] ?? '').padEnd(3, '0').slice(0, 3)
  return Number(match[1]) * 60000 + Number(match[2]) * 1000 + Number(fraction)
}

/**
 * 去掉行首的全部时间标签，返回正文
 */
const getTimedLineBody = (line: string): string => line.replace(leadingTimestampsRxp, '').trim()

/**
 * 扩展歌词（翻译/罗马音）清洗：CRLF→LF、trim，只保留时间轴行且正文非空；
 * 丢弃 `[ti:]/[ar:]/[al:]/[by:]/[offset:]/[kana:]/[language:]` 等非时间行，
 * 丢弃正文为 `//` 或纯空白的行，保留原时间标签与顺序；空结果返回 ''。
 */
export const sanitizeExtendedLyric = (lyric: string | null | undefined): string => {
  const lines: string[] = []
  for (const rawLine of (lyric ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line || !timedLineRxp.test(line)) continue
    const body = getTimedLineBody(line)
    if (!body || /^\/+$/.test(body)) continue
    lines.push(line)
  }
  return lines.join('\n')
}

export interface ExtendedLyricOptions {
  /**
   * 中文翻译（行级，时间标签与主歌词一致）
   */
  tlyric?: string | null
  /**
   * 罗马音（行级，时间标签与主歌词一致）
   */
  rlyric?: string | null
  /**
   * LX 逐字歌词；仅由 QQ 逐字路径传入
   */
  lxlyric?: string | null
}

/**
 * 在正文后追加 `[awlrc:lrc:<b64>,tlrc:<b64>,rlrc:<b64>]` 扩展段。
 *
 * - 段顺序固定 `lrc → tlrc → rlrc → awlrc`，只写非空段；
 * - 没有任何扩展数据时原样返回 `body`（与旧版 `buildLrcText` 输出逐字节一致）；
 * - `lxlyric` 传了（包括空串）就写 `awlrc:` 段，保证 `buildAwlrcLrcText` 旧输出不变。
 */
export const buildExtendedLrcText = (body: string, options: ExtendedLyricOptions = {}): string => {
  const text = (body ?? '').replace(/\r\n?/g, '\n').trim()
  const translation = sanitizeExtendedLyric(options.tlyric)
  const roma = sanitizeExtendedLyric(options.rlyric)
  const hasWordLyric = options.lxlyric != null
  if (!translation && !roma && !hasWordLyric) return body ?? ''

  const encode = (value: string): string => Buffer.from(value, 'utf8').toString('base64')
  const segments = [`lrc:${encode(text)}`]
  if (translation) segments.push(`tlrc:${encode(translation)}`)
  if (roma) segments.push(`rlrc:${encode(roma)}`)
  if (hasWordLyric) {
    const wordLyric = (options.lxlyric ?? '').replace(/\r\n?/g, '\n').trim()
    segments.push(`awlrc:${encode(wordLyric)}`)
  }
  return `${text}\n\n[awlrc:${segments.join(',')}]\n`
}

export type LyricPreviewEntryType = 'main' | 'translation' | 'roma'

export interface LyricPreviewEntry {
  text: string
  type: LyricPreviewEntryType
}

const toTimedTextMap = (lyric: string | null | undefined): Map<number, string[]> => {
  const map = new Map<number, string[]>()
  const sanitized = sanitizeExtendedLyric(lyric)
  if (!sanitized) return map
  for (const line of sanitized.split('\n')) {
    const ms = parseTimedLineMs(line)
    if (ms == null) continue
    const text = getTimedLineBody(line)
    if (!text) continue
    const queue = map.get(ms)
    if (queue) queue.push(text)
    else map.set(ms, [text])
  }
  return map
}

/**
 * 预览用：主歌词行后插入同时间的翻译行（再罗马音行），时间标签按毫秒归一。
 * 无对应翻译/罗马音的主行不插；总数（含扩展行）不超过 `maxLines`。
 */
export const getLyricPreviewEntries = (
  lyric: string | null | undefined,
  tlyric?: string | null,
  rlyric?: string | null,
  maxLines = 30,
): LyricPreviewEntry[] => {
  if (maxLines <= 0) return []
  const translationMap = toTimedTextMap(tlyric)
  const romaMap = toTimedTextMap(rlyric)
  const entries: LyricPreviewEntry[] = []
  const push = (text: string, type: LyricPreviewEntryType): boolean => {
    entries.push({ text, type })
    return entries.length >= maxLines
  }

  for (const rawLine of (lyric ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    // 预览不展示源歌词自带的元信息行/词级标签
    let line = rawLine.replace(wordTimingRxp, '').trimEnd()
    if (metaTagLineRxp.test(line)) continue
    if (!line) {
      // 连续空行合并为一个
      if (entries.length && entries[entries.length - 1].text !== '') {
        if (push('', 'main')) break
      }
      continue
    }

    const ms = parseTimedLineMs(line)
    if (push(line, 'main')) break
    if (ms == null) continue
    const translation = translationMap.get(ms)?.shift()
    if (translation) {
      if (push(translation, 'translation')) break
    }
    const roma = romaMap.get(ms)?.shift()
    if (roma) {
      if (push(roma, 'roma')) break
    }
  }
  return entries
}
