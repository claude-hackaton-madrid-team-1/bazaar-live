import { describe, expect, it } from 'vitest'
import { dayOf, isoOf, orderOf, pointOf, scoreMarkOf, scorePointOf, teamEventOf, tradeOf } from './rows.ts'

describe('history rows', () => {
  it('reads a cash point, numbers sent as text included, and needs a day, a tick and the cash', () => {
    expect(pointOf({ day: '2026-10-03', tick: '386', cash: 176, score: '23.15', rank: 8 })).toEqual({ day: '2026-10-03', tick: 386, cash: 176, score: 23.15, rank: 8 })
    expect(pointOf({ day: '2026-10-03', tick: 1 })).toBeNull()
    expect(pointOf({ day: 'Sat Oct 03', tick: 1, cash: 1 })).toBeNull()
  })

  it('reads a trade, defaults the fee, and refuses an unknown side', () => {
    expect(tradeOf({ id: 470, day: '2026-10-03', tick: 386, side: 'sell', counterparty: 't16', venue: 'rastro', card: 'LAT-09', card_name: 'San Isidro', rarity: 'rare', items: 1, price: 68, fee: null })).toEqual({
      id: 470, day: '2026-10-03', tick: 386, side: 'sell', counterparty: 't16', venue: 'rastro', card: 'LAT-09', cardName: 'San Isidro', rarity: 'rare', items: 1, price: 68, fee: 0,
    })
    expect(tradeOf({ id: 1, day: '2026-10-03', tick: 1, side: 'swap', price: 1 })).toBeNull()
  })

  it('reads an order and a team event, making text one line', () => {
    expect(orderOf({ id: '77', day: '2026-10-03', tick: 397, kind: 'listing', price: 10, item: 'LAV-04', agent: 'maker' })).toEqual({ id: 77, day: '2026-10-03', tick: 397, kind: 'listing', price: 10, item: 'LAV-04', agent: 'maker', offer: null })
    // a listing posted by hand, with its offer as show.game_our_offers has it; an odd status drops the offer, never the row
    const hand = { id: 2, day: '2026-10-03', tick: 300, kind: 'listing', price: 16, item: 'hands-off:7', agent: 'sell', offer: 7, offer_side: 'bid', offer_card: 'RET-08', offer_venue: 'v02', offer_expires: 320, offer_status: 'open' }
    expect(orderOf(hand)?.offer).toEqual({ id: 7, side: 'bid', card: 'RET-08', venue: 'v02', expiresTick: 320, status: 'open' })
    expect(orderOf({ ...hand, offer_status: 'gone' })).toMatchObject({ item: 'hands-off:7', offer: null })
    expect(teamEventOf({ id: 15697, day: '2026-10-03', tick: 262, type: 'venue.opened', venue: 'v19', bond: 250, why: 'a\nb' })).toMatchObject({ type: 'venue.opened', bond: 250, why: 'a b', pack: null })
    expect(dayOf(new Date())).toBeNull()
  })

  it('reads a score point, parts sent as text included, and needs a day and a tick', () => {
    expect(scorePointOf({ day: '2026-10-03', tick: 535, read_at: '2026-10-03 10:37:22.96+00', cash: 81, score: '25.660', duel: '8.350', ladder: 0.02, neg: 134.7, mm: 0, bench: null })).toEqual({
      day: '2026-10-03', tick: 535, at: '2026-10-03T10:37:22.960Z', cash: 81, score: 25.66, duel: 8.35, ladder: 0.02, neg: 134.7, mm: 0, bench: null,
    })
    expect(scorePointOf({ day: '2026-10-03' })).toBeNull()
    expect(isoOf('not a time')).toBeNull()
  })

  it('reads a mark: a start needs its agent, an unknown kind is skipped', () => {
    expect(scoreMarkOf({ kind: 'start', id: '979', day: '2026-10-03', tick: 506, agent: 'taker' })).toEqual({ kind: 'start', id: 979, day: '2026-10-03', tick: 506, agent: 'taker', action: null, note: null, at: null })
    expect(scoreMarkOf({ kind: 'game', id: 22260, day: '2026-10-03', tick: 441, action: 'bench', note: 'The Market Test', at: new Date('2026-10-03T09:51:00Z') })).toMatchObject({ action: 'bench', at: '2026-10-03T09:51:00.000Z' })
    expect(scoreMarkOf({ kind: 'start', id: 1, day: '2026-10-03', tick: 1 })).toBeNull()
    expect(scoreMarkOf({ kind: 'deploy', id: 1, day: '2026-10-03', tick: 1, agent: 'taker' })).toBeNull()
  })
})
