import { assert, test } from 'vitest'
import { apply, createState, type GameEvent, type Payload } from '../state.ts'
import { cardStats, deltaText, deltaTone, marketTape, median, orderBook, sparkEnd, sparkPath, venueRows } from './market.ts'

let nextId = 1
let nextSettlement = 900
let nextAsset = 5000
const ev = (type: string, payload: Payload = {}, tick = 10, actor = ''): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor, payload })

const trade = (seller: string, buyer: string, ref: string, price: number, { tick = 10, venue = 'rastro' as string | null, fee = 0, name = `Card ${ref}` } = {}) => {
  const persona = seller === 'abuela' ? 'abuela' : null
  return ev('settlement', {
    settlement: nextSettlement++, kind: 'trade', parties: [seller, buyer], venue: persona ? null : venue, persona, fee, price,
    items: [{ id: nextAsset++, ref, serial: 1, kind: 'card', name, frm: seller, to: buyer }],
  }, tick)
}

const fresh = () => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  return s
}

test("the tape shows only other teams' trades by default, ours when asked", () => {
  const s = fresh()
  apply(s, trade('t02', 't03', 'LAT-01', 12, { tick: 5 }))
  apply(s, trade('t01', 't04', 'MAL-06', 30, { tick: 6 }))
  apply(s, trade('t05', 't02', 'SAL-02', 9, { tick: 7 }))
  assert.deepEqual(marketTape(s).map((r) => r.ref), ['SAL-02', 'LAT-01'])
  assert.deepEqual(marketTape(s, { include: 'all' }).map((r) => [r.ref, r.ours]), [['SAL-02', false], ['MAL-06', true], ['LAT-01', false]])
})

test('the tape search matches team, card, venue and ids', () => {
  const s = fresh()
  apply(s, trade('t02', 't03', 'LAT-01', 12, { venue: 'rastro', name: 'El Rastro' }))
  apply(s, trade('abuela', 't05', 'RET-03', 8))
  apply(s, trade('t06', 't07', 'MAL-12', 400, { venue: 'subasta' }))
  const [last] = s.tape
  const refs = (query: string) => marketTape(s, { query }).map((r) => r.ref)
  assert.deepEqual(refs('T05'), ['RET-03'])
  assert.deepEqual(refs('abuela'), ['RET-03'])
  assert.deepEqual(refs('mal-'), ['MAL-12'])
  assert.deepEqual(refs('el rastro'), ['LAT-01'])
  assert.deepEqual(refs('subasta'), ['MAL-12'])
  assert.deepEqual(refs(`s${last!.settlementId}`), ['MAL-12'])
  assert.deepEqual(refs(`#${last!.assetId}`), ['MAL-12'])
  assert.deepEqual(refs(`e${last!.eventId}`), ['MAL-12'])
  assert.deepEqual(refs('  '), ['MAL-12', 'RET-03', 'LAT-01'])
  assert.deepEqual(refs('nobody'), [])
})

test('each tape row carries its book price and the delta against it', () => {
  const s = fresh()
  apply(s, trade('t02', 't03', 'LAT-01', 15))
  apply(s, trade('t02', 't03', 'LAT-06', 20))
  apply(s, trade('t02', 't03', 'LAT-09', 70))
  apply(s, trade('t02', 't03', 'sobre_barrio', 30))
  assert.deepEqual(marketTape(s).map((r) => [r.ref, r.book, r.delta]),
    [['sobre_barrio', null, null], ['LAT-09', 70, 0], ['LAT-06', 25, -0.2], ['LAT-01', 10, 0.5]])
})

test('median of odd and even counts', () => {
  assert.strictEqual(median([5, 1, 3]), 3)
  assert.strictEqual(median([4, 1, 3, 10]), 3.5)
  assert.strictEqual(median([]), null)
})

test('card prices per ref: count, last, median, min, max, book, trend, sorted by trades', () => {
  const s = fresh()
  apply(s, trade('t02', 't03', 'LAT-01', 8, { tick: 1 }))
  apply(s, trade('t04', 't05', 'MAL-06', 30, { tick: 2 }))
  apply(s, trade('t02', 't06', 'LAT-01', 14, { tick: 3 }))
  apply(s, trade('t01', 't03', 'LAT-01', 99, { tick: 4 }))
  apply(s, trade('t03', 't02', 'LAT-01', 11, { tick: 5 }))
  apply(s, trade('t07', 't08', 'CHA-02', 10, { tick: 6 }))
  const stats = cardStats(s)
  assert.deepEqual(stats.map((c) => [c.ref, c.trades]), [['LAT-01', 3], ['CHA-02', 1], ['MAL-06', 1]])
  const lat = stats[0]
  assert.deepEqual([lat!.name, lat!.last, lat!.median, lat!.min, lat!.max, lat!.book, lat!.lastTick], ['Card LAT-01', 11, 11, 8, 14, 10, 5])
  assert.deepEqual(lat!.trend, [8, 14, 99, 11])
  assert.deepEqual(cardStats(s, 'all')[0]!.trades, 4)
  assert.strictEqual(cardStats(s, 'all')[0]!.max, 99)
})

