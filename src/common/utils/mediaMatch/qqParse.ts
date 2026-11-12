import { hasInstrumentalMark } from './normalize'
import { validateLyric } from './lrcText'

export interface QqSearchItem {
  id: string
  name: string
  singer: string
  albumName: string
  durationSec: number | null
  instrumental: boolean
}

export interface QqLyricParseResult {
  /**
   * QQ 接口业务码（HTTP 恒 200，错误看 code/retcode）
   */
  code: number
  /**
   * 校验通过的歌词文本；null = 无歌词/占位文本/格式无效
   */
  lyric: string | null
  isSynced: boolean
  placeholder: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const asString = (value: unknown): string => typeof value === 'string' ? value : ''

const toNumber = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/**
 * 解码 QQ 歌词里可能出现的 HTML 实体
 */
export const htmlUnescape = (str: string): string => {
  return (str ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * 解析 QQ client_search_cp 搜索结果（只取候选元数据）
 */
export const parseQqSearchResponse = (json: unknown): QqSearchItem[] => {
  if (!isRecord(json) || toNumber(json.code) !== 0) return []
  const data = json.data
  if (!isRecord(data)) return []
  const song = data.song
  if (!isRecord(song) || !Array.isArray(song.list)) return []

  const items: QqSearchItem[] = []
  for (const raw of song.list) {
    if (!isRecord(raw)) continue
    const id = asString(raw.songmid)
    if (!id) continue
    const name = asString(raw.songname)
    const singers = Array.isArray(raw.singer)
      ? raw.singer.map(item => isRecord(item) ? asString(item.name) : '').filter(Boolean)
      : []
    const interval = toNumber(raw.interval)
    items.push({
      id,
      name,
      singer: singers.join(' / '),
      albumName: asString(raw.albumname),
      durationSec: interval == null ? null : Math.round(interval),
      instrumental: hasInstrumentalMark(name),
    })
  }
  return items
}

/**
 * 解析 QQ fcg_query_lyric_new.fcg 响应（nobase64=1 明文 LRC）
 */
const base64CharsRxp = /^[A-Za-z0-9+/=]+$/

const decodeBase64Lyric = (text: string): string | null => {
  const compact = text.replace(/\s+/g, '')
  if (compact.length < 8 || compact.length % 4 !== 0) return null
  if (!base64CharsRxp.test(compact)) return null
  if (typeof Buffer === 'undefined') return null
  try {
    const decoded = Buffer.from(compact, 'base64').toString('utf8')
    if (!decoded || decoded === compact) return null
    // 乱码/二进制会让 UTF-8 解码出现替换字符
    if (decoded.includes('\uFFFD')) return null
    return decoded
  } catch {
    return null
  }
}

const looksLikeDecodedLyric = (text: string): boolean => {
  // 真正的歌词至少有 LRC 标签/方括号结构，或包含中文等非 ASCII 文本
  return text.includes('[') || text.includes(']') || /[\u0080-\uFFFF]/.test(text)
}

export const parseQqLyricResponse = (json: unknown): QqLyricParseResult => {
  if (!isRecord(json)) return { code: -1, lyric: null, isSynced: false, placeholder: false }
  const code = toNumber(json.code) ?? toNumber(json.retcode) ?? -1
  if (code !== 0) return { code, lyric: null, isSynced: false, placeholder: false }

  const text = asString(json.lyric)
  if (!text) return { code, lyric: null, isSynced: false, placeholder: false }

  let lyric = htmlUnescape(text)
  let validation = validateLyric(lyric)
  // 兼容旧版/异常响应仍返回 base64 的情况：无时间标签且呈 base64 形态时先解码再校验
  if (!validation.isSynced) {
    const decoded = decodeBase64Lyric(lyric)
    if (decoded && looksLikeDecodedLyric(decoded)) {
      lyric = decoded
      validation = validateLyric(lyric)
    }
  }

  if (!validation.usable) {
    return {
      code,
      lyric: null,
      isSynced: validation.isSynced,
      placeholder: validation.placeholder,
    }
  }
  return {
    code,
    lyric,
    isSynced: validation.isSynced,
    placeholder: false,
  }
}
