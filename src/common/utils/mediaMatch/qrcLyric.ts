/**
 * QQ QRC 歌词 -> 行级 LRC + LX 逐字歌词（lxlyric）的纯逻辑转换。
 *
 * QRC 原始格式（词级标签在文字之后，start 为绝对毫秒）：
 *   [行startMs,行durMs]字(词startMs,词durMs)字(...)…
 *
 * 输出契约（以桌面端 line-player / font-player 为准）：
 *   行级 lyric：  [mm:ss.xxx]行文本
 *   逐字 lxlyric：[mm:ss.xxx]<相对行首start,dur>字…（行标签 3 位小数 = 毫秒）
 *
 * 关键规则：
 *  - 只处理以 `[数字,数字]` 开头的行，[ti:]/[ar:]/[by:]/[kana:] 等一律丢弃
 *    （[kana:] 里混着 (a,b) 数字，不过滤会产出幽灵字）；
 *  - 词级 start 从绝对毫秒换成相对行首，负数按 0 截断；
 *  - 行级正文 = 同一行去掉词级标签；无词级标签的行只进行级，不进 lxlyric；
 *  - 空文本 token、空白行丢弃；不自行插入间奏空行；[offset:] 两份都保留。
 */
import { buildExtendedLrcText } from './lrcText'
export interface QrcLyricResult {
  /**
   * 行级 LRC：`[mm:ss.xxx]正文`
   */
  lyric: string
  /**
   * 逐字：`[mm:ss.xxx]<相对行首毫秒,时长毫秒>字...`
   */
  lxlyric: string
  /**
   * 有效时间轴行数（两份歌词共用的行数）
   */
  lineCount: number
  /**
   * 含词级标签的行数
   */
  wordLineCount: number
  /**
   * 词级标签总数（只统计写进 lxlyric 的 token）
   */
  wordTagCount: number
}

interface QrcWord {
  start: number
  dur: number
  text: string
}

const LINE_TAG_RXP = /^\[(\d+),(\d+)]/
const OFFSET_TAG_RXP = /^\[offset:/i
const TIMED_LINE_RXP = /^\[\d{1,3}:\d{2}\.\d{3}]/
const WORD_LINE_RXP = /^\[\d{1,3}:\d{2}\.\d{3}]<\d+,\d+>/

/**
 * 毫秒 -> `[mm:ss.xxx]`；必须固定 3 位小数，否则会被桌面端当百分秒解析。
 */
const formatLxTime = (ms: number): string => {
  const n = Math.max(0, Math.round(ms))
  const m = Math.floor(n / 60000)
  const s = Math.floor((n % 60000) / 1000)
  const f = n % 1000
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}]`
}

/**
 * 按「标签在文字之后」切出词级 token；返回的每个 token 时间均为绝对毫秒。
 */
const tokenizeWords = (body: string): QrcWord[] => {
  const wordTagRxp = /\((\d+),(\d+)\)/g
  const words: QrcWord[] = []
  let lastEnd = 0
  let match: RegExpExecArray | null
  while ((match = wordTagRxp.exec(body)) != null) {
    words.push({
      start: Number(match[1]),
      dur: Number(match[2]),
      text: body.slice(lastEnd, match.index),
    })
    lastEnd = match.index + match[0].length
  }
  return words
}

/**
 * 解析 QRC 明文，同时产出可写入 `.lrc` 正文的行级歌词与 `[awlrc:]` 里的 lxlyric。
 */
export const parseQrcLyric = (qrcText: string): QrcLyricResult => {
  const source = (qrcText ?? '').replace(/\r\n?/g, '\n')
  const offsetTags: string[] = []
  const lyricLines: string[] = []
  const lxlyricLines: string[] = []
  let wordLineCount = 0
  let wordTagCount = 0

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // [offset:] 两份都保留；其余非时间轴标签（ti/ar/al/by/kana/language…）直接丢弃
    if (OFFSET_TAG_RXP.test(line)) {
      offsetTags.push(line)
      continue
    }
    const lineTag = LINE_TAG_RXP.exec(line)
    if (!lineTag) continue

    const start = Number(lineTag[1])
    const body = line.slice(lineTag[0].length)
    // 行级正文 = 同一行去掉所有词级标签（无词级标签的行也保留整行文字）
    const text = body.replace(/\(\d+,\d+\)/g, '')
    // 词级标签必须在文字之后，空文本 token 不产出字（避免出现 `<a,b>` 后没有文字）
    const words = tokenizeWords(body).filter(word => word.text !== '')
    // 行级与逐字使用同一批行、同一时间标签，保证「行级 ⇄ 逐字」切换不跳行
    if (!text.trim()) continue

    const time = formatLxTime(start)
    lyricLines.push(`${time}${text}`)
    if (!words.length) continue

    wordLineCount++
    wordTagCount += words.length
    lxlyricLines.push(time + words.map(word => {
      const rel = Math.max(0, Math.round(word.start - start))
      return `<${rel},${Math.max(0, Math.round(word.dur))}>${word.text}`
    }).join(''))
  }

  const header = offsetTags.join('\n')
  const joinLines = (lines: string[]): string => {
    if (!header) return lines.join('\n')
    return [header, ...lines].join('\n')
  }

  return {
    lyric: joinLines(lyricLines),
    lxlyric: joinLines(lxlyricLines),
    lineCount: lyricLines.length,
    wordLineCount,
    wordTagCount,
  }
}

/**
 * 逐字可用性：至少一行带词级标签，且 lxlyric 的首个时间轴行必须以 `<a,b>` 开头。
 * 桌面端只看第一行判断整份是否逐字（首行若没有词标签，整份退化为行模式）。
 */
export const isUsableWordSync = (result: QrcLyricResult): boolean => {
  if (result.wordLineCount < 1) return false
  const firstTimedLine = result.lxlyric.split('\n').find(line => TIMED_LINE_RXP.test(line))
  return firstTimedLine != null && WORD_LINE_RXP.test(firstTimedLine)
}

/**
 * 拼最终 `.lrc` 文本：正文 + 空行 + `[awlrc:lrc:<b64>,awlrc:<b64-lxlyric>]` + 结尾换行。
 * 标签必须独占一行；`lrc:` 段会覆盖正文，因此两段必须来自同一份文本。
 * 现为 `buildExtendedLrcText` 的薄封装：翻译/罗马音扩展段由同一条拼装逻辑处理。
 */
export const buildAwlrcLrcText = (body: string, lxlyric: string): string => {
  return buildExtendedLrcText(body, { lxlyric })
}
