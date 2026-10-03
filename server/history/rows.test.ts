import { describe, expect, it } from 'vitest'
import { dayOf, orderOf, pointOf, teamEventOf, tradeOf } from './rows.ts'

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
    expect(orderOf({ id: '77', day: '2026-10-03', tick: 397, kind: 'listing', price: 10, item: 'LAV-04', agent: 'maker' })).toEqual({ id: 77, day: '2026-10-03', tick: 397, kind: 'listing', price: 10, item: 'LAV-04', agent: 'maker' })
    expect(teamEventOf({ id: 15697, day: '2026-10-03', tick: 262, type: 'venue.opened', venue: 'v19', bond: 250, why: 'a\nb' })).toMatchObject({ type: 'venue.opened', bond: 250, why: 'a b', pack: null })
    expect(dayOf(new Date())).toBeNull()
  })
})
