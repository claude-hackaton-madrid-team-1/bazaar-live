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
