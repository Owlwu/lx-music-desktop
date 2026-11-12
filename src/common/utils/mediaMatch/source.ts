/**
 * 解析实际使用的歌词来源：优先用户选择，来源缺失/为空时回退另一来源
 */
export const resolveLyricSource = (
  hasEmbedded: boolean,
  hasLrc: boolean,
  preferred: LX.MediaMatch.LyricSource,
): LX.MediaMatch.LyricSource | null => {
  switch (preferred) {
    case 'embedded':
      if (hasEmbedded) return 'embedded'
      return hasLrc ? 'lrc' : null
    case 'lrc':
      if (hasLrc) return 'lrc'
      return hasEmbedded ? 'embedded' : null
    default:
      if (hasEmbedded) return 'embedded'
      return hasLrc ? 'lrc' : null
  }
}

/**
 * 单曲覆盖 > 全局默认 > 内嵌
 */
export const getPreferredLyricSource = (
  override?: LX.MediaMatch.LyricSource | null,
  globalDefault?: LX.MediaMatch.LyricSource | null,
): LX.MediaMatch.LyricSource => {
  return override ?? globalDefault ?? 'embedded'
}
