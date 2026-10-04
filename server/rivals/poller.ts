/**
 * Reads db/rival_albums.sql's four views every few seconds and keeps the last snapshot in memory for GET /api/rivals,
 * the way ../view-poller.ts says.
 */
import { EMPTY_RIVALS, type RivalsParts, type RivalsSnapshot } from '../../shared/rivals.ts'
import { ViewPoller, type ViewPollerDeps } from '../view-poller.ts'
import { headOf, holdingOf, teamOf, wantOf } from './rows.ts'

export const SQL = {
  holdings: 'select holder, card, set_code, rarity, name, copies, how, since_tick, seen_tick from show.rival_holdings order by holder, card limit $1',
  // `*`: album_filled / album_slots are new columns of the view; a server deployed before the view is re-applied still reads its teams.
  teams: 'select t.* from show.rival_teams t order by t.rank, t.team limit $1',
  wants: 'select team, card, via, times, last_tick, top_bid from show.rival_wants order by last_tick desc, team, card limit $1',
  head: 'select tick from show.rival_head limit $1',
} as const

/** About 500 holdings and 500 wants on Saturday afternoon, for 18 teams and three dealers: room to double. */
export const CAPS = { holdings: 3000, teams: 50, wants: 2000, head: 1 } as const

export class RivalsPoller extends ViewPoller<keyof RivalsParts, RivalsSnapshot> {
  constructor(deps: ViewPollerDeps) {
    super({ route: 'rivals', empty: EMPTY_RIVALS, sql: SQL, caps: CAPS, intervalMs: 15_000 }, deps)
  }

  /** One read of the four views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const read = this.begin()
    const holdings = await this.view(read, 'holdings', holdingOf, prev.holdings)
    const teams = await this.view(read, 'teams', teamOf, prev.teams)
    const wants = await this.view(read, 'wants', wantOf, prev.wants)
    const tick = (await this.view(read, 'head', headOf, prev.tick === null ? [] : [prev.tick]))[0] ?? null
    // a new head tick alone is no change
    this.finish(read, { tick, holdings, teams, wants }, { holdings, teams, wants })
  }
}
