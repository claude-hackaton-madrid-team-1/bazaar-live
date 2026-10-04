/**
 * Reads db/learn.sql's four views every few seconds and keeps the last snapshot in memory for GET /api/learn, the way
 * ../view-poller.ts says.
 */
import { EMPTY_LEARN, type LearnParts, type LearnSnapshot } from '../../shared/learn.ts'
import { ViewPoller, type ViewPollerDeps } from '../view-poller.ts'
import { dealerOf, learningOf, moveOf, rivalOf } from './rows.ts'

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

export class LearnPoller extends ViewPoller<keyof LearnParts, LearnSnapshot> {
  constructor(deps: ViewPollerDeps) {
    super({ route: 'learn', empty: EMPTY_LEARN, sql: SQL, caps: CAPS, intervalMs: 10_000 }, deps)
  }

  /** One read of the four views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const read = this.begin()
    const learnings = await this.view(read, 'learnings', learningOf, prev.learnings)
    const moves = await this.view(read, 'moves', moveOf, prev.moves)
    const dealers = await this.view(read, 'dealers', dealerOf, prev.dealers)
    const rivals = await this.view(read, 'rivals', rivalOf, prev.rivals)
    this.finish(read, { learnings, moves, dealers, rivals })
  }
}
