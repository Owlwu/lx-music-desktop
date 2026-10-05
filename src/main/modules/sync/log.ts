import { log as writeLog } from '@common/utils'

/**
 * `info`/`warn`/`error` 是同步过程的诊断日志：在设置里打开「同步日志」
 * （`global.lx.isEnableSyncLog`）后写入日志文件，否则只输出到控制台。
 * `r_*` 系列始终写文件，用于关键事件与错误。
 */
export default {
  r_info(...params: any[]) {
    writeLog.info(...params)
  },
  r_warn(...params: any[]) {
    writeLog.warn(...params)
  },
  r_error(...params: any[]) {
    writeLog.error(...params)
  },
  info(...params: any[]) {
    if (global.lx?.isEnableSyncLog) writeLog.info(...params)
    else console.log(...params)
  },
  warn(...params: any[]) {
    if (global.lx?.isEnableSyncLog) writeLog.warn(...params)
    else console.warn(...params)
  },
  error(...params: any[]) {
    if (global.lx?.isEnableSyncLog) writeLog.error(...params)
    else console.warn(...params)
  },
}
