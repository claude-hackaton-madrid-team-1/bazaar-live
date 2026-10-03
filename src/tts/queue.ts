/**
 * One voice at a time. Every `say()` waits its turn, and resolves when its line was spoken, skipped
 * (muted or cleared) or failed, so the stage can await it without ever hanging:
 *
 * - a watchdog ends a line that never reports its end (Chrome's speechSynthesis sometimes never fires
 *   `end`), sized to the text;
 * - a failing provider falls back to `fallback` for that line, and after `maxFailures` failures in a
 *   row the queue uses the fallback alone for `coolDownMs`.
 */
import type { Lang } from '../../shared/lang.ts'
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
  /** The language being shown now: a line of another language is never spoken (it resolves unspoken). */
  readonly currentLang?: () => Lang
}

interface Pending {
  readonly u: Utterance
  /** Called with whether the line was really spoken (not muted, cleared, refused or timed out). */
  readonly done: (heard: boolean) => void
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

  /** Resolves when the line is over: true when a voice really said it, false when it was skipped or failed. */
  say(u: Utterance): Promise<boolean> {
    if (this.isMuted || this.staleLang(u)) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      this.pending = [...this.pending, { u, done: resolve }]
      this.active().prefetch?.(u)
      void this.drain()
    })
  }

  /** Ask the active provider to fetch a line's audio ahead of time (no-op for local voices). */
  prefetch(u: Utterance): void {
    if (!this.isMuted && !this.staleLang(u)) this.active().prefetch?.(u)
  }

  private staleLang(u: Utterance): boolean {
    const current = this.opts.currentLang?.()
    return current !== undefined && u.lang !== current
  }

  /** Drop everything: the current line stops, waiting lines resolve unspoken. */
  clear(): void {
    this.flush()
  }

  private flush(): void {
    const waiting = this.pending
    this.pending = []
    waiting.forEach((p) => p.done(false))
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
        next.done(await this.speakOne(next.u))
      }
    } finally {
      this.running = false
      this.opts.onSpeaking?.(null)
    }
  }

  private async speakOne(u: Utterance): Promise<boolean> {
    // A line queued before the language changed is dropped here too, never spoken with the new voices.
    if (this.isMuted || this.staleLang(u)) return false
    const provider = this.active()
    this.opts.onSpeaking?.(u)
    try {
      const heard = await this.withWatchdog(provider, u)
      if (provider === this.provider) this.failures = 0
      return heard
    } catch (error: unknown) {
      this.opts.onError?.(error, u, provider.name)
      if (provider !== this.provider || !this.fallback || this.isMuted) return false
      this.failures += 1
      if (this.failures >= this.opts.maxFailures) this.degradedUntil = this.opts.now() + this.opts.coolDownMs
      try {
        return await this.withWatchdog(this.fallback, u)
      } catch (fallbackError: unknown) {
        this.opts.onError?.(fallbackError, u, this.fallback.name)
        return false
      }
    }
  }

  /** Resolves true when the provider finished the line, false when it was aborted or the watchdog ended it. */
  private withWatchdog(provider: SpeechProvider, u: Utterance): Promise<boolean> {
    const controller = new AbortController()
    this.current = controller
    return new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort()
        resolve(false)
      }, this.opts.timeoutMs(u))
      const finish = (error?: unknown) => {
        clearTimeout(timer)
        if (this.current === controller) this.current = null
        if (controller.signal.aborted) resolve(false)
        else if (error === undefined) resolve(true)
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
