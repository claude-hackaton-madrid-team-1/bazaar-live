/**
 * Reads db/history.sql's six views and db/teams_score.sql's one every few seconds and keeps the last snapshot in memory for
 * GET /api/history, the way ../view-poller.ts says.
 */
import { EMPTY_HISTORY, type HistoryParts, type HistorySnapshot } from '../../shared/history.ts'
import { parseAll } from '../learn/rows.ts'
import { codeOf, ViewPoller, type Read, type ViewPollerDeps } from '../view-poller.ts'
import { orderOf, pointOf, scoreMarkOf, scorePointOf, teamEventOf, teamScoreOf, tradeOf } from './rows.ts'

// newest first, capped, then put back in time order; day::text so a date never becomes a local midnight
export const SQL = {
  points: `select * from (select day::text as day, tick, cash, score, rank from show.cash_points order by day desc, tick desc limit $1) p order by day, tick`,
  trades: `select id, day::text as day, tick, venue, side, counterparty, card, card_name, rarity, items, price, fee
             from show.our_trades order by day desc, tick desc, id desc limit $1`,
  orders: `select id, day::text as day, kind, tick, price, item, agent, offer, offer_side, offer_card, offer_venue, offer_expires, offer_status
             from show.our_orders order by id desc limit $1`,
  events: `select id, day::text as day, tick, type, venue, name, bond, pack, best, cash, level, why
             from show.our_events order by day desc, tick desc, id desc limit $1`,
  scores: `select * from (select day::text as day, tick, read_at, cash, score, duel, ladder, neg, mm, bench from show.score_points order by day desc, tick desc limit $1) p order by day, tick`,
  marks: `select kind, id, day::text as day, tick, agent, action, note, at from show.score_marks order by day desc, tick desc limit $1`,
  // venue through to_jsonb: a server deployed before db/teams_score.sql is re-applied still reads the board
  board: `select * from (select day::text as day, tick, team, rank, score, negotiating, market, level, pages, deals, read_at, to_jsonb(t) ->> 'venue' as venue
             from show.team_scores t order by day desc, tick desc, team limit $1) b order by day, tick, team`,
} as const

/** board: about 700 reads for 18 teams by Saturday evening (a read is kept only when it moved): room for a long day. */
export const CAPS = { points: 2000, trades: 500, orders: 500, events: 200, scores: 2000, marks: 300, board: 6000 } as const

/**
 * What a part reads while its view predates this code (db/history.sql not re-applied yet: 42703, an undefined
 * column): the columns it had, so the screen keeps its rows. The new query is tried again every LEGACY_RETRY reads.
 */
export const LEGACY_SQL: Partial<Record<keyof typeof SQL, string>> = {
  orders: `select id, day::text as day, kind, tick, price, item, agent from show.our_orders order by id desc limit $1`,
}
export const LEGACY_RETRY = 60

type Part = keyof HistoryParts

export class HistoryPoller extends ViewPoller<Part, HistorySnapshot> {
  /** Parts read with LEGACY_SQL, and how many reads before the new query is tried again. */
  private readonly legacy = new Map<Part, number>()

  constructor(deps: ViewPollerDeps) {
    super({ route: 'history', empty: EMPTY_HISTORY, sql: SQL, caps: CAPS, intervalMs: 5_000 }, deps)
  }

  /** One read of the seven views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const read = this.begin()
    const points = await this.view(read, 'points', pointOf, prev.points)
    const trades = await this.view(read, 'trades', tradeOf, prev.trades)
    const orders = await this.view(read, 'orders', orderOf, prev.orders)
    const events = await this.view(read, 'events', teamEventOf, prev.events)
    const scores = await this.view(read, 'scores', scorePointOf, prev.scores)
    const marks = await this.view(read, 'marks', scoreMarkOf, prev.marks)
    const board = await this.view(read, 'board', teamScoreOf, prev.board)
    this.finish(read, { points, trades, orders, events, scores, marks, board })
  }

  /** As the base reads a part, but a view that predates this code (42703) is read with LEGACY_SQL for a while. */
  protected override async view<T>(read: Read<Part>, part: Part, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> {
    const left = this.legacy.get(part)
    if (left !== undefined) this.legacy.set(part, left - 1)
    const old = left !== undefined && left > 0 ? LEGACY_SQL[part] : undefined
    try {
      const { rows } = await this.deps.db.query(old ?? SQL[part], [CAPS[part]])
      if (old === undefined) this.legacy.delete(part)
      this.found(read, part)
      return parseAll(rows, parse)
    } catch (error: unknown) {
      if (codeOf(error) === '42703' && old === undefined && LEGACY_SQL[part] !== undefined) {
        if (left === undefined) this.deps.log({ route: 'history', event: 'view_outdated', part, code: '42703', note: 'apply db/history.sql; reading its older columns' })
        this.legacy.set(part, LEGACY_RETRY)
        return this.view(read, part, parse, keep)
      }
      return this.lost(read, part, error, keep)
    }
  }
}
