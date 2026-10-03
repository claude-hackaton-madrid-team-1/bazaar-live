/**
 * The screens that read their own API (/history, /learn, /strategy, /rivals) kept close to real time: our agents' sockets ring the
 * doorbell (server/game/agentsws.ts, `onEvent`), the server reads those screens' views right away, and when a
 * read finds new rows it tells every open game stream with one small sticky status, `pages.changed`
 * ({history, learn, strategy, rivals}: when each last changed, ISO). The page then refetches its API. Postgres stays the only source
 * of what is shown: an event never carries a row, it only says "read now"; and the notice carries times only.
 *
 * When each screen's rows land, read in bazaar (agents/runtime.py, taker.py, holdings.py, ledger_pg.py):
 * - our orders (`ledger`) are written right after the execution's event: one read 250 ms after it;
 * - our cash and score (`me_snapshots`) before each tick's `agent.tick` and again after a deal;
 * - our trades and the team's events come from the feed archive and the learnings from the live learner's flush,
 *   both at the end of the taker's tick, after its sends: a read a few seconds after the taker's tick and after a
 *   thread's execution catches them;
 * - the strategy reads all of these plus the taker's refusals (`decisions` rows never sent, so never on a socket),
 *   decided early in its tick: reads after the taker's tick and after any decision or execution;
 * - the rivals' holdings, ranks and wants come from the feed archive and the leaderboard reads, never from a socket of
 *   ours: one read a few seconds after the taker's tick, when the archive has caught up with the tick.
 * Each screen's own poller timer (5 s, 10 s) stays as the fallback for everything else.
 */
import type { AgentId, ShowEvent } from '../../src/model/events.ts'
import type { GameEvent } from './relay.ts'

export type ApiPage = 'history' | 'learn' | 'strategy' | 'rivals'

/** One live event of an agent's socket, as server/game/agentsws.ts hands it over (only the fields read here). */
export interface LiveEvent {
  readonly agent: AgentId
  readonly kind: 'tick' | 'decision' | 'execution'
  readonly event: ShowEvent
}

export interface AgentEvents {
  onEvent(listener: (e: LiveEvent) => void): () => void
}

/** A screen's poller (`HistoryPoller`, `LearnPoller`): read now, and say when a read found new rows. */
export interface PagePoller {
  poke(): boolean
  onChange(listener: (at: string) => void): () => void
}

export interface StatusHub {
  publishStatus(e: GameEvent): void
}

/** The execution's route name; '' for anything else. */
const methodOf = (e: LiveEvent): string => (e.event.type === 'agent.execution' ? e.event.execution.method : '')

/** Routes that open, move or end a negotiation: what the live learner turns into learnings at the tick's end. */
const THREAD_METHODS = new Set(['open_thread', 'say', 'close_thread', 'accept'])

/**
 * After which live events each screen reads, and how long after (ms). Bursts share a read: a delay already
 * waiting is not armed again.
 */
export const WAKES: Readonly<Record<ApiPage, (e: LiveEvent) => readonly number[]>> = {
  history: (e) => (e.kind === 'execution' ? [250, 2_500] : e.kind === 'tick' && e.agent === 'taker' ? [250, 5_000] : []),
  learn: (e) => (e.kind === 'execution' && THREAD_METHODS.has(methodOf(e)) ? [1_500, 5_000] : e.kind === 'tick' && e.agent === 'taker' ? [5_000] : []),
  strategy: (e) => (e.kind === 'tick' ? (e.agent === 'taker' ? [250, 2_500, 5_000] : []) : [250, 2_500]),
  rivals: (e) => (e.kind === 'tick' && e.agent === 'taker' ? [5_000] : []),
}

export interface Timers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown
  readonly clearTimeout: (handle: unknown) => void
}

const nodeTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Pokes a poller after each of the delays asked for, at most one waiting timer per delay. */
export class Waker {
  private readonly pending = new Map<number, unknown>()
  private readonly poke: () => void
  private readonly timers: Timers
  /** Reads asked for: for tests and the log. */
  rings = 0

  constructor(poke: () => void, timers: Timers = nodeTimers) {
    this.poke = poke
    this.timers = timers
  }

  ring(delays: readonly number[]): void {
    for (const ms of delays) {
      if (this.pending.has(ms)) continue
      this.pending.set(ms, this.timers.setTimeout(() => {
        this.pending.delete(ms)
        this.rings += 1
        this.poke()
      }, ms))
    }
  }

  stop(): void {
    for (const t of this.pending.values()) this.timers.clearTimeout(t)
    this.pending.clear()
  }
}

/** Ids of their own, below the agents' health (-2^51 down): only the latest is ever kept. */
export const FIRST_PAGES_ID = -(2 ** 52)

/** When each screen's rows last changed, sent to every viewer as the sticky `pages.changed`. */
export class PageNotices {
  private readonly changes: Partial<Record<ApiPage, string>> = {}
  private nextId = FIRST_PAGES_ID
  private readonly hub: StatusHub
  private readonly log: (entry: Record<string, unknown>) => void

  constructor(hub: StatusHub, log: (entry: Record<string, unknown>) => void) {
    this.hub = hub
    this.log = log
  }

  changed(page: ApiPage, at: string): void {
    this.changes[page] = at
    try {
      const id = this.nextId
      this.nextId -= 1
      this.hub.publishStatus({ id, type: 'pages.changed', scope: 'team', actor: '', payload: { ...this.changes } })
    } catch (error: unknown) {
      this.log({ route: 'pages', event: 'publish_failed', message: error instanceof Error ? error.name : 'ERR' })
    }
  }

  current(): Partial<Record<ApiPage, string>> {
    return { ...this.changes }
  }
}

export interface Pages {
  readonly stop: () => void
}

/**
 * Each screen's poller tells the game stream when its rows change (no stream: the pages keep their short timer),
 * and our agents' live events wake the pollers (no sockets: their own timers only). `PAGES_WAKE=off` keeps the
 * notices but never reads early: the timer-only baseline for the latency numbers.
 */
export function startPages(
  env: Readonly<Record<string, string | undefined>>,
  deps: {
    readonly hub: StatusHub | null
    readonly agents: AgentEvents | null
    readonly pollers: Readonly<Partial<Record<ApiPage, PagePoller | null>>>
    readonly log: (entry: Record<string, unknown>) => void
    readonly timers?: Timers
  },
): Pages {
  const stops: (() => void)[] = []
  const notices = deps.hub ? new PageNotices(deps.hub, deps.log) : null
  const wake = (env.PAGES_WAKE ?? '').trim().toLowerCase() !== 'off'
  const wakers: [ApiPage, Waker][] = []
  for (const [page, poller] of Object.entries(deps.pollers) as [ApiPage, PagePoller | null][]) {
    if (!poller) continue
    if (notices) stops.push(poller.onChange((at) => notices.changed(page, at)))
    if (wake && deps.agents) {
      const waker = new Waker(() => void poller.poke(), deps.timers)
      wakers.push([page, waker])
      stops.push(() => waker.stop())
    }
  }
  if (wakers.length > 0 && deps.agents) {
    stops.push(deps.agents.onEvent((e) => {
      for (const [page, waker] of wakers) waker.ring(WAKES[page](e))
    }))
  }
  deps.log({ route: 'pages', event: 'on', notices: notices !== null, wake: wakers.map(([page]) => page) })
  return { stop: () => stops.splice(0).forEach((s) => s()) }
}
