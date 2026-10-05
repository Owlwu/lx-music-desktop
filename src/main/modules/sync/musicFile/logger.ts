/**
 * 本地音乐文件同步的诊断日志。
 *
 * 与移动端 `lx-music-mobile/src/plugins/sync/client/modules/musicFile/logger.ts`
 * 使用完全相同的前缀格式，便于把两端日志直接对照分析。
 *
 * 级别策略：
 * - `warn` / `err` / `fatal`：**始终写入日志文件**，保证出问题时一定有证据。
 * - `info`：高频过程信息，受「同步错误日志」开关控制（`global.lx.isEnableSyncLog`）。
 */
import log from '../log'

const tag = (level: string, scope: string, msg: string) => `[musicFileSync][${level}][${scope}] ${msg}`

const fmt = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack ?? v.message
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const join = (parts: unknown[]) => parts.map(fmt).join(' ')

export default {
  /** 常规诊断信息（受开关控制） */
  info(scope: string, ...parts: unknown[]) {
    log.info(tag('INFO', scope, join(parts)))
  },
  /** 警告：始终落盘 */
  warn(scope: string, ...parts: unknown[]) {
    log.r_warn(tag('WARN', scope, join(parts)))
  },
  /** 错误：始终落盘 */
  err(scope: string, ...parts: unknown[]) {
    log.r_error(tag('ERROR', scope, join(parts)))
  },
  /** 关键故障：始终落盘（与 err 同义，用于语义强调） */
  fatal(scope: string, ...parts: unknown[]) {
    log.r_error(tag('ERROR', scope, join(parts)))
  },
}
