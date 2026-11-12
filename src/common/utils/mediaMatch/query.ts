import { cleanQueryName, normalizeSpace } from './normalize'

const fileExtRxp = /\.[^.\\/]+$/
const fileNameRxp = /^.*[\\/]/

/**
 * 文件名去扩展名（保留原样）
 */
export const getFileStem = (filePath: string): string => {
  const fileName = (filePath ?? '').replace(fileNameRxp, '')
  return fileName.replace(fileExtRxp, '')
}

/**
 * 解析格式化后的歌曲时长（mm:ss）
 */
export const parseDurationSec = (interval: string | null | undefined): number | null => {
  if (!interval) return null
  const result = /^(\d+):(\d{1,2})$/.exec(interval.trim())
  if (!result) return null
  return Number(result[1]) * 60 + Number(result[2])
}

const dedupeVariants = (variants: string[]): string[] => {
  const set = new Set<string>()
  for (const variant of variants) {
    const value = normalizeSpace(variant)
    if (value) set.add(value)
  }
  return [...set]
}

const buildVariants = (name: string, singer: string, fileStem: string): string[] => {
  const variants: string[] = []
  const push = (title: string, artist: string) => {
    const value = normalizeSpace([title, artist].filter(Boolean).join(' '))
    if (value) variants.push(value)
  }

  // 1. 歌名 + 歌手；2. 仅歌名
  push(name, singer)
  push(name, '')

  // 3. 文件名按 " - " 拆分出的两种组合
  if (fileStem) {
    const parts = fileStem.split(/\s+-\s+/)
    if (parts.length > 1) {
      const first = normalizeSpace(parts[0])
      const second = normalizeSpace(parts.slice(1).join(' - '))
      if (first && second) {
        push(first, second)
        push(second, first)
      }
    }
  }

  // 4. 清洗后的歌名再试一次
  const cleanedName = cleanQueryName(name)
  if (cleanedName && cleanedName !== name) push(cleanedName, singer)

  return dedupeVariants(variants)
}

/**
 * 根据歌曲信息生成匹配查询
 */
export const createMatchQuery = (musicInfo: LX.Music.MusicInfo): LX.MediaMatch.MatchQuery => {
  const name = normalizeSpace(musicInfo.name ?? '')
  const singer = normalizeSpace(musicInfo.singer ?? '')
  const albumName = normalizeSpace(musicInfo.meta?.albumName ?? '')
  const fileStem = getFileStem(musicInfo.meta?.filePath ?? '')
  const durationSec = parseDurationSec(musicInfo.interval)

  return {
    name,
    singer,
    albumName,
    durationSec,
    fileStem,
    variants: buildVariants(name, singer, fileStem),
  }
}

/**
 * 用户手动输入关键词时的查询（歌手/专辑不参与结构化查询）
 */
export const createKeywordQuery = (keyword: string, musicInfo: LX.Music.MusicInfo): LX.MediaMatch.MatchQuery => {
  const name = normalizeSpace(keyword)
  return {
    name,
    singer: '',
    albumName: '',
    durationSec: parseDurationSec(musicInfo.interval),
    fileStem: getFileStem(musicInfo.meta?.filePath ?? ''),
    variants: dedupeVariants([name, cleanQueryName(name)]),
  }
}

/**
 * LRCLIB 结构化搜索 0 条时的 `q=` 回退关键词（按优先级）
 * 首项固定为 `name singer`，不因与结构化参数重复而排除；没有歌手时退化为 `name`。
 */
export const buildLrclibKeywordFallbacks = (query: LX.MediaMatch.MatchQuery): string[] => {
  const keywords: string[] = []
  const push = (value: string) => {
    const keyword = normalizeSpace(value)
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword)
  }

  push([query.name, query.singer].filter(Boolean).join(' '))
  push(query.name)
  const cleanedName = cleanQueryName(query.name)
  if (cleanedName) push(cleanedName)

  return keywords
}
