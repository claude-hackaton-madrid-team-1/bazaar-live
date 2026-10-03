/**
 * Our open board offers rebuilt from our database (`offers.ours`, db/game.sql's show.game_our_offers), on top of
 * whatever the page's replay carried: after a restart, a page opened late, a hand-placed bid.
 */
import { describe, expect, it } from 'vitest'
import { apply, createState, LIMITS, type GameEvent, type Payload, type State } from './state.ts'
import { ourOffers } from './views/market.ts'

let nextId = 1000
const ev = (type: string, payload: Payload, tick = 500, actor = ''): GameEvent => ({ id: nextId++, tick, type, scope: 'public', actor, payload })

/** A listing row as the feed (and `offers.ours`) carries it. */
const bidRow = (id: number, offer: number, ref: string, price: number, created: number, expires: number, venue = 'v02', maker = 't01') =>
  ({ id, tick: created, actor: maker, payload: { venue, offer: { id: offer, maker, venue, to: null, give: { cash: price, types: [], assets: [] }, want: { cash: 0, types: [`card:${ref}`], assets: [] }, created_tick: created, expires_tick: expires } } })
const askRow = (id: number, offer: number, ref: string, price: number, created: number, expires: number, maker = 't01') =>
  ({ id, tick: created, actor: maker, payload: { venue: 'rastro', offer: { id: offer, maker, venue: 'rastro', to: null, give: { cash: 0, types: [], assets: [{ id: offer, ref, kind: 'card' }] }, want: { cash: price, types: [], assets: [] }, created_tick: created, expires_tick: expires } } })
const listed = (row: { id: number; tick: number; actor: string; payload: Payload }): GameEvent => ({ id: row.id, tick: row.tick, type: 'offer.listed', scope: 'public', actor: row.actor, payload: row.payload })
const ours = (offers: (Payload & { hand?: boolean })[], tick = 500): GameEvent => ({ id: -(2 ** 49) - nextId++, tick, type: 'offers.ours', scope: 'team', actor: '', payload: { offers: offers.map((o) => ({ hand: false, ...o })) } })

/** A page started from the hub's replay: hello and clock first, then the backlog, then our offers' snapshot. */
function replay(backlog: GameEvent[], snapshot: GameEvent): State {
  const s = createState()
  for (const e of [ev('agent.hello', { team: 't01', name: 'Team 1' }), ev('clock', { day: 'Saturday', tick_seconds: 30 }), ...backlog, snapshot]) apply(s, e)
  return s
}

describe('our open offers, from our database', () => {
  it('shows an open offer of ours listed before the replay window (a restart, a late page), with its "by hand" mark', () => {
    // the bid was listed at tick 300; the backlog the page gets starts at tick 450
    const old = bidRow(10, 1, 'RET-08', 16, 300, 600)
    const backlog = [listed(bidRow(20, 2, 'LAV-02', 5, 450, 520, 'rastro', 't04'))]
    const s = replay(backlog, ours([{ ...old, hand: true }]))
    expect(ourOffers(s)).toMatchObject([{ offerId: 1, side: 'bid', ref: 'RET-08', price: 16, venueName: 'v02', expiresIn: 100, hand: true }])
    // the other team's offer is still on its board
    expect(s.book.get('rastro')?.has(2)).toBe(true)
  })

  it('an agent\'s offer is not marked by hand', () => {
    const row = askRow(30, 3, 'SAL-03', 8, 490, 530)
    const s = replay([listed(row)], ours([row]))
    expect(ourOffers(s).map((o) => [o.offerId, o.hand])).toEqual([[3, false]])
  })

  it('never shows a cancelled, a settled or an expired offer of ours as open, whatever the page saw of it', () => {
    // all three were listed inside the window; the page missed how each ended (the settlement names no offer, the
    // cancel fell outside, the expiry is the database's to call): the snapshot leaves them out, so they come off
    const cancelled = askRow(40, 4, 'LAV-04', 6, 470, 520)
    const settled = bidRow(41, 5, 'RET-01', 12, 470, 520)
    const expiredHere = bidRow(42, 6, 'MAL-02', 20, 470, 499)
    const open = bidRow(43, 7, 'RET-02', 10, 470, 520)
    const s = replay([cancelled, settled, expiredHere, open].map(listed), ours([open]))
    expect(ourOffers(s).map((o) => o.offerId)).toEqual([7])
    // an expired offer in the snapshot (the database a tick behind) does not come back either
    apply(s, ours([open, bidRow(44, 8, 'RET-03', 9, 300, 450)]))
    expect(ourOffers(s).map((o) => o.offerId)).toEqual([7])
    // and the next snapshot without the open one takes it off too
    apply(s, ours([]))
    expect(ourOffers(s)).toEqual([])
  })

  it('a full board drops the other teams\' oldest offers first, never ours', () => {
    const s = replay([], ours([{ ...bidRow(1, 1, 'RET-08', 16, 300, 600), hand: true }]))
    for (let i = 0; i < LIMITS.book + 5; i += 1) apply(s, listed(askRow(100 + i, 100 + i, 'LAV-01', 5, 500, 600, 't04')))
    expect(ourOffers(s).map((o) => [o.offerId, o.hand])).toEqual([[1, true]])
    expect([...s.book.values()].reduce((n, b) => n + b.size, 0)).toBe(LIMITS.book)
  })

  it('stays out of the event lists (a status, like the agents\' health)', () => {
    const s = replay([], ours([]))
    expect(s.events.some((e) => e.type === 'offers.ours')).toBe(false)
  })
})
