/**
 * Our agents' /health into the game stream: one poller asks the taker and the maker every 10 s (4 s each at
 * most, never two rounds at once) and publishes one `agent.health` event as a sticky status (`GameHub.publishStatus`:
 * the latest one, first in every replay, never in the backlog). The browser never calls the agents itself.
 *
 * What goes out is an allow-list of /health's fields (shared/health.ts), never the body: no URL, no key, nothing
 * an agent might add later. The poller remembers since when each reason holds (`since`): the page only ever
 * sees the latest report. No exception ever leaves `pollOnce()`.
 */
import { MAKER_HTTP, TAKER_HTTP } from '../../shared/endpoints.ts'
import { HEALTH_AGENTS, reasons, type HealthAgent, type HealthError, type HealthPayload, type HealthReport, type LedgerHealth, type ReasonKind } from '../../shared/health.ts'
import type { GameEvent } from './relay.ts'

export interface StatusPublisher {
  publishStatus(event: GameEvent): void
}

export interface HealthPollerDeps {
  readonly hub: StatusPublisher
  readonly log: (entry: Record<string, unknown>) => void
  readonly urls: Readonly<Record<HealthAgent, string>>
  readonly fetchImpl?: typeof fetch
  readonly intervalMs?: number
  readonly timeoutMs?: number
  /** Epoch milliseconds. */
  readonly now?: () => number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

/** A /health body is a few hundred bytes: anything past this is not one. */
const MAX_BODY = 16 * 1024

/** Event ids of their own, below the decisions' (-2^50): only the latest is ever kept. */
export const FIRST_HEALTH_ID = -(2 ** 51)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
const nonNegative = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n >= 0 ? n : null
}
/** An ISO time, as an agent writes it; anything else is dropped (never free text). */
const isoTime = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)?$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null)

function ledgerOf(v: unknown): LedgerHealth | null {
  if (v === 'shared' || v === 'down') return v
  return v === 'local file' || v === 'local' ? 'local' : null
}

/** The allow-listed facts of one /health body, at `nowMs`. */
export function readHealth(agent: HealthAgent, raw: unknown, nowMs: number): Omit<HealthReport, 'since'> | null {
  if (!isRecord(raw) || raw.ok !== true) return null
  const target = isRecord(raw.target) ? raw.target.mode : null
  const lastTickAt = isoTime(raw.last_tick_at)
  const at = lastTickAt ? Date.parse(lastTickAt) : NaN
  const undecided = num(raw.jev_undecided)
  const limited = int(raw.rate_limited)
  return {
    agent,
    checkedAt: new Date(nowMs).toISOString(),
    error: null,
    mode: raw.mode === 'live' || raw.mode === 'dry' ? raw.mode : null,
    target: target === 'real' || target === 'simulator' ? target : null,
    ledger: ledgerOf(raw.ledger),
    tick: int(raw.tick),
    serverTick: int(raw.server_tick),
    lastTickAt,
    tickAgeS: Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 1000)) : null,
    doors: raw.doors === 'open' || raw.doors === 'closed' ? raw.doors : null,
    paused: typeof raw.paused === 'boolean' ? raw.paused : null,
    nextOpens: isoTime(raw.next_opens),
    tickSeconds: nonNegative(raw.tick_seconds),
    tickMs: nonNegative(raw.tick_ms),
    tickBudgetS: nonNegative(raw.tick_budget_s),
    rateLimited: limited != null && limited >= 0 ? limited : null,
    jevMs: nonNegative(raw.jev_ms),
    jevUndecided: undecided != null && undecided >= 0 && undecided <= 1 ? undecided : null,
  }
}

const failed = (agent: HealthAgent, error: HealthError, nowMs: number): Omit<HealthReport, 'since'> => ({
  agent, checkedAt: new Date(nowMs).toISOString(), error, mode: null, target: null, ledger: null, tick: null, serverTick: null,
  lastTickAt: null, tickAgeS: null, doors: null, paused: null, nextOpens: null, tickSeconds: null, tickMs: null, tickBudgetS: null,
  rateLimited: null, jevMs: null, jevUndecided: null,
})

