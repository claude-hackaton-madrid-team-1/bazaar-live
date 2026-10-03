/**
 * Our agents' WebSockets as the game screens' doorbell: one socket to each agent's public `/events` (the show's
 * own client, src/net/feed.ts: backoff, dedupe, replay told apart), and on any LIVE event a read of our database
 * right away instead of at the next 3 s turn. Postgres stays the only source of what the screens show: nothing
 * from the sockets is published, they only say "something moved, read now".
 *
 * The race, read in bazaar (agents/runtime.py `Recorder`, decisions.py `DecisionLog`, agents/status.py): the
 * `decisions` and `executions` rows are inserted (autocommit) BEFORE the hub broadcasts their event, so the first
 * read finds them. But the decision's final status (`settle`: done / failed) is written AFTER the execution's
 * event, and the feed, /me and duels are written by other loops entirely. So a decision or execution event also
 * arms one follow-up read ~750 ms later; the 3 s poll stays as the fallback for everything else (and for an
 * agent whose Postgres was down: its row went to a JSONL file, and no re-read would ever find it).
 *
 * The replay an agent sends on every (re)connection (its last 200 events) never rings: it is history, and the
 * 3 s poll already covers what was missed while the socket was down. Live events within `debounceMs` of the
 * first one share one read (the taker and the maker tick within ~150 ms of each other).
 *
 * `AGENTS_WS=off` turns it off; `AGENTS_WS=watch` keeps the sockets and the latency log but never reads early
 * (the poll-only baseline). Each agent's socket state and last live event go out on /api/game (`sockets`).
 *
 * Other screens hook in the same way the game's pollers do: `onRead(listener)` (the debounced "read now", what the
 * pollers use) or `onEvent(listener)` (every live event: agent, kind, tick, decision id); both return the unsubscribe.
 */
import { MAKER_HTTP, TAKER_HTTP, toWs } from '../../shared/endpoints.ts'
import { AGENTS, type AgentId, type ShowEvent } from '../../src/model/events.ts'
import { EventFeed, type FeedStatus, type SocketFactory, type Timers } from '../../src/net/feed.ts'
import type { GameEvent } from './relay.ts'

export interface SocketState {
  readonly state: FeedStatus
  /** When the last live (not replayed) event arrived, ISO; null before the first. */
  readonly lastEventAt: string | null
}

export type AgentSockets = Readonly<Record<AgentId, SocketState>>

/** A poller that can read now (`GameDbSource.poke`, `DecisionsPoller.poke`). */
export type Poke = () => boolean

/** One live event: the show's sanitized event (src/model/sanitize.ts, public fields only) and what a listener keys on. */
export interface LiveEvent {
  readonly agent: AgentId
  readonly event: ShowEvent
  readonly kind: 'tick' | 'decision' | 'execution'
  readonly tick: number | null
  /** The `decisions.id` a decision or execution is about (a sent row of a live agent), else null. */
  readonly decision: number | null
  /** Epoch ms it arrived. */
  readonly at: number
}

/** Why a read is due: live events just arrived, or the follow-up after a decision / execution (its settle, the feed). */
export type ReadReason = 'event' | 'follow_up'

export interface HubWatch {
  subscribe(listener: (batch: readonly GameEvent[]) => void): () => void
}

export interface AgentsWsDeps {
  readonly urls: Readonly<Record<AgentId, string>>
  readonly log: (entry: Record<string, unknown>) => void
  /** The game hub, watched for the DB rows that match a socket's event (the latency log). */
  readonly hub?: HubWatch | null
  readonly createSocket?: SocketFactory
  readonly timers?: Timers
  readonly random?: () => number
  readonly debounceMs?: number
  readonly followUpMs?: number
  /** A socket's event not matched by a DB row within this long is forgotten. */
  readonly matchWindowMs?: number
}

const nodeTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
}

/** Socket events still waiting for their DB row: at most this many (a decision a minute is the usual pace). */
const MAX_PENDING = 500

interface Pending {
  readonly agent: AgentId
  readonly kind: 'decision' | 'execution'
  readonly at: number
}

export class AgentsWs {
  private readonly deps: AgentsWsDeps
  private readonly timers: Timers
  private readonly debounceMs: number
  private readonly followUpMs: number
  private readonly matchWindowMs: number
  private readonly feeds: EventFeed[]
  private readonly status: Record<AgentId, FeedStatus> = { taker: 'idle', maker: 'idle' }
  private readonly lastEventAt: Record<AgentId, number | null> = { taker: null, maker: null }
  /** By `decision:<id>` / `execution:<id>`: when the socket said so. */
  private readonly pending = new Map<string, Pending>()
  private readTimer: unknown = null
  private followTimer: unknown = null
  private unwatch: (() => void) | null = null
  private readonly eventListeners = new Set<(e: LiveEvent) => void>()
  private readonly readListeners = new Set<(reason: ReadReason) => void>()
  /** Reads signalled so far (each wakes every `onRead` listener once). */
  reads = 0

