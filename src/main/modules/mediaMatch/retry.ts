/**
 * 服务端 Retry-After 超过该值（30s）时放弃本次重试，避免提前重试
 */
export const RETRY_AFTER_LIMIT_MS = 30 * 1000

/**
 * 解析 Retry-After（秒或 HTTP-date）为毫秒；无法解析返回 null
 */
export const parseRetryAfterMs = (value?: string, now: number = Date.now()): number | null => {
  const raw = value?.trim()
  if (!raw) return null

  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(seconds * 1000, 0)

  const date = Date.parse(raw)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

/**
 * 计算重试等待时间：
 * - 服务端给了 Retry-After：>30s 返回 null（放弃重试）；否则严格按服务端值
 * - 未给 Retry-After：指数退避 500ms * (attempt + 1)
 * 调用方只能在此基础上增加抖动，不得低于返回值。
 */
export const resolveRetryDelayMs = (retryAfterMs: number | null, attempt: number): number | null => {
  if (retryAfterMs != null) {
    if (retryAfterMs > RETRY_AFTER_LIMIT_MS) return null
    return retryAfterMs
  }
  return 500 * (attempt + 1)
}
