/**
 * Reads db/strategy.sql's five views every few seconds and keeps the last snapshot in memory for GET /api/strategy,
 * the way ../view-poller.ts says.
 */
import { EMPTY_STRATEGY, type StrategyParts, type StrategySnapshot } from '../../shared/strategy.ts'
import { ViewPoller, type ViewPollerDeps } from '../view-poller.ts'
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

export class StrategyPoller extends ViewPoller<keyof StrategyParts, StrategySnapshot> {
  constructor(deps: ViewPollerDeps) {
    super({ route: 'strategy', empty: EMPTY_STRATEGY, sql: SQL, caps: CAPS, intervalMs: 5_000 }, deps)
  }

  /** One read of the five views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const read = this.begin()
    const me = (await this.view(read, 'me', meOf, prev.me ? [prev.me] : []))[0] ?? null
    const spend = (await this.view(read, 'spend', spendOf, prev.spend ? [prev.spend] : []))[0] ?? null
    const decisions = await this.view(read, 'decisions', decisionOf, prev.decisions)
    const asks = await this.view(read, 'asks', askOf, prev.asks)
    const cards = await this.view(read, 'cards', catalogOf, prev.cards)
    this.finish(read, { me, spend, decisions, asks, cards })
  }
}
