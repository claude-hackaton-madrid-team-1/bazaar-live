/** Guards for the public proxy: token buckets (per address and global) and a small audio cache. */

export interface BucketOptions {
  /** Burst size. */
  readonly capacity: number
  /** Tokens added per second. */
  readonly refillPerSecond: number
}

interface Bucket {
  readonly tokens: number
  readonly at: number
}

/** Token buckets by key. `take(key)` spends one token, or answers how long to wait. */
export class RateLimiter {
  private buckets = new Map<string, Bucket>()
  private readonly opts: BucketOptions
  private readonly now: () => number
  private readonly maxKeys: number

  constructor(opts: BucketOptions, now: () => number = () => Date.now(), maxKeys = 10_000) {
    this.opts = opts
    this.now = now
    this.maxKeys = maxKeys
  }

  /** Whether `take(key)` would succeed now, without spending anything. */
  peek(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const prev = this.buckets.get(key)
    if (!prev) return { ok: true }
    const refilled = Math.min(this.opts.capacity, prev.tokens + ((this.now() - prev.at) / 1000) * this.opts.refillPerSecond)
    return refilled >= 1 ? { ok: true } : { ok: false, retryAfterSeconds: Math.ceil((1 - refilled) / this.opts.refillPerSecond) }
  }

  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const now = this.now()
    const prev = this.buckets.get(key) ?? { tokens: this.opts.capacity, at: now }
    const refilled = Math.min(this.opts.capacity, prev.tokens + ((now - prev.at) / 1000) * this.opts.refillPerSecond)
    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, at: now })
      return { ok: false, retryAfterSeconds: Math.ceil((1 - refilled) / this.opts.refillPerSecond) }
    }
    this.buckets.delete(key)
    this.buckets.set(key, { tokens: refilled - 1, at: now })
    if (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value
      if (oldest !== undefined) this.buckets.delete(oldest)
    }
    return { ok: true }
  }
}

/** Characters sent upstream per UTC day: the hard ceiling on what the paid voices can cost. */
export class DailyBudget {
  private day = ''
  private used = 0
  private readonly limit: number
  private readonly now: () => number

  constructor(limit: number, now: () => number = () => Date.now()) {
    this.limit = limit
    this.now = now
  }

  private roll(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10)
    if (today !== this.day) {
      this.day = today
      this.used = 0
    }
  }

  allows(chars: number): boolean {
    this.roll()
    return this.used + chars <= this.limit
  }

  spend(chars: number): void {
    this.roll()
    this.used += chars
  }

  get remaining(): number {
    this.roll()
    return Math.max(0, this.limit - this.used)
  }
}

/** Rate limits for /api/tts, overridable from the environment (the paid voices bill per character). */
export interface TtsLimits {
  readonly perAddressBurst: number
  readonly perAddressPerMinute: number
  readonly globalBurst: number
  readonly globalPerMinute: number
  /** Characters sent to a provider per UTC day, all callers together. */
  readonly dailyChars: number
  /** The header Railway's edge sets to the caller's address. */
  readonly clientIpHeader: string
}

/** One address gets a third of the global rate, so a single caller can never drain it for everyone. */
export const DEFAULT_LIMITS: TtsLimits = {
  perAddressBurst: 40,
  perAddressPerMinute: 24,
  globalBurst: 160,
  globalPerMinute: 72,
  dailyChars: 40_000,
  clientIpHeader: 'x-real-ip',
}

export function readLimits(env: Readonly<Record<string, string | undefined>>): TtsLimits {
  const read = (name: string, fallback: number) => {
    const n = Number(env[name])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const header = env.TTS_CLIENT_IP_HEADER?.trim().toLowerCase()
  return {
    perAddressBurst: read('TTS_PER_ADDRESS_BURST', DEFAULT_LIMITS.perAddressBurst),
    perAddressPerMinute: read('TTS_PER_ADDRESS_PER_MINUTE', DEFAULT_LIMITS.perAddressPerMinute),
    globalBurst: read('TTS_GLOBAL_BURST', DEFAULT_LIMITS.globalBurst),
    globalPerMinute: read('TTS_GLOBAL_PER_MINUTE', DEFAULT_LIMITS.globalPerMinute),
    dailyChars: read('TTS_DAILY_CHARS', DEFAULT_LIMITS.dailyChars),
    clientIpHeader: header && /^[a-z0-9-]{1,40}$/.test(header) ? header : DEFAULT_LIMITS.clientIpHeader,
  }
}

/** Least-recently-used cache with a byte budget. */
export class LruCache<V extends { readonly body: { readonly length: number } }> {
  private entries = new Map<string, V>()
  private bytes = 0
  private readonly maxBytes: number

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key)
    if (hit === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit
  }

  set(key: string, value: V): void {
    const old = this.entries.get(key)
    if (old) this.bytes -= old.body.length
    this.entries.delete(key)
    if (value.body.length > this.maxBytes) return
    this.entries.set(key, value)
    this.bytes += value.body.length
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const evicted = this.entries.get(oldest.value)
      this.entries.delete(oldest.value)
      this.bytes -= evicted?.body.length ?? 0
    }
  }

  get size(): number {
    return this.entries.size
  }
}
