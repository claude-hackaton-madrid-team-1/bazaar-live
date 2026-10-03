/**
 * The show engine: events in, scenes out. Framework-free; React reads it with useSyncExternalStore.
 *
 * Live events become beats for the director; the runner plays one beat at a time: it sets the cue
 * (cards fly, dealers pop in, the stop sign shakes), then says each line, waiting for the voice (or a
 * reading time when muted) before the next. Replayed history goes straight to the transcript.
 */
import { DEFAULT_LANG, type Lang } from '../../shared/lang.ts'
import { HOODS } from '../../shared/vocab.ts'
import type { AgentHealth, AgentId, OpenOffer, ShowEvent } from '../model/events'
import type { FeedStatus } from '../net/feed'
import type { SpeechQueue } from '../tts/queue'
import type { Beat, Cue, DealerId, Line, Side } from './beat'
import { holdsBeat, situationBeat, situationBeatIfFresh, toBeat, type DialogueContext } from './dialogue'
import { Director } from './director'
import { LineMemory } from './memory'
import { situationOf } from './situation'

export interface BoardCard {
  readonly key: string
  readonly ref: string
  readonly side: Side
  readonly price: number | null
  /** Bumps on every reprice, so the tag can flash. */
  readonly version: number
  /** When an event put it there (ms): the fallback when a snapshot carries no tick. */
  readonly at: number
  /** The game tick of the event that last set it, or null when it came from a /state snapshot. */
  readonly tick: number | null
}

/** A cancel the board already shows, so an older /state snapshot cannot bring the card back. */
export interface Tombstone {
  readonly tick: number | null
  readonly at: number
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
  readonly deal: (Flash & { readonly big: boolean; readonly price: number | null }) | null
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
/** A quiet open market talks again after this long; closed doors, a pause or no signal a bit sooner. */
const IDLE_AFTER_MS = 35_000
const IDLE_AFTER_CLOSED_MS = 22_000
/** The neighbourhoods that arrive after day one (RULES.md: El Retiro on Saturday, Chamberí on Sunday). */
const LATE_HOODS: ReadonlySet<string> = new Set(['RET', 'CHA'])
/** The Market Test runs every two game hours (RULES.md): a session starts each time this slot changes. */
const MARKET_TEST_HOURS = 2
const NOTIFY_MS = 16
/** How many situations the idle talk tries before it decides to keep quiet. */
const AMBIENT_ATTEMPTS = 4
/** A caption stays at least this long when a voice sets the pace (a failed voice must not flash it away). */
const MIN_CAPTION_MS = 500
const STALE_TICKS = 2

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
  /** The language of every line (default castellano). */
  readonly lang?: Lang
  /** What was said lately, so no line repeats within its window (a fresh one by default). */
  readonly memory?: LineMemory
  /** Ambient banter when nothing happened for a while (off in tests). */
  readonly idle?: boolean
  /** Overrides how long a quiet stage waits before it talks about the situation. */
  readonly idleAfterMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function cardKey(ref: string, side: Side): string {
  return `${side}:${ref}`
}

/** The board after one cue: post adds, reprice updates, cancel removes. */
export function applyToBoard(board: readonly BoardCard[], cue: Cue, now = Date.now(), tick: number | null = null): readonly BoardCard[] {
  if (cue.kind !== 'post' && cue.kind !== 'reprice' && cue.kind !== 'cancel') return board
  const key = cardKey(cue.ref, cue.side)
  const existing = board.find((c) => c.key === key)
  if (cue.kind === 'cancel') return board.filter((c) => c.key !== key)
  if (existing) {
    return board.map((c) => (c.key === key ? { ...c, price: cue.price ?? c.price, version: c.version + 1, at: now, tick } : c))
  }
  const added: BoardCard = { key, ref: cue.ref, side: cue.side, price: cue.price, version: 0, at: now, tick }
  return [...board, added].slice(-MAX_BOARD)
}

/** Without a snapshot tick, a card or cancel an event made in the last SYNC_GRACE_MS still wins. */
const SYNC_GRACE_MS = 20_000
/** How many ticks the maker's /state open offers can lag behind its /state tick (bazaar maker.py). */
const SNAPSHOT_LAG_TICKS = 1

/**
 * The board as /state lists it. The maker's /state offers trail its own posts and cancels (they are
 * read at the start of a tick and published at its end, under the next tick's stamp), so an event wins
 * over any snapshot less than two ticks newer: a card it posted stays, a price it set stays (no second
 * flash), a card it cancelled stays gone. A card sold right after it was posted stays one tick longer.
 */
export function syncBoard(
  board: readonly BoardCard[],
  offers: readonly OpenOffer[],
  now: number,
  stateTick: number | null = null,
  tombstones: ReadonlyMap<string, Tombstone> = new Map(),
): readonly BoardCard[] {
  // The maker stamps /state with tick T when tick T starts but swaps its open offers only when T ends:
  // until then a snapshot at T still lists the offers read at the start of T-1.
  const eventWins = (tick: number | null, at: number) =>
    tick !== null && stateTick !== null ? tick >= stateTick - SNAPSHOT_LAG_TICKS : now - at < SYNC_GRACE_MS
  const listed = offers
    .filter((o) => o.side === 'ask' || o.side === 'bid')
    .filter((o) => {
      const tomb = tombstones.get(cardKey(o.ref, o.side as Side))
      return !tomb || !eventWins(tomb.tick, tomb.at)
    })
    .map((o): BoardCard => {
      const key = cardKey(o.ref, o.side as Side)
      const old = board.find((c) => c.key === key)
      if (old && eventWins(old.tick, old.at)) return old
      const repriced = old !== undefined && o.price !== null && old.price !== o.price
      return { key, ref: o.ref, side: o.side as Side, price: o.price ?? old?.price ?? null, version: (old?.version ?? 0) + (repriced ? 1 : 0), at: old?.at ?? 0, tick: null }
    })
  const recent = board.filter((c) => !listed.some((l) => l.key === c.key) && eventWins(c.tick, c.at))
  const unique = [...listed, ...recent].filter((c, i, all) => all.findIndex((x) => x.key === c.key) === i)
  return unique.slice(-MAX_BOARD)
}

export class ShowEngine {
  private state: ShowState = INITIAL_STATE
  private readonly listeners = new Set<() => void>()
  private readonly speech: SpeechQueue
  private readonly director: Director
  private readonly sleep: (ms: number) => Promise<void>
  private readonly idle: boolean
  private lang: Lang
  /** Bumped on every language change: a beat started in the old language stops at once. */
  private langEpoch = 0
  private readonly memory: LineMemory
  private readonly clock: () => number
  private readonly idleAfterMs: number | null
  /** Late neighbourhoods already seen (or announced), and the Market Test slot last seen. */
  private readonly seenHoods = new Set<string>()
  private freshHood: string | null = null
  private marketTestSlot: number | null = null
  private freshMarketTest = false
  /** When the stage last did something (a live event, a scene ended, a line of situation talk), in real time. */
  private activityAt = Date.now()
  private wake: (() => void) | null = null
  /** Each start() bumps it; an older run loop sees the change and exits (React StrictMode restarts). */
  private generation = 0
  private running = false
  private idleCount = 0
  private counter = 0
  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private tombstones: ReadonlyMap<string, Tombstone> = new Map()

