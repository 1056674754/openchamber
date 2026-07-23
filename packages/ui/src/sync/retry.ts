export interface RetryOptions {
  attempts?: number
  delay?: number
  factor?: number
  maxDelay?: number
  jitter?: number
  random?: () => number
  signal?: AbortSignal
  retryIf?: (error: unknown) => boolean
}

const TRANSIENT_MESSAGES = [
  "load failed",
  "network connection was lost",
  "network request failed",
  "failed to fetch",
  "econnreset",
  "econnrefused",
  "etimedout",
  "socket hang up",
  "opencode api unavailable",
  "503",
  "502",
]

const readErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined
  const direct = (error as { status?: unknown }).status
  if (typeof direct === "number") return direct
  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === "number" ? response.status : undefined
}

const readRetryAfterMs = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function isTransientError(error: unknown): boolean {
  if (!error) return false
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  if (TRANSIENT_MESSAGES.some((m) => message.includes(m))) return true
  const status = readErrorStatus(error)
  if (status === 408 || status === 429) return true
  if (typeof status === "number" && status >= 500 && status < 600) return true
  return false
}

type RetryDelayOptions = Required<Pick<RetryOptions, "delay" | "factor" | "maxDelay" | "jitter" | "random">>

export function computeRetryDelayMs(
  error: unknown,
  attempt: number,
  options: RetryDelayOptions,
): number {
  const retryAfterMs = readRetryAfterMs(error)
  const exponentialDelay = Math.min(options.delay * Math.pow(options.factor, attempt), options.maxDelay)
  const baseDelay = retryAfterMs ?? exponentialDelay
  const jitter = Math.max(0, Math.min(1, options.jitter))
  const random = Math.max(0, Math.min(1, options.random()))
  return Math.round(baseDelay * (1 + jitter * random))
}

export function applyBoundedRetryJitter(
  delayMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  const normalizedRandom = Math.max(0, Math.min(1, random()))
  const multiplier = 0.8 + normalizedRandom * 0.4
  return Math.min(capMs, Math.round(delayMs * multiplier))
}

const createAbortError = (): Error => {
  const error = new Error("Retry aborted")
  error.name = "AbortError"
  return error
}

const waitForRetryDelay = (delayMs: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(createAbortError())
    return
  }

  const timer = setTimeout(() => {
    cleanup()
    resolve()
  }, delayMs)
  const cleanup = () => {
    clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
  const onAbort = () => {
    cleanup()
    reject(createAbortError())
  }
  signal?.addEventListener("abort", onAbort, { once: true })
})

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    delay = 500,
    factor = 2,
    maxDelay = 10000,
    jitter = 0,
    random = Math.random,
    signal,
    retryIf = isTransientError,
  } = options

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) throw createAbortError()
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1 || !retryIf(error)) throw error
      const wait = computeRetryDelayMs(error, attempt, { delay, factor, maxDelay, jitter, random })
      await waitForRetryDelay(wait, signal)
    }
  }
  throw lastError
}