  constructor(deps: AgentsWsDeps) {
    this.deps = deps
    this.timers = deps.timers ?? nodeTimers
    this.debounceMs = deps.debounceMs ?? 250
    this.followUpMs = deps.followUpMs ?? 750
    this.matchWindowMs = deps.matchWindowMs ?? 60_000
    this.feeds = AGENTS.map((agent) => new EventFeed({
      url: deps.urls[agent],
      agent,
      onEvent: (event, replay) => this.handle(agent, event, replay),
      onStatus: (status, info) => this.onStatus(agent, status, info.nextRetryMs),
      timers: this.timers,
      ...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
      ...(deps.random ? { random: deps.random } : {}),
    }))
  }

  start(): void {
    this.unwatch ??= this.deps.hub?.subscribe((batch) => this.matchRows(batch)) ?? null
    for (const f of this.feeds) f.start()
  }

  stop(): void {
    for (const f of this.feeds) f.stop()
    for (const t of [this.readTimer, this.followTimer]) if (t !== null) this.timers.clearTimeout(t)
    this.readTimer = this.followTimer = null
    this.unwatch?.()
    this.unwatch = null
    this.pending.clear()
  }

  /** Every live (not replayed, not duplicate) event. Returns the unsubscribe. */
  onEvent(listener: (e: LiveEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /** The debounced "read now": at most one per `debounceMs` burst, plus one follow-up per decision burst. Returns the unsubscribe. */
  onRead(listener: (reason: ReadReason) => void): () => void {
    this.readListeners.add(listener)
    return () => this.readListeners.delete(listener)
  }

  sockets(): AgentSockets {
    const one = (a: AgentId): SocketState => {
      const at = this.lastEventAt[a]
      return { state: this.status[a], lastEventAt: at === null ? null : new Date(at).toISOString() }
    }
    return { taker: one('taker'), maker: one('maker') }
  }

  private onStatus(agent: AgentId, status: FeedStatus, nextRetryMs: number | null): void {
    const was = this.status[agent]
    this.status[agent] = status
    // Said on the way up and the first time it goes down, not on every retry of a long outage.
    if (status === 'open' || (status === 'reconnecting' && was === 'open')) {
      this.deps.log({ route: 'agent_ws', agent, event: status, ...(nextRetryMs === null ? {} : { retryMs: nextRetryMs }) })
    }
  }

  private handle(agent: AgentId, event: ShowEvent, replay: boolean): void {
    if (replay) return
    const now = this.timers.now()
    this.lastEventAt[agent] = now
    const kind = event.type === 'agent.decision' ? 'decision' : event.type === 'agent.execution' ? 'execution' : 'tick'
    const id = event.type === 'agent.decision' ? event.decision.decisionId : event.type === 'agent.execution' ? event.execution.decisionId : null
    const decision = id !== null && id > 0 ? id : null
    if (kind !== 'tick' && decision !== null) this.expect(`${kind}:${decision}`, { agent, kind, at: now })
    const live: LiveEvent = { agent, event, kind, tick: event.tick, decision, at: now }
    for (const l of this.eventListeners) this.safely(() => l(live))
    this.ring(kind !== 'tick')
  }

  /** A listener that throws never stops the socket or the other listeners. */
  private safely(fn: () => void): void {
    try {
      fn()
    } catch (error: unknown) {
      this.deps.log({ route: 'agent_ws', event: 'listener_failed', message: error instanceof Error ? error.name : 'ERR' })
    }
  }

  /** One read `debounceMs` after the first live event of a burst; a decision or execution also arms one follow-up. */
  private ring(followUp: boolean): void {
    if (this.readListeners.size === 0) return
    if (this.readTimer === null) {
      this.readTimer = this.timers.setTimeout(() => {
        this.readTimer = null
        this.read('event')
      }, this.debounceMs)
    }
    if (followUp && this.followTimer === null) {
      this.followTimer = this.timers.setTimeout(() => {
        this.followTimer = null
        this.read('follow_up')
      }, this.followUpMs)
    }
  }

  private read(reason: ReadReason): void {
    this.reads += 1
    for (const l of this.readListeners) this.safely(() => l(reason))
  }

  private expect(key: string, p: Pending): void {
    if (this.pending.has(key)) return
    this.pending.set(key, p)
    if (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string)
  }

  /**
   * The latency log: a socket's decision is matched by the first `agent.decision` the hub pushes for that id, its
   * execution by the first one that carries the request (`method`). The delay is socket → SSE push to the page.
   */
  private matchRows(batch: readonly GameEvent[]): void {
    if (this.pending.size === 0) return
    const now = this.timers.now()
    for (const e of batch) {
      if (e.type !== 'agent.decision') continue
      const id = e.payload.decision
      if (typeof id !== 'number') continue
      this.match(`decision:${id}`, id, now)
      if (typeof e.payload.method === 'string') this.match(`execution:${id}`, id, now)
    }
    for (const [key, p] of this.pending) if (now - p.at > this.matchWindowMs) this.pending.delete(key)
  }

  private match(key: string, id: number, now: number): void {
    const p = this.pending.get(key)
    if (!p) return
    this.pending.delete(key)
    this.deps.log({ route: 'agent_ws', event: 'latency', agent: p.agent, kind: p.kind, decision: id, ms: now - p.at })
  }
}

/** A ws(s):// URL from the environment, else the agent's public one (shared/endpoints.ts). */
export function wsUrls(env: Readonly<Record<string, string | undefined>>): Record<AgentId, string> {
  const pick = (name: string, fallback: string): string => {
    const raw = env[name]?.trim()
    if (!raw) return fallback
    try {
      const url = new URL(raw)
      return url.protocol === 'wss:' || url.protocol === 'ws:' ? url.href : fallback
    } catch {
      return fallback
    }
  }
  return { taker: pick('AGENT_TAKER_WS_URL', toWs(TAKER_HTTP)), maker: pick('AGENT_MAKER_WS_URL', toWs(MAKER_HTTP)) }
}

export interface AgentsWsHandle {
  /** Null while off: /api/game then says nothing about the sockets. */
  readonly sockets: () => AgentSockets | null
  /** `AgentsWs.onEvent`; while off, never called (the unsubscribe still works). */
  readonly onEvent: (listener: (e: LiveEvent) => void) => () => void
  /** `AgentsWs.onRead`; while off, never called. */
  readonly onRead: (listener: (reason: ReadReason) => void) => () => void
  readonly stop: () => void
}

/**
 * On whenever the show reads our database (`database`: SHOW_DATABASE_URL): the decisions are always poked, the game
 * views only while they are the game screens' source (`game.db`; with GAME_SOURCE=api the relay reads the API on its
 * own clock), and other screens that read Postgres hook in through `onRead` / `onEvent`. Off with `AGENTS_WS=off`,
 * without the database, and under a test runner unless the test brings its own socket.
 */
export function startAgentsWs(
  env: Readonly<Record<string, string | undefined>>,
  deps: {
    /** True with the show's pool: without it nothing here reads Postgres, so nothing to wake. */
    readonly database: boolean
    readonly game: { readonly db: { poke: Poke } | null; readonly hub: HubWatch | null }
    readonly decisions: { readonly poke: Poke }
    readonly log: (entry: Record<string, unknown>) => void
    readonly createSocket?: SocketFactory
    readonly timers?: Timers
  },
): AgentsWsHandle {
  const mode = (env.AGENTS_WS ?? '').trim().toLowerCase()
  const testRun = (env.VITEST !== undefined || env.NODE_ENV === 'test') && deps.createSocket === undefined
  const reason = mode === 'off' ? 'disabled' : !deps.database ? 'no_database' : testRun ? 'test' : null
  if (reason !== null) {
    deps.log({ route: 'agent_ws', event: 'off', reason })
    const none = (): (() => void) => () => undefined
    return { sockets: () => null, onEvent: none, onRead: none, stop: () => undefined }
  }
  const db = deps.game.db
  const watchOnly = mode === 'watch'
  const urls = wsUrls(env)
  const ws = new AgentsWs({
    urls, log: deps.log, hub: deps.game.hub,
    ...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
    ...(deps.timers ? { timers: deps.timers } : {}),
  })
  if (!watchOnly) {
    ws.onRead(() => {
      db?.poke()
      deps.decisions.poke()
    })
  }
  ws.start()
  deps.log({ route: 'agent_ws', event: 'on', mode: watchOnly ? 'watch' : 'read_on_event', gameViews: db !== null, taker: urls.taker, maker: urls.maker })
  return { sockets: () => ws.sockets(), onEvent: (l) => ws.onEvent(l), onRead: (l) => ws.onRead(l), stop: () => ws.stop() }
}