  constructor(options: EngineOptions) {
    this.speech = options.speech
    this.lang = options.lang ?? DEFAULT_LANG
    this.memory = options.memory ?? new LineMemory()
    this.clock = options.now ?? Date.now
    this.director = options.director ?? new Director({ mergeHolds: (holds) => holdsBeat(holds, this.dialogue(true)) })
    this.sleep = options.sleep ?? defaultSleep
    this.idle = options.idle ?? true
    this.idleAfterMs = options.idleAfterMs ?? null
  }

  /** The dialogue's view of the stage; only live beats get the memory (replayed history must not use lines up). */
  private dialogue(live: boolean): DialogueContext {
    const last = this.state.lastEventAt
    return {
      lang: this.lang,
      memory: live ? this.memory : undefined,
      now: this.clock(),
      busy: this.director.size > 3,
      quietMs: last === null ? null : this.clock() - last,
    }
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

  /**
   * Changes the language of everything said from now on: the beat being played stops, the queued beats
   * and the queued voices of the old language are dropped, and the next lines come from the new pack.
   */
  setLang(lang: Lang): void {
    if (lang === this.lang) return
    this.lang = lang
    this.langEpoch += 1
    this.speech.clear()
    this.director.clear()
    this.activityAt = Date.now()
    this.set({ line: null, beat: null, reach: null, deal: null, denied: null, fail: null, jev: null, dealer: null })
    this.wake?.()
  }

  setFeed(agent: AgentId, status: FeedStatus): void {
    this.set({ feeds: { ...this.state.feeds, [agent]: status } })
  }

  /** Align the board with the maker's GET /state (taken at tick `stateTick`): sold or expired offers leave. */
  syncBoard(offers: readonly OpenOffer[], stateTick: number | null = null, now = Date.now()): void {
    this.set({ board: syncBoard(this.state.board, offers, now, stateTick, this.tombstones) })
    if (stateTick !== null) {
      // A snapshot taken after a cancel already reflects it: that tombstone is no longer needed.
      this.tombstones = new Map([...this.tombstones].filter(([, t]) => t.tick === null || t.tick >= stateTick - SNAPSHOT_LAG_TICKS))
    }
  }

  /** The board after a cue, remembering cancels so an older snapshot cannot undo them. */
  private boardAfter(beat: Beat): readonly BoardCard[] {
    const cue = beat.cue
    const now = Date.now()
    if (cue.kind === 'cancel') {
      this.tombstones = new Map([...this.tombstones, [cardKey(cue.ref, cue.side), { tick: beat.tick, at: now }]])
    } else if (cue.kind === 'post' || cue.kind === 'reprice') {
      const key = cardKey(cue.ref, cue.side)
      this.tombstones = new Map([...this.tombstones].filter(([k]) => k !== key))
    }
    return applyToBoard(this.state.board, cue, now, beat.tick)
  }

  ingest(event: ShowEvent, replay: boolean): void {
    if (event.type === 'agent.tick') {
      const heartbeat = replay ? this.state.heartbeat : { ...this.state.heartbeat, [event.agent]: this.state.heartbeat[event.agent] + 1 }
      this.set({ ticks: { ...this.state.ticks, [event.agent]: event.tick }, heartbeat })
      if (!replay) {
        this.noticeClock(event.t)
        this.announce()
        this.wake?.()
      }
      return
    }
    // A late replay on slow Wi-Fi can arrive after the feed's replay window: an event several ticks
    // behind what the agent's /health reports is history, not a scene.
    const agentTick = this.state.health[event.agent]?.tick ?? null
    const stale = event.tick !== null && agentTick !== null && event.tick < agentTick - STALE_TICKS
    const live = !(replay || stale)
    const beat = toBeat(event, this.dialogue(live))
    if (!beat) return
    this.noticePage(event, live)
    if (!live) {
      this.set({ board: this.boardAfter(beat), transcript: this.appendLines(beat, 'history') })
      return
    }
    const dropped = this.director.push(beat)
    this.set({ lastEventAt: this.clock() })
    this.activityAt = Date.now()
    dropped.forEach((b) => this.set({ transcript: this.appendLines(b, 'skipped') }))
    this.announce()
    this.wake?.()
  }

  /** A card from a neighbourhood that opens late is a new page, announced once when a live event shows it. */
  private noticePage(event: ShowEvent, live: boolean): void {
    if (event.type !== 'agent.decision') return
    const inputs = event.decision.inputs
    const set = (inputs.ref ?? inputs.card ?? inputs.item ?? '').slice(0, 3).toUpperCase()
    if (!LATE_HOODS.has(set) || this.seenHoods.has(set)) return
    this.seenHoods.add(set)
    if (live) this.freshHood = HOODS[set] ?? null
  }

  /** The Market Test starts a session every two game hours: a new slot on a live tick is one. */
  private noticeClock(t: number | null): void {
    if (t === null) return
    const slot = Math.floor(t / MARKET_TEST_HOURS)
    if (this.marketTestSlot !== null && slot > this.marketTestSlot) this.freshMarketTest = true
    this.marketTestSlot = slot
  }

  /** What the stage knows about the world, for the situation it talks about when it is idle. */
  private narration() {
    return {
      health: this.state.health,
      feeds: this.state.feeds,
      now: this.clock(),
      tick: this.state.ticks.taker ?? this.state.ticks.maker ?? this.state.health.taker?.tick ?? this.state.health.maker?.tick ?? null,
      freshHood: this.freshHood,
      freshMarketTest: this.freshMarketTest,
    }
  }

  /** One-shot news (a new page, a Market Test session) is said at once, not when the stage next gets bored. */
  private announce(): void {
    if (!this.freshHood && !this.freshMarketTest) return
    this.situational()
  }

  /** Queue one beat about the situation; one-shot news is consumed by being said. */
  private situational(): void {
    this.activityAt = Date.now()
    // Ambient talk needs a line that was not said within the memory window: when a small bank (a pause,
    // no signal) is used up, the next situation gets a turn, and if none has a fresh line the stage stays
    // quiet instead of looping. News (a new page, a Market Test) is always said.
    for (let attempt = 0; attempt < AMBIENT_ATTEMPTS; attempt += 1) {
      this.idleCount += 1
      const situation = situationOf(this.narration(), this.lang, this.idleCount)
      const news = situation.topic === 'new_page' || situation.topic === 'market_test'
      const beat = news ? situationBeat(this.idleCount, situation, this.dialogue(true)) : situationBeatIfFresh(this.idleCount, situation, this.dialogue(true))
      if (!beat) continue
      if (situation.topic === 'new_page') this.freshHood = null
      if (situation.topic === 'market_test') this.freshMarketTest = false
      this.director.push(beat)
      return
    }
  }

  /** How long a quiet stage waits: less when the doors are closed or the game is paused or unreachable. */
  private idleDelay(): number {
    if (this.idleAfterMs !== null) return this.idleAfterMs
    const topic = situationOf(this.narration(), this.lang, 0).topic
    return topic === 'doors_closed' || topic === 'paused' || topic === 'offline' ? IDLE_AFTER_CLOSED_MS : IDLE_AFTER_MS
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.activityAt = Date.now()
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
      // eslint-disable-next-line prefer-const -- `done` clears the timer that is created after it
      let timer: ReturnType<typeof setTimeout>
      const done = (): void => {
        clearTimeout(timer)
        // Only clear our own wake-up: a restarted loop (StrictMode) may have set a newer one.
        if (this.wake === done) this.wake = null
        resolve()
      }
      timer = setTimeout(done, ms)
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
      // Quiet for `delay` since anything last happened: then it talks about the situation. A wake-up
      // before that (a tick, a replayed event) only moves the clock forward.
      const delay = this.idleDelay()
      await this.waitForWork(Math.max(50, delay - (Date.now() - this.activityAt)))
      if (this.running && this.idle && this.director.size === 0 && Date.now() - this.activityAt >= delay) this.situational()
    }
  }

