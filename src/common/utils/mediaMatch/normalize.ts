const fullWidthRxp = /[\uFF01-\uFF5E]/g
const fullWidthSpaceRxp = /\u3000/g
const bracketRxp = /[（(【[<][^）)】\]>]*[）)】\]>]/g
const suffixRxp = /(?:^|\s)(?:off\s*vocal|instrumental|inst\.?|tv\s*(?:ver\.?|size)|short\s*ver\.?|karaoke|カラオケ|纯音乐)(?=$|\s)/gi
const featRxp = /\s(?:feat\.?|ft\.?)\s.*$/i

/**
 * 全角转半角
 */
export const toHalfWidth = (str: string): string => {
  return (str ?? '')
    .replace(fullWidthRxp, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(fullWidthSpaceRxp, ' ')
}

/**
 * 压缩连续空白
 */
export const normalizeSpace = (str: string): string => (str ?? '').replace(/\s+/g, ' ').trim()

/**
 * 打分用的归一化：全角转半角、小写、只保留字母/数字（等价于去空白、标点、括号）
 */
export const normalizeKey = (str: string): string => {
  return toHalfWidth(str).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * 关键字搜索用的清洗：去括号内容、常见后缀标记、feat. 合作歌手
 */
export const cleanQueryName = (str: string): string => {
  let name = toHalfWidth(str)
  name = name.replace(bracketRxp, ' ')
  name = name.replace(featRxp, ' ')
  name = name.replace(suffixRxp, ' ')
  return normalizeSpace(name)
}

/**
 * 查询名/文件名是否带有纯音乐标记
 */
export const hasInstrumentalMark = (str: string): boolean => {
  return /off\s*vocal|instrumental|\binst(?![a-z])|カラオケ|纯音乐/i.test(str ?? '')
}
