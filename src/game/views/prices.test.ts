import { assert, describe, test } from 'vitest'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { MIN_SELL_SURPLUS, MIN_SURPLUS } from './album.ts'
import { dealLines, feeOn, priceGuide, STANDARD_TRADES, trendOf } from './prices.ts'

let nextId = 1
let nextOffer = 100
let nextAsset = 5000
let nextSettlement = 900
const ev = (type: string, payload: Payload = {}, tick = 10, actor = ''): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor, payload })

/** Our /me as the real game sent it (t01, tick 449), trimmed: SAL complete, so each SAL page copy is worth its page. */
const REAL_ASSETS: [string, number][] = [
  ['LAV-01', 16], ['LAV-04', 4], ['LAV-04', 4], ['MAL-06', 27.5],
  ['LAT-02', 5], ['LAT-03', 5],
  ['SAL-01', 3.2], ['SAL-01', 3.2], ['SAL-02', 99.1], ['SAL-03', 3.2], ['SAL-04', 99.1], ['SAL-05', 99.1], ['SAL-06', 118.6], ['SAL-07', 118.6],
  ['SAL-08', 118.6], ['SAL-09', 200], ['SAL-10', 200],
]
const PAGES = [
  { set: 'LAV', name: 'Lavapiés', have: 2, of: 10, complete: false },
  { set: 'MAL', name: 'Malasaña', have: 1, of: 10, complete: false },
  { set: 'LAT', name: 'La Latina', have: 2, of: 10, complete: false },
  { set: 'SAL', name: 'Salamanca', have: 10, of: 10, complete: true },
]
const AFFINITY = { LAV: 1.6, MAL: 1.1, LAT: 0.5, SAL: 1.28 }

const real = (): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', {}, 20))
  apply(s, ev('agent.me', {
    cash: 80, album: { pages: PAGES }, affinity: AFFINITY,
    assets: REAL_ASSETS.map(([ref, v], i) => ({ id: i + 1, kind: 'card', ref, serial: 1, your_value: v })),
  }, 20))
  return s
}

const trade = (seller: string, buyer: string, ref: string, price: number, { tick = 15, venue = 'rastro' as string | null, kind = 'card' } = {}) =>
  ev('settlement', {
    settlement: nextSettlement++, kind: 'trade', parties: [seller, buyer], venue, persona: null, fee: 0, price,
    items: [{ id: nextAsset++, ref, serial: 1, kind, name: `Card ${ref}`, frm: seller, to: buyer }],
  }, tick)

const list = (maker: string, ref: string, price: number, { side = 'ask' as 'ask' | 'bid', venue = 'rastro', tick = 20, to = null as string | null } = {}) => {
  const goods = side === 'ask' ? { cash: 0, assets: [{ id: nextAsset++, kind: 'card', ref, serial: 1 }], types: [] } : { cash: 0, assets: [], types: [`card:${ref}`] }
  const cash = { cash: price, assets: [], types: [] }
  return ev('offer.listed', {
    venue,
    offer: { id: nextOffer++, maker, to, venue, thread: null, status: 'open', give: side === 'ask' ? goods : cash, want: side === 'ask' ? cash : goods, expires_tick: tick + 20, created_tick: tick, final: false },
  }, tick, maker)
}

const row = (s: State, ref: string) => {
  const r = priceGuide(s).find((x) => x.ref === ref)
  assert.ok(r, `${ref} in the guide`)
  return r
}

describe('trendOf', () => {
  test('needs two windows of fills, else no trend (never a guess)', () => {
    assert.deepEqual(trendOf([10, 10, 10, 10, 10]), { trend: null, change: null })
  })
  test('compares the newest window with the one before: up, down, flat within 5 %', () => {
    assert.equal(trendOf([14, 13, 15, 10, 10, 10]).trend, 'up')
    assert.equal(trendOf([7, 8, 7, 10, 10, 10]).trend, 'down')
    assert.equal(trendOf([10, 10, 10.4, 10, 10, 10]).trend, 'flat')
    assert.closeTo(trendOf([14, 14, 14, 10, 10, 10]).change ?? 0, 0.4, 1e-9)
  })
})

describe('dealLines', () => {
  test('a buy is good at or under min(our worth − MIN_SURPLUS, the standard price)', () => {
    assert.equal(dealLines(40, 'missing', 30).buyUpTo, 30, 'the market is cheaper than our worth: pay no more than the market')
    assert.equal(dealLines(20, 'missing', 30).buyUpTo, 20 - MIN_SURPLUS, 'the card is worth less to us: our line')
    assert.equal(dealLines(null, null, null).buyUpTo, null)
  })
  test('a sell is good at or over max(our worth + MIN_SELL_SURPLUS, the standard price), only for a copy we hold', () => {
    assert.equal(dealLines(5, 'spare', 12).sellFrom, 12)
    assert.equal(dealLines(118.6, 'held', 30).sellFrom, 118.6 + MIN_SELL_SURPLUS)
    assert.equal(dealLines(40, 'missing', 30).sellFrom, null, 'nothing to sell')
  })
})