  private cuePatch(beat: Beat): Partial<ShowState> {
    const cue = beat.cue
    const patch: Partial<ShowState> = { beat, board: this.boardAfter(beat) }
    const jev = beat.jev ? { ...this.flash(), verdict: beat.jev, agent: beat.agent } : null
    // A dealer stays on stage for the game's answer to its conversation (the execution right after).
    const dealer = cue.kind === 'dealer' ? { id: cue.dealer, move: cue.move } : cue.kind === 'deal' || cue.kind === 'fail' ? this.state.dealer : null
    return {
      ...patch,
      jev,
      dealer,
      denied: beat.denied ? this.flash() : null,
      reach: cue.kind === 'reach' ? { ...this.flash(), ref: cue.ref, price: cue.price, take: cue.take } : null,
      deal: cue.kind === 'deal' ? { ...this.flash(), big: cue.big, price: cue.price } : null,
      fail: cue.kind === 'fail' ? { ...this.flash(), code: cue.code } : null,
    }
  }

  private prefetch(beat: Beat | null): void {
    beat?.lines.forEach((line, i) => this.speech.prefetch({ id: `${beat.id}#${i}`, speaker: line.speaker, lang: this.lang, text: line.text }))
  }

  private async play(beat: Beat, generation: number): Promise<void> {
    this.prefetch(beat)
    this.prefetch(this.director.peek())
    this.set(this.cuePatch(beat))
    // The beat's lines are all in the language it was built in; a language change (epoch) ends it.
    const lang = this.lang
    const epoch = this.langEpoch
    const stale = () => !this.running || this.generation !== generation || this.langEpoch !== epoch
    const utterance = (line: Line, i: number) => ({ id: `${beat.id}#${i}`, speaker: line.speaker, lang, text: line.text })
    // The next line goes into the voice queue while the current one is still being said, so the queue
    // never waits for the stage and there is no silence between lines.
    let current: Promise<void> = Promise.resolve()
    for (const [i, line] of beat.lines.entries()) {
      if (stale()) return
      this.set({ line, transcript: this.appendLines(beat, 'played', line) })
      if (i === 0) current = this.speech.say(utterance(line, 0))
      const following = beat.lines[i + 1]
      const next = following ? this.speech.say(utterance(following, i + 1)) : Promise.resolve()
      // A voice sets the pace; the reading time only applies to a muted or silent stage.
      const reading = this.speech.audible ? MIN_CAPTION_MS : readingMs(line.text, this.director.size + this.speech.backlog)
      await Promise.all([current, this.sleep(reading)])
      current = next
    }
    await this.sleep(this.director.size > 3 ? 150 : 450)
    if (stale()) return
    this.set(this.clearPatch())
    this.activityAt = Date.now()
  }

  /** After a beat the stage relaxes; a dealer stays only if the next beat continues the conversation. */
  private clearPatch(): Partial<ShowState> {
    const next = this.director.peek()?.cue.kind
    const keepDealer = next === 'dealer' || next === 'deal' || next === 'fail'
    return { line: null, beat: null, reach: null, deal: null, denied: null, fail: null, jev: null, dealer: keepDealer ? this.state.dealer : null }
  }
}
