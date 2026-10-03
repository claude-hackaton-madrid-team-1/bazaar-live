/**
 * The show engine: events in, scenes out. Framework-free; React reads it with useSyncExternalStore.
 *
 * Live events become beats for the director; the runner plays one beat at a time: it sets the cue
 * (cards fly, dealers pop in, the stop sign shakes), then says each line, waiting for the voice (or a
 * reading time when muted) before the next. Replayed history goes straight to the transcript.
 */
import type { AgentHealth, AgentId, OpenOffer, ShowEvent } from '../model/events'
import type { FeedStatus } from '../net/feed'
import type { SpeechQueue } from '../tts/queue'
import type { Beat, Cue, DealerId, Line, Side } from './beat'
import { toBeat, idleBeat } from './dialogue'
import { Director } from './director'

export interface BoardCard {
  readonly key: string
  readonly ref: string
  readonly side: Side
  readonly price: number | null
  /** Bumps on every reprice, so the tag can flash. */
  readonly version: number
}

export interface TranscriptEntry {
  readonly id: string
  readonly tick: number | null
  readonly speaker: Line['speaker']
  readonly text: string
  /** played: acted out; history: replayed on join; skipped: dropped on a busy tick. */
  readonly kind: 'played' | 'history' | 'skipped'
}

export interface Flash {
  /** Increments on each occurrence: a React key that restarts the animation. */
  readonly n: number
}

export interface ShowState {
  readonly beat: Beat | null
  readonly line: Line | null
  readonly board: readonly BoardCard[]
  readonly dealer: { readonly id: DealerId; readonly move: string } | null
  readonly reach: (Flash & { readonly ref: string; readonly price: number | null; readonly take: boolean }) | null
  readonly deal: (Flash & { readonly big: boolean }) | null
  readonly denied: Flash | null
  readonly fail: (Flash & { readonly code: string }) | null
  readonly jev: (Flash & { readonly verdict: string; readonly agent: AgentId }) | null
  readonly heartbeat: Readonly<Record<AgentId, number>>
  readonly ticks: Readonly<Record<AgentId, number | null>>
  readonly health: Readonly<Record<AgentId, AgentHealth | null>>
  readonly feeds: Readonly<Record<AgentId, FeedStatus>>
  readonly transcript: readonly TranscriptEntry[]
  readonly lastEventAt: number | null
}

const MAX_TRANSCRIPT = 240
const MAX_BOARD = 8
const IDLE_AFTER_MS = 50_000
const NOTIFY_MS = 16

export const INITIAL_STATE: ShowState = {
  beat: null,
  line: null,
  board: [],
  dealer: null,
  reach: null,
  deal: null,
  denied: null,
  fail: null,
  jev: null,
  heartbeat: { taker: 0, maker: 0 },
  ticks: { taker: null, maker: null },
  health: { taker: null, maker: null },
  feeds: { taker: 'idle', maker: 'idle' },
  transcript: [],
  lastEventAt: null,
}

/** How long a line stays on screen without a voice: enough to read it, quicker when the queue is long. */
export function readingMs(text: string, backlog: number): number {
  const base = Math.min(4800, 1100 + text.length * 42)
  return backlog > 3 ? base * 0.6 : base
}

