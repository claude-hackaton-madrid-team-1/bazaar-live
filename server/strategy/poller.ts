/**
 * Reads db/strategy.sql's five views every few seconds and keeps the last snapshot in memory for GET /api/strategy.
 * Like the history poller: on the server's one shared pool (the reader role has a connection limit), one capped
 * query after the other; a view not applied yet (42P01) or not granted (42501) only blanks its part, logged once;
 * any other error keeps the last good part and backs off; no exception leaves `pollOnce()`; error text is redacted.
 * `poke()` reads now (an agent's socket said something moved); `onChange` hears when a read's rows differ.
 */
import { EMPTY_STRATEGY, type StrategyParts, type StrategySnapshot } from '../../shared/strategy.ts'
import { parseAll } from '../learn/rows.ts'
import type { Db } from '../transcript/poller.ts'
import { askOf, catalogOf, decisionOf, meOf, spendOf } from './rows.ts'

export const SQL = {
  me: 'select team, tick, read_at, cash, level, venue, tick_seconds, affinity, pages, cards from show.strategy_me limit $1',
  spend: 'select ledger_tick, t_hours, spent, buys from show.strategy_spend limit $1',
  decisions: `select id, tick, agent, kind, status, allowed, guardrail, card, give_card, rarity, venue, price, fee, total, our_value, surplus,
                     jev_value, jev_verdict, jev_reason, reason
                from show.strategy_decisions order by id desc limit $1`,
  asks: 'select offer, tick, expires_tick, venue, maker, to_team, asset, card, rarity, price, ours from show.strategy_asks order by tick desc, offer desc limit $1',
  cards: 'select card, set_code, set_name, name, rarity, book, minted, print_run, page, last_fill, last_fill_tick from show.strategy_cards order by card limit $1',
} as const

/** 1500 decisions cover the last 300 ticks with room (about 3 a tick between the two agents today). */
export const CAPS = { me: 1, spend: 1, decisions: 1500, asks: 400, cards: 400 } as const

type Part = keyof StrategyParts

export interface StrategyPollerDeps {
  readonly db: Db
  readonly log: (entry: Record<string, unknown>) => void
  readonly intervalMs?: number
  readonly maxDelayMs?: number
  readonly secrets?: readonly string[]
  readonly now?: () => Date
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'ERR'
}

export class StrategyPoller {
  private snapshot: StrategySnapshot = EMPTY_STRATEGY
  private readonly missingLogged = new Set<Part>()
  private failures = 0
  private timer: unknown = null
  private running = false
  private reading = false
  private readonly listeners = new Set<(at: string) => void>()
  private readonly deps: StrategyPollerDeps
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(deps: StrategyPollerDeps) {
    this.deps = deps
    this.intervalMs = deps.intervalMs ?? 5_000
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  current(): StrategySnapshot {
    return this.snapshot
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
  }

  /** Reads now instead of at the next interval; false when stopped or already reading. */
  poke(): boolean {
    if (!this.running || this.reading) return false
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    void this.loop()
    return true
  }

  /** Called with the read's time whenever a read's rows differ from the last ones. Returns the unsubscribe. */
  onChange(listener: (at: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async loop(): Promise<void> {
    if (!this.running || this.reading) return
    this.reading = true
    try {
      await this.pollOnce()
    } finally {
      this.reading = false
    }
    if (!this.running) return
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.maxDelayMs, this.intervalMs * 2 ** this.failures)
    this.timer = (this.deps.setTimer ?? setTimeout)(() => void this.loop(), delay)
  }

  /** One read of the five views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const parts: Record<Part, boolean> = { ...prev.parts }
    let failed = false
    const read = async <T>(part: Part, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> => {
      try {
        const { rows } = await this.deps.db.query(SQL[part], [CAPS[part]])
        parts[part] = true
        this.missingLogged.delete(part)
        return parseAll(rows, parse)
      } catch (error: unknown) {
        const code = codeOf(error)
        if (code === '42P01' || code === '42501') {
          parts[part] = false
          if (!this.missingLogged.has(part)) this.deps.log({ route: 'strategy', event: 'view_missing', part, code })
          this.missingLogged.add(part)
          return []
        }
        failed = true
        this.deps.log({ route: 'strategy', event: 'poll_error', part, code, message: this.redact(error) })
        return keep
      }
    }
    const me = (await read('me', meOf, prev.me ? [prev.me] : []))[0] ?? null
    const spend = (await read('spend', spendOf, prev.spend ? [prev.spend] : []))[0] ?? null
    const decisions = await read('decisions', decisionOf, prev.decisions)
    const asks = await read('asks', askOf, prev.asks)
    const cards = await read('cards', catalogOf, prev.cards)
    this.failures = failed ? this.failures + 1 : 0
    const at = failed ? prev.at : (this.deps.now ?? (() => new Date()))().toISOString()
    const changed = JSON.stringify([parts, me, spend, decisions, asks, cards]) !== JSON.stringify([prev.parts, prev.me, prev.spend, prev.decisions, prev.asks, prev.cards])
    this.snapshot = { at, parts, me, spend, decisions, asks, cards }
    if (changed && at) for (const listener of this.listeners) listener(at)
  }

  private redact(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error)
    for (const s of this.deps.secrets ?? []) if (s) text = text.split(s).join('***')
    return text.slice(0, 200)
  }
}
