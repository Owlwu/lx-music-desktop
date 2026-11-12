import { hasInstrumentalMark } from './normalize'
import { validateLyric } from './lrcText'

export interface QqSearchItem {
  id: string
  /**
   * QQ 数字 songid：QRC 逐字接口的 songID 参数
   */
  songId: string
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

/**
 * 数字 id（QQ 的 songid 是 number）统一转成字符串，空值返回 ''
 */
const asIdString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

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
      songId: asIdString(raw.songid),
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

export interface QqWordSyncResponse {
  /**
   * 外层业务码（伪造 songID 时外层仍为 0，必须再看 reqCode）
   */
  code: number
  /**
   * req.code；结构缺失时为 null
   */
  reqCode: number | null
  /**
   * req.data.qrc 是否为 1（1 = 逐字数据）
   */
  qrc: boolean
  /**
   * 逐字 hex 密文；不可用/为空时为 null
   */
  lyric: string | null
}

/**
 * 解析 musicu.fcg GetPlayLyricInfo 响应（外层 code + req.code 两级判定）。
 */
export const parseQqWordSyncResponse = (json: unknown): QqWordSyncResponse => {
  if (!isRecord(json)) return { code: -1, reqCode: null, qrc: false, lyric: null }
  const code = toNumber(json.code) ?? -1
  const req = isRecord(json.req) ? json.req : null
  const reqCode = req == null ? null : toNumber(req.code)
  if (code !== 0 || reqCode !== 0) return { code, reqCode, qrc: false, lyric: null }

  const data = req != null && isRecord(req.data) ? req.data : null
  const qrc = toNumber(data?.qrc) === 1
  const lyric = asString(data?.lyric).trim()
  if (!qrc || !lyric) return { code, reqCode, qrc, lyric: null }
  return { code, reqCode, qrc, lyric }
}

/**
 * 解出 QRC 明文：XML 包裹时取 `LyricContent` 属性并反转义实体，否则按纯文本处理。
 */
export const extractQrcLyricText = (decoded: string): string => {
  if (!decoded) return ''
  const match = /LyricContent="([\s\S]*?)"\s*\/?>/.exec(decoded)
  if (!match) return decoded.replace(/\r\n?/g, '\n').trim()
  return htmlUnescape(match[1]).replace(/\r\n?/g, '\n').trim()
}
