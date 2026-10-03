/**
 * Reads db/learn.sql's four views every few seconds and keeps the last snapshot in memory for GET /api/learn.
 *
 * Small and gentle on the shared database: four capped queries per poll, one after the other on a pool of
 * one. A view the admin has not applied yet (42P01) only blanks its part of the page and is logged once; any
 * other error keeps the last good part and backs off. No exception ever leaves `pollOnce()`, and error text
 * is redacted against the connection's secrets before it is logged.
 */
import { EMPTY_LEARN, type LearnParts, type LearnSnapshot } from '../../shared/learn.ts'
import type { Db } from '../transcript/poller.ts'
import { dealerOf, learningOf, moveOf, parseAll, rivalOf } from './rows.ts'

export const SQL = {
  learnings: `select id, scope, subject_kind, subject, kind, claim, source, confidence, support, created_tick, until_tick, team, stats
                from show.learnings order by updated_at desc nulls last, id desc limit $1`,
  moves: `select id, trader, thread, tick, event, our_price, their_price, step, final, source
            from show.trader_moves order by id desc limit $1`,
  dealers: `select dealer, threads, deals, our_threads, our_deals, avg_open, avg_fill, fill_ratio, our_fill_ratio, avg_steps, avg_ticks
              from show.dealer_stats order by threads desc, dealer limit $1`,
  rivals: `select team, updated_tick, level, venue, avg_pack_price, dealer_deal_rate, set_interest, fills, top_set
             from show.rival_profiles order by updated_tick desc nulls last, team limit $1`,
} as const

export const CAPS = { learnings: 400, moves: 300, dealers: 100, rivals: 60 } as const

type Part = keyof LearnParts

export interface LearnPollerDeps {
  readonly db: Db
  readonly log: (entry: Record<string, unknown>) => void
  readonly intervalMs?: number
  readonly maxDelayMs?: number
  /** Strings to cut out of any logged error text (the url, its host, its password). */
  readonly secrets?: readonly string[]
  readonly now?: () => Date
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'ERR'
}

export class LearnPoller {
  private snapshot: LearnSnapshot = EMPTY_LEARN
  private readonly missingLogged = new Set<Part>()
  private failures = 0
  private timer: unknown = null
  private running = false
  private readonly deps: LearnPollerDeps
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(deps: LearnPollerDeps) {
    this.deps = deps
    this.intervalMs = deps.intervalMs ?? 10_000
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  current(): LearnSnapshot {
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

  private async loop(): Promise<void> {
    if (!this.running) return
    await this.pollOnce()
    if (!this.running) return
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.maxDelayMs, this.intervalMs * 2 ** this.failures)
    this.timer = (this.deps.setTimer ?? setTimeout)(() => void this.loop(), delay)
  }

  /** One read of the four views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const parts: Record<Part, boolean> = { ...prev.parts }
    let failed = false
    const read = async <T>(part: Part, sql: string, cap: number, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> => {
      try {
        const { rows } = await this.deps.db.query(sql, [cap])
        parts[part] = true
        this.missingLogged.delete(part)
        return parseAll(rows, parse)
      } catch (error: unknown) {
        const code = codeOf(error)
        if (code === '42P01' || code === '42501') {
          // the view is not applied yet (or not granted): that part of the page says so, nothing else changes
          parts[part] = false
          if (!this.missingLogged.has(part)) this.deps.log({ route: 'learn', event: 'view_missing', part, code })
          this.missingLogged.add(part)
          return []
        }
        failed = true
        this.deps.log({ route: 'learn', event: 'poll_error', part, code, message: this.redact(error) })
        return keep
      }
    }
    const learnings = await read('learnings', SQL.learnings, CAPS.learnings, learningOf, prev.learnings)
    const moves = await read('moves', SQL.moves, CAPS.moves, moveOf, prev.moves)
    const dealers = await read('dealers', SQL.dealers, CAPS.dealers, dealerOf, prev.dealers)
    const rivals = await read('rivals', SQL.rivals, CAPS.rivals, rivalOf, prev.rivals)
    this.failures = failed ? this.failures + 1 : 0
    this.snapshot = { at: failed ? prev.at : (this.deps.now ?? (() => new Date()))().toISOString(), parts, learnings, moves, dealers, rivals }
  }

  private redact(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error)
    for (const s of this.deps.secrets ?? []) if (s) text = text.split(s).join('***')
    return text.slice(0, 200)
  }
}