/** The agents' status servers: Railway's `RAILWAY_SERVICE_BAZAAR_TAKER_URL` (a bare domain) when set, else shared/endpoints.ts. */
export function healthUrls(env: Readonly<Record<string, string | undefined>>): Record<HealthAgent, string> {
  const pick = (name: string, fallback: string): string => {
    const raw = env[name]?.trim()
    if (!raw) return fallback
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : fallback
    } catch {
      return fallback
    }
  }
  return { taker: pick('RAILWAY_SERVICE_BAZAAR_TAKER_URL', TAKER_HTTP), maker: pick('RAILWAY_SERVICE_BAZAAR_MAKER_URL', MAKER_HTTP) }
}

export class HealthPoller {
  private readonly deps: HealthPollerDeps
  private readonly fetchImpl: typeof fetch
  private readonly intervalMs: number
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly since: Record<HealthAgent, Partial<Record<ReasonKind, string>>> = { taker: {}, maker: {} }
  private readonly lastError: Record<HealthAgent, HealthError | null> = { taker: null, maker: null }
  private nextId = FIRST_HEALTH_ID
  private timer: unknown = null
  private stopped = true

  constructor(deps: HealthPollerDeps) {
    this.deps = deps
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.intervalMs = deps.intervalMs ?? 10_000
    this.timeoutMs = deps.timeoutMs ?? 4_000
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private async loop(): Promise<void> {
    await this.pollOnce()
    if (this.stopped) return
    this.timer = this.setTimer(() => {
      this.timer = null
      if (!this.stopped) void this.loop()
    }, this.intervalMs)
  }

  /** Both agents at once, then one event. Never throws. */
  async pollOnce(): Promise<HealthPayload> {
    const agents = await Promise.all(HEALTH_AGENTS.map((a) => this.probe(a)))
    const payload: HealthPayload = { agents }
    try {
      const id = this.nextId
      this.nextId -= 1
      this.deps.hub.publishStatus({ id, type: 'agent.health', scope: 'team', actor: '', payload: { ...payload } })
    } catch (error: unknown) {
      this.deps.log({ route: 'agent_health', event: 'publish_failed', message: error instanceof Error ? error.name : 'ERR' })
    }
    return payload
  }

  private async probe(agent: HealthAgent): Promise<HealthReport> {
    const facts = await this.ask(agent)
    const now = new Date(this.now()).toISOString()
    const held = this.since[agent]
    const live: Partial<Record<ReasonKind, string>> = {}
    for (const r of reasons({ ...facts, since: {} })) live[r.kind] = held[r.kind] ?? now
    this.since[agent] = live
    if (facts.error !== this.lastError[agent]) {
      // said once per change: an agent that is down for an hour is one line, and so is its return
      this.deps.log({ route: 'agent_health', agent, event: facts.error === null ? 'ok' : 'failed', ...(facts.error ? { error: facts.error } : {}) })
      this.lastError[agent] = facts.error
    }
    return { ...facts, since: { ...live } }
  }

  private async ask(agent: HealthAgent): Promise<Omit<HealthReport, 'since'>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.deps.urls[agent]}/health`, {
        signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' },
      })
      if (!res.ok) return failed(agent, 'http', this.now())
      const text = await res.text()
      if (text.length > MAX_BODY) return failed(agent, 'bad_body', this.now())
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return failed(agent, 'bad_body', this.now())
      }
      return readHealth(agent, raw, this.now()) ?? failed(agent, 'bad_body', this.now())
    } catch {
      return failed(agent, controller.signal.aborted ? 'timeout' : 'unreachable', this.now())
    } finally {
      clearTimeout(timer)
    }
  }
}

export interface Health {
  readonly stop: () => void
}

/** On with the game hub (`AGENT_HEALTH=off` turns it off); off without it, and the header says nothing. */
export function startHealth(
  env: Readonly<Record<string, string | undefined>>,
  deps: { readonly hub: StatusPublisher | null; readonly log: (entry: Record<string, unknown>) => void; readonly fetchImpl?: typeof fetch },
): Health {
  if (deps.hub === null || (env.AGENT_HEALTH ?? '').trim().toLowerCase() === 'off') {
    deps.log({ route: 'agent_health', event: 'off', reason: deps.hub === null ? 'no_game' : 'disabled' })
    return { stop: () => undefined }
  }
  const urls = healthUrls(env)
  const poller = new HealthPoller({ hub: deps.hub, log: deps.log, urls, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) })
  poller.start()
  deps.log({ route: 'agent_health', event: 'polling', everyMs: 10_000 })
  return { stop: () => poller.stop() }
}