export interface EngineOptions {
  readonly speech: SpeechQueue
  readonly director?: Director
  /** Ambient banter when nothing happened for a while (off in tests). */
  readonly idle?: boolean
  readonly sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function cardKey(ref: string, side: Side): string {
  return `${side}:${ref}`
}

/** The board after one cue: post adds, reprice updates, cancel removes. */
export function applyToBoard(board: readonly BoardCard[], cue: Cue): readonly BoardCard[] {
  if (cue.kind !== 'post' && cue.kind !== 'reprice' && cue.kind !== 'cancel') return board
  const key = cardKey(cue.ref, cue.side)
  const existing = board.find((c) => c.key === key)
  if (cue.kind === 'cancel') return board.filter((c) => c.key !== key)
  if (existing) {
    return board.map((c) => (c.key === key ? { ...c, price: cue.price ?? c.price, version: c.version + 1 } : c))
  }
  const added: BoardCard = { key, ref: cue.ref, side: cue.side, price: cue.price, version: 0 }
  return [...board, added].slice(-MAX_BOARD)
}

export class ShowEngine {
  private state: ShowState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private readonly speech: SpeechQueue
  private readonly director: Director
  private readonly sleep: (ms: number) => Promise<void>
  private readonly idle: boolean
  private wake: (() => void) | null = null
  /** Each start() bumps it; an older run loop sees the change and exits (React StrictMode restarts). */
  private generation = 0
  private running = false
  private idleCount = 0
  private counter = 0
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: EngineOptions) {
    this.speech = options.speech
    this.director = options.director ?? new Director()
    this.sleep = options.sleep ?? defaultSleep
    this.idle = options.idle ?? true
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ShowState => this.state

  private set(patch: Partial<ShowState>): void {
    this.state = { ...this.state, ...patch }
    if (this.notifyTimer !== null) return
    // One render per burst: a joining client receives up to 200 replayed events back to back.
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.listeners.forEach((l) => l())
    }, NOTIFY_MS)
  }

  private flash(): Flash {
    this.counter += 1
    return { n: this.counter }
  }

  setHealth(agent: AgentId, health: AgentHealth | null): void {
    this.set({ health: { ...this.state.health, [agent]: health } })
  }

  setFeed(agent: AgentId, status: FeedStatus): void {
    this.set({ feeds: { ...this.state.feeds, [agent]: status } })
  }

  /** Seed the board from the maker's GET /state (only when the board is still empty). */
  seedBoard(offers: readonly OpenOffer[]): void {
    if (this.state.board.length > 0) return
    const board = offers
      .filter((o) => o.side === 'ask' || o.side === 'bid')
      .reduce<readonly BoardCard[]>((b, o) => applyToBoard(b, { kind: 'post', side: o.side as Side, ref: o.ref, price: o.price }), [])
    this.set({ board })
  }

  ingest(event: ShowEvent, replay: boolean): void {
    if (event.type === 'agent.tick') {
      const heartbeat = replay ? this.state.heartbeat : { ...this.state.heartbeat, [event.agent]: this.state.heartbeat[event.agent] + 1 }
      this.set({ ticks: { ...this.state.ticks, [event.agent]: event.tick }, heartbeat })
      return
    }
    const beat = toBeat(event)
    if (!beat) return
    if (replay) {
      this.set({ board: applyToBoard(this.state.board, beat.cue), transcript: this.appendLines(beat, 'history') })
      return
    }
    const dropped = this.director.push(beat)
    this.set({ lastEventAt: Date.now() })
    dropped.forEach((b) => this.set({ transcript: this.appendLines(b, 'skipped') }))
    this.wake?.()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.generation += 1
    void this.run(this.generation)
  }

  stop(): void {
    this.running = false
    this.speech.clear()
    this.wake?.()
  }

  private appendLines(beat: Beat, kind: TranscriptEntry['kind'], only?: Line): readonly TranscriptEntry[] {
    const lines = only ? [only] : beat.lines
    const added = lines.map((l, i) => ({ id: `${beat.id}#${only ? beat.lines.indexOf(only) : i}`, tick: beat.tick, speaker: l.speaker, text: l.text, kind }))
    return [...this.state.transcript, ...added].slice(-MAX_TRANSCRIPT)
  }

  private waitForWork(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms)
      function done(): void {
        clearTimeout(timer)
        resolve()
      }
      this.wake = done
    })
  }

  private async run(generation: number): Promise<void> {
    while (this.running && this.generation === generation) {
      const { beat, skipped } = this.director.next()
      skipped.forEach((b) => this.set({ transcript: this.appendLines(b, 'skipped') }))
      if (beat) {
        await this.play(beat, generation)
        continue
      }
      await this.waitForWork(IDLE_AFTER_MS)
      this.wake = null
      if (this.running && this.idle && this.director.size === 0 && Date.now() - (this.state.lastEventAt ?? 0) >= IDLE_AFTER_MS) {
        this.idleCount += 1
        this.director.push(idleBeat(this.idleCount))
      }
    }
  }

  private cuePatch(beat: Beat): Partial<ShowState> {
    const cue = beat.cue
    const patch: Partial<ShowState> = { beat, board: applyToBoard(this.state.board, cue) }
    const jev = beat.jev ? { ...this.flash(), verdict: beat.jev, agent: beat.agent } : null
    // A dealer stays on stage for the game's answer to its conversation (the execution right after).
    const dealer = cue.kind === 'dealer' ? { id: cue.dealer, move: cue.move } : cue.kind === 'deal' || cue.kind === 'fail' ? this.state.dealer : null
    return {
      ...patch,
      jev,
      dealer,
      denied: beat.denied ? this.flash() : null,
      reach: cue.kind === 'reach' ? { ...this.flash(), ref: cue.ref, price: cue.price, take: cue.take } : null,
      deal: cue.kind === 'deal' ? { ...this.flash(), big: cue.big } : null,
      fail: cue.kind === 'fail' ? { ...this.flash(), code: cue.code } : null,
    }
  }

  private prefetch(beat: Beat | null): void {
    beat?.lines.forEach((line, i) => this.speech.prefetch({ id: `${beat.id}#${i}`, speaker: line.speaker, text: line.text }))
  }

  private async play(beat: Beat, generation: number): Promise<void> {
    this.prefetch(beat)
    this.prefetch(this.director.peek())
    this.set(this.cuePatch(beat))
    for (const [i, line] of beat.lines.entries()) {
      if (!this.running || this.generation !== generation) return
      this.set({ line, transcript: this.appendLines(beat, 'played', line) })
      const backlog = this.director.size + this.speech.backlog
      await Promise.all([this.speech.say({ id: `${beat.id}#${i}`, speaker: line.speaker, text: line.text }), this.sleep(readingMs(line.text, backlog))])
    }
    await this.sleep(this.director.size > 3 ? 150 : 450)
    this.set({ line: null })
  }
}
