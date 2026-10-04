import { describe, expect, it } from 'vitest'
import { apply, createState, type State, type BookOffer } from '../state.ts'
import { tradingBook } from './market.ts'

function row(s: State, id: number, side: 'ask' | 'bid', price: number, ref = 'LAT-01', venue = 'v15', maker = 't02') {
  const goods = side === 'ask' ? { assets: [{ id: id + 1000, kind: 'card', ref }] } : { types: [`card:${ref}`] }
  apply(s, { id, tick: 10, type: 'offer.listed', actor: maker, scope: 'public', payload: {
    venue, offer: { id, maker, venue, status: 'open', created_tick: 10, expires_tick: 30,
      give: side === 'ask' ? goods : { cash: price }, want: side === 'bid' ? goods : { cash: price } },
  } })
}
function modify(s: State, id: number, update: Partial<BookOffer>) {
  const b = s.book.get('v15')
  const o = b?.get(id)
  if (!b || !o) throw new Error('fixture offer missing')
  b.set(id, { ...o, ...update })
}

describe('observed trading ladders', () => {
  it('sorts every bid descending and ask ascending within the same card and venue', () => {
    const s = createState()
    s.team = 't01'
    row(s, 1, 'bid', 8)
    row(s, 2, 'bid', 12, 'LAT-01', 'v15', 't01')
    row(s, 3, 'ask', 17)
    row(s, 4, 'ask', 14)
    row(s, 5, 'ask', 2, 'SAL-01')
    row(s, 6, 'bid', 100, 'LAT-01', 'v28')
    const book = tradingBook(s)
    const g = book.ladders.find((g) => g.key === 'v15:LAT-01')
    expect(g?.bids.map((o) => o.price)).toEqual([12, 8])
    expect(g?.asks.map((o) => o.price)).toEqual([14, 17])
    expect(g?.spread).toBe(2)
    expect(g?.bids[0]).toMatchObject({ id: 2, quantity: 1, ours: true, maker: 't01' })
    expect(book.ladders.filter((g) => g.key !== 'v15:LAT-01').every((g) => g.spread === null)).toBe(true)
  })

  it('omits swaps, missing prices, bundles and mixed cash instead of inventing comparable prices', () => {
    const s = createState()
    for (let i = 1; i <= 5; i++) row(s, i, 'ask', 10)
    modify(s, 1, { price: null })
    modify(s, 2, { give: { cash: 0, cards: ['LAT-01', 'SAL-02'] }, assetIds: [1002, 5000] })
    modify(s, 3, { side: 'swap' })
    modify(s, 4, { give: { cash: 2, cards: ['LAT-01'] } })
    modify(s, 5, { price: Number.NaN })
    expect(tradingBook(s)).toEqual({ ladders: [], excluded: 5 })
  })

  it('preserves unknown expiry and named-copy orders without using them for unrestricted spread', () => {
    const s = createState()
    row(s, 1, 'bid', 20)
    row(s, 2, 'ask', 10)
    modify(s, 1, { wantAssetIds: [999], expiresTick: null, maker: '?' })
    const g = tradingBook(s).ladders[0]
    expect(g?.bids[0]).toMatchObject({ wantAssetIds: [999], expiresTick: null, maker: '?' })
    expect(g?.spread).toBeNull()
  })

  it('excludes expired and cancelled orders and does not use privately addressed quotes for spread', () => {
    const s = createState()
    row(s, 1, 'bid', 10)
    row(s, 2, 'ask', 15)
    modify(s, 1, { to: 't08' })
    expect(tradingBook(s).ladders[0]?.spread).toBeNull()
    apply(s, { id: 3, tick: 11, type: 'offer.cancelled', scope: 'public', payload: { offer: 2 } })
    expect(tradingBook(s).ladders[0]?.asks).toEqual([])
    s.tick = 31
    expect(tradingBook(s).ladders).toEqual([])
  })
})