test('sparkline path spans the box, flat and short series are safe', () => {
  assert.strictEqual(sparkPath([], 60, 16), '')
  assert.strictEqual(sparkPath([5], 60, 16), '')
  assert.strictEqual(sparkPath([0, 10], 60, 16), 'M1,15L59,1')
  assert.strictEqual(sparkPath([4, 4, 4], 60, 16), 'M1,8L30,8L59,8')
})

test('sparkline end dot sits on the last point', () => {
  assert.deepEqual(sparkEnd([0, 10], 60, 16), { x: 59, y: 1 })
  assert.strictEqual(sparkEnd([3], 60, 16), null)
})

let nextOffer = 1
const list = (maker: string, ref: string, price: number, { side = 'ask' as 'ask' | 'bid', venue = 'rastro', tick = 10 } = {}) => {
  const goods = side === 'ask' ? { cash: 0, assets: [{ id: nextAsset++, kind: 'card', ref, serial: 1 }], types: [] } : { cash: 0, assets: [], types: [`card:${ref}`] }
  const cash = { cash: price, assets: [], types: [] }
  return ev('offer.listed', {
    venue,
    offer: {
      id: nextOffer++, maker, to: null, venue, thread: null, status: 'open', give: side === 'ask' ? goods : cash, want: side === 'ask' ? cash : goods,
      expires_tick: tick + 20, created_tick: tick, final: false,
    },
  }, tick, maker)
}

test('order book: per venue and card, the cheapest ask and the dearest bid, with maker and age', () => {
  const s = fresh()
  apply(s, ev('clock', {}, 14))
  apply(s, list('t07', 'LAT-03', 12, { tick: 10 }))
  apply(s, list('t09', 'LAT-03', 11, { tick: 12 }))
  apply(s, list('t02', 'LAT-03', 11, { tick: 13 }))
  apply(s, list('t14', 'LAT-03', 8, { side: 'bid', tick: 11 }))
  apply(s, list('t01', 'LAT-03', 9, { side: 'bid', tick: 14 }))
  apply(s, list('t14', 'MAL-06', 18, { side: 'bid', tick: 9 }))
  apply(s, list('t05', 'SAL-01', 7, { venue: 't07-puesto' }))
  const books = orderBook(s)
  assert.deepEqual(books.map((b) => [b.venue, b.offers, b.ours]), [['rastro', 6, 1], ['t07-puesto', 1, 0]])
  const [lat, mal] = books[0]!.rows
  assert.deepEqual([lat!.ref, lat!.bids, lat!.asks, lat!.book], ['LAT-03', 2, 3, 10])
  assert.deepEqual([lat!.ask?.maker, lat!.ask?.price, lat!.ask?.age, lat!.ask?.ours], ['t09', 11, 2, false], 'a tie goes to the first listed')
  assert.deepEqual([lat!.bid?.maker, lat!.bid?.price, lat!.bid?.age, lat!.bid?.ours], ['t01', 9, 0, true])
  assert.deepEqual([mal!.ref, mal!.ask, mal!.bid?.price], ['MAL-06', null, 18])
})

test('order book: only ours on request, expired offers never show', () => {
  const s = fresh()
  apply(s, list('t07', 'LAT-03', 12))
  apply(s, list('t01', 'MAL-06', 30))
  apply(s, list('t01', 'SAL-01', 5, { venue: 't07-puesto', side: 'bid' }))
  assert.deepEqual(orderBook(s, { whose: 'ours' }).map((b) => [b.venue, b.rows.map((r) => r.ref)]), [['rastro', ['MAL-06']], ['t07-puesto', ['SAL-01']]])
  s.tick = 31
  assert.deepEqual(orderBook(s), [])
})

test('venues: open first and busiest first, with fee, owner and last announcement', () => {
  const s = fresh()
  apply(s, list('t07', 'LAT-03', 12))
  apply(s, list('t09', 'LAT-04', 12))
  apply(s, ev('venue.opened', { venue: 'v-t01', name: 'Our stall', owner: 't01', fee_bps: 150, fee_per_card: 1 }))
  apply(s, ev('venue.announcement', { venue: 'v-t01', text: 'Rares wanted' }, 11, 'v-t01'))
  apply(s, ev('venue.opened', { venue: 'v-t05', name: 'Puesto 5', owner: 't05', fee_bps: 0, fee_per_card: 0 }))
  apply(s, ev('venue.closing', { venue: 'v-t05' }))
  const rows = venueRows(s)
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.offers, r.owner, r.ours]),
    [['rastro', 'open', 2, null, false], ['v-t01', 'open', 0, 't01', true], ['v-t05', 'closing', 0, 't05', false]])
  assert.deepEqual([rows[1]!.name, rows[1]!.feeBps, rows[1]!.feePerCard, rows[1]!.announcement?.text, rows[1]!.announcements], ['Our stall', 150, 1, 'Rares wanted', 1])
})

test('book delta reads as an arrow and percent, above book in red, below in green', () => {
  assert.deepEqual([deltaText(0.5), deltaText(-0.204), deltaText(0), deltaText(null)], ['▲ 50%', '▼ 20%', '= 0%', ''])
  assert.deepEqual([deltaTone(0.5), deltaTone(-0.2), deltaTone(0), deltaTone(0.003), deltaTone(null)], ['bad', 'good', '', '', ''])
})