describe('priceGuide', () => {
  test('the standard price is the median of the last fills; with none, the book price', () => {
    const s = real()
    for (const [i, p] of [12, 14, 16, 30, 10].entries()) apply(s, trade('t02', 't03', 'LAT-08', p, { tick: 10 + i }))
    const lat = row(s, 'LAT-08')
    assert.equal(lat.basis, 'trades')
    assert.equal(lat.standard, 14)
    assert.equal(lat.trades, 5)
    assert.equal(lat.last, 10, 'the newest fill')
    const lav = row(s, 'LAV-08')
    assert.equal(lav.basis, 'book', 'a card we lack with no fill yet is still in the guide, at its book price')
  })

  test('only the last STANDARD_TRADES fills count, and a pack is never a card price', () => {
    const s = real()
    for (let i = 0; i < STANDARD_TRADES; i++) apply(s, trade('t02', 't03', 'MAL-08', 100, { tick: 5 + i }))
    for (let i = 0; i < STANDARD_TRADES; i++) apply(s, trade('t02', 't03', 'MAL-08', 20, { tick: 30 + i }))
    apply(s, trade('abuela', 't03', 'MAL-08', 999, { tick: 40, kind: 'pack' }))
    assert.equal(row(s, 'MAL-08').standard, 20)
  })

  test("the board: the best ask and bid of others over every venue, with the venue's fee; ours counted apart", () => {
    const s = real()
    apply(s, ev('venue.opened', { venue: 'v07', name: 'Team 10', owner: 't10', fee_bps: 0, fee_per_card: 0, rules: { mechanism: 'board' } }))
    apply(s, list('t05', 'LAT-08', 20, { venue: 'rastro' }))
    apply(s, list('t06', 'LAT-08', 18, { venue: 'v07' }))
    apply(s, list('t07', 'LAT-08', 9, { side: 'bid' }))
    apply(s, list('t01', 'LAT-08', 15, { venue: 'v07' }))
    const r = row(s, 'LAT-08')
    assert.equal(r.ask?.price, 18, 'the cheapest ask of others, not ours at 15')
    assert.equal(r.ask?.venue, 'v07')
    assert.equal(r.bid?.price, 9)
    assert.equal(r.asks, 2)
    assert.equal(r.bids, 1)
    assert.equal(r.ours, 1)
    assert.equal(r.spread, 9)
  })

  test('feeOn: basis points of the price plus P per card; none on an unknown venue', () => {
    const s = real()
    apply(s, ev('venue.opened', { venue: 'v02', name: 'Team 12', owner: 't12', fee_bps: 500, fee_per_card: 1, rules: { mechanism: 'board' } }))
    assert.equal(feeOn(s, 'nowhere', 40), 0)
    assert.equal(feeOn(s, 'v02', 40), 3, '40 × 5 % + 1 P per card')
  })

  test("an ask's cost includes its venue's fee, so a cheap ask on a dear venue may not be a good buy", () => {
    const s = real()
    apply(s, ev('venue.opened', { venue: 'v02', name: 'Team 12', owner: 't12', fee_bps: 0, fee_per_card: 5, rules: { mechanism: 'board' } }))
    apply(s, list('t12', 'LAV-08', 34, { venue: 'v02' }))
    const r = row(s, 'LAV-08')
    assert.equal(r.ask?.cost, 39, '34 + 5 P per card')
    assert.equal(r.signal, null, 'LAV-08 is worth 40 to us, so we buy at 38 or less: 39 is over the line')
  })

  test('a SAL-07 sale at 29 is not a good deal: our copy completes Salamanca, so its sell line is its page', () => {
    const s = real()
    apply(s, list('pilar', 'SAL-07', 29, { side: 'bid' }))
    const r = row(s, 'SAL-07')
    assert.equal(r.need, 'held')
    assert.ok((r.sellFrom ?? 0) >= 118.6, `sell line ${r.sellFrom}`)
    assert.equal(r.signal, null, 'a bid of 29 never lights up a sell')
  })

  test('a spare copy sold over its worth and the market lights up a sell; a cheap ask for a card we lack, a buy', () => {
    const s = real()
    apply(s, list('t09', 'SAL-01', 20, { side: 'bid' }))
    assert.equal(row(s, 'SAL-01').signal, 'sell', 'SAL-01 is a spare worth 3.2 to us; 20 ≥ its line')
    apply(s, list('t09', 'LAV-08', 12))
    assert.equal(row(s, 'LAV-08').signal, 'buy', 'LAV-08 is missing, worth 40 to us; 12 ≤ min(38, book)')
  })

  test('focus: our cards only, or only the board\'s good deals; the deals come first; a query filters by ref or name', () => {
    const s = real()
    apply(s, trade('t02', 't03', 'RET-04', 6, { tick: 12 }))
    apply(s, list('t09', 'SAL-01', 20, { side: 'bid' }))
    const all = priceGuide(s)
    assert.equal(all[0]?.ref, 'SAL-01', 'the signal first')
    assert.ok(all.some((r) => r.ref === 'RET-04'), 'a card only others trade is in "all"')
    assert.ok(!priceGuide(s, { focus: 'ours' }).some((r) => r.ref === 'RET-04'))
    assert.deepEqual(priceGuide(s, { focus: 'signals' }).map((r) => r.ref), ['SAL-01'])
    assert.deepEqual(priceGuide(s, { query: 'ret-04' }).map((r) => r.ref), ['RET-04'])
  })
})
