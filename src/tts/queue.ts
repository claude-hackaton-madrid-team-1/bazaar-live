/**
 * One voice at a time. Every `say()` waits its turn, and resolves when its line was spoken, skipped
 * (muted or cleared) or failed, so the stage can await it without ever hanging:
 *
 * - a watchdog ends a line that never reports its end (Chrome's speechSynthesis sometimes never fires
 *   `end`), sized to the text;
 * - a failing provider falls back to `fallback` for that line, and after `maxFailures` failures in a
 *   row the queue uses the fallback alone for `coolDownMs`.
 */
import type { ProviderName, SpeechProvider, Utterance } from './types'

export interface QueueOptions {
  readonly provider: SpeechProvider
  readonly fallback?: SpeechProvider
  readonly maxFailures?: number
  readonly coolDownMs?: number
  readonly now?: () => number
  /** How long a line may take before the watchdog ends it. */
  readonly timeoutMs?: (u: Utterance) => number
  readonly onError?: (error: unknown, u: Utterance, provider: ProviderName) => void
  readonly onSpeaking?: (u: Utterance | null) => void
}

interface Pending {
  readonly u: Utterance
  readonly done: () => void
}

const defaultTimeout = (u: Utterance): number => 6000 + u.text.length * 90

export class SpeechQueue {
  private provider: SpeechProvider
  private readonly fallback: SpeechProvider | undefined
  private readonly opts: Required<Pick<QueueOptions, 'maxFailures' | 'coolDownMs' | 'now' | 'timeoutMs'>> & QueueOptions
  private pending: Pending[] = []
  private current: AbortController | null = null
  private running = false
  private failures = 0
  private degradedUntil = 0
  private isMuted = false

  constructor(options: QueueOptions) {
    this.opts = { maxFailures: 3, coolDownMs: 60_000, now: () => Date.now(), timeoutMs: defaultTimeout, ...options }
    this.provider = options.provider
    this.fallback = options.fallback
  }

  get muted(): boolean {
    return this.isMuted
  }

  get providerName(): ProviderName {
    return this.active().name
  }

  /** A real voice is on: not muted and not the silent provider. */
  get audible(): boolean {
    return !this.isMuted && this.active().name !== 'silent'
  }

  /** Lines waiting, not counting the one being spoken. */
  get backlog(): number {
    return this.pending.length
  }

  setProvider(provider: SpeechProvider): void {
    this.provider = provider
    this.failures = 0
    this.degradedUntil = 0
  }

  /** Muting stops the current line and lets every waiting line resolve at once. */
  setMuted(muted: boolean): void {
    this.isMuted = muted
    if (muted) this.flush()
  }

  say(u: Utterance): Promise<void> {
    if (this.isMuted) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.pending = [...this.pending, { u, done: resolve }]
      this.active().prefetch?.(u)
      void this.drain()
    })
  }

  /** Ask the active provider to fetch a line's audio ahead of time (no-op for local voices). */
  prefetch(u: Utterance): void {
    if (!this.isMuted) this.active().prefetch?.(u)
  }

  /** Drop everything: the current line stops, waiting lines resolve unspoken. */
  clear(): void {
    this.flush()
  }

  private flush(): void {
    const waiting = this.pending
    this.pending = []
    waiting.forEach((p) => p.done())
    this.current?.abort()
  }

  private active(): SpeechProvider {
    if (this.fallback && this.opts.now() < this.degradedUntil) return this.fallback
    return this.provider
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const [next, ...rest] = this.pending
        if (!next) break
        this.pending = rest
        await this.speakOne(next.u)
        next.done()
      }
    } finally {
      this.running = false
      this.opts.onSpeaking?.(null)
    }
  }

  private async speakOne(u: Utterance): Promise<void> {
    if (this.isMuted) return
    const provider = this.active()
    this.opts.onSpeaking?.(u)
    try {
      await this.withWatchdog(provider, u)
      if (provider === this.provider) this.failures = 0
    } catch (error: unknown) {
      this.opts.onError?.(error, u, provider.name)
      if (provider !== this.provider || !this.fallback || this.isMuted) return
      this.failures += 1
      if (this.failures >= this.opts.maxFailures) this.degradedUntil = this.opts.now() + this.opts.coolDownMs
      try {
        await this.withWatchdog(this.fallback, u)
      } catch (fallbackError: unknown) {
        this.opts.onError?.(fallbackError, u, this.fallback.name)
      }
    }
  }

  private withWatchdog(provider: SpeechProvider, u: Utterance): Promise<void> {
    const controller = new AbortController()
    this.current = controller
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort()
        resolve()
      }, this.opts.timeoutMs(u))
      const finish = (error?: unknown) => {
        clearTimeout(timer)
        if (this.current === controller) this.current = null
        if (error === undefined || controller.signal.aborted) resolve()
        else reject(error instanceof Error ? error : new Error(String(error)))
      }
      controller.signal.addEventListener('abort', () => finish(), { once: true })
      let speaking: Promise<void>
      try {
        speaking = provider.speak(u, controller.signal)
      } catch (error: unknown) {
        finish(error ?? new Error('speech failed'))
        return
      }
      speaking.then(
        () => finish(),
        (error: unknown) => finish(error ?? new Error('speech failed')),
      )
    })
  }
}
