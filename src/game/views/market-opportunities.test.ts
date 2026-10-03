import { assert, test } from 'vitest'
import { MockGame } from '../mock.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { needs, opportunities, ourCards, ourOffers, watchPrices, worthOf } from './market.ts'

let nextId = 1
let nextOffer = 100
let nextAsset = 5000
const ev = (type: string, payload: Payload = {}, tick = 10, actor = ''): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor, payload })

/** Our /me as the real game sent it (t01, tick 449), trimmed, with its set affinity: LAV 1.6, MAL 1.1, LAT 0.5, SAL 1.28 (complete); none for RET. */
const REAL_ASSETS: [string, number][] = [
  ['LAV-01', 16], ['LAV-02', 16], ['LAV-03', 16], ['LAV-04', 4], ['LAV-04', 4], ['LAV-05', 16], ['LAV-06', 40], ['LAV-07', 40],
  ['MAL-01', 11], ['MAL-03', 11], ['MAL-04', 11], ['MAL-05', 11], ['MAL-06', 27.5], ['MAL-07', 27.5],
  ['LAT-02', 5], ['LAT-03', 5],
  ['SAL-01', 3.2], ['SAL-01', 3.2], ['SAL-02', 99.1], ['SAL-03', 3.2], ['SAL-04', 99.1], ['SAL-05', 99.1], ['SAL-06', 118.6], ['SAL-07', 118.6],
  ['SAL-08', 118.6], ['SAL-09', 200], ['SAL-10', 200],
]

const PAGES = [
  { set: 'LAV', name: 'Lavapiés', have: 7, of: 10, complete: false },
  { set: 'MAL', name: 'Malasaña', have: 6, of: 10, complete: false },
  { set: 'LAT', name: 'La Latina', have: 2, of: 10, complete: false },
  { set: 'SAL', name: 'Salamanca', have: 10, of: 10, complete: true },
  { set: 'RET', name: 'El Retiro', have: 0, of: 10, complete: false },
]

const AFFINITY = { LAV: 1.6, MAL: 1.1, LAT: 0.5, SAL: 1.28 }

const real = (cash = 81): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', {}, 20))
  apply(s, ev('agent.me', {
    cash, album: { pages: PAGES }, affinity: AFFINITY,
    assets: REAL_ASSETS.map(([ref, v], i) => ({ id: i + 1, kind: 'card', ref, serial: 1, your_value: v })),
  }, 20))
  return s
}

const list = (maker: string, ref: string, price: number, { side = 'ask' as 'ask' | 'bid', to = null as string | null, venue = 'rastro', tick = 20, expires = undefined as number | undefined } = {}) => {
  const goods = side === 'ask' ? { cash: 0, assets: [{ id: nextAsset++, kind: 'card', ref, serial: 1 }], types: [] } : { cash: 0, assets: [], types: [`card:${ref}`] }
  const cash = { cash: price, assets: [], types: [] }
  return ev('offer.listed', {
    venue,
    offer: {
      id: nextOffer++, maker, to, venue, thread: null, status: 'open', give: side === 'ask' ? goods : cash, want: side === 'ask' ? cash : goods,
      expires_tick: expires ?? tick + 20, created_tick: tick, final: false,
    },
  }, tick, maker)
}

test("what a card is worth to us comes from the album's rules: book × affinity for a missing card, your_value for one we hold", () => {
  const s = real()
  assert.deepEqual(worthOf(s, 'LAV-08'), { value: 40, estimated: false }, 'an uncommon of LAV: 25 × 1.6')
  assert.deepEqual(worthOf(s, 'RET-01'), { value: 10, estimated: true }, 'a set with no affinity and nothing held: × 1, a guess')
  assert.deepEqual(worthOf(s, 'SAL-01'), { value: 3.2, estimated: false }, 'a spare is worth what its last copy is: your_value')
  assert.deepEqual(worthOf(s, 'SAL-11'), { value: 230.4, estimated: false })
  const need = needs(s)
  assert.equal(need.get('LAV-08'), 'missing')
  assert.equal(need.get('LAV-04'), 'spare')
  assert.equal(need.get('LAV-01'), 'held')
  assert.equal(need.get('LAV-11'), undefined, "a special is not missing while its page isn't complete")
  assert.equal(need.get('SAL-11'), 'missing', 'it is once the page is complete')
})

test('the last card of a page is worth its page bonus too, and the buy says it completes the page', () => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', {}, 20))
  apply(s, ev('agent.me', {
    cash: 200, affinity: { CHA: 1 }, album: { pages: [{ set: 'CHA', have: 9, of: 10, complete: false }] },
    assets: [10, 10, 10, 10, 10, 25, 25, 25, 70].map((v, i) => ({ id: i + 1, kind: 'card', ref: `CHA-0${i + 1}`, serial: 1, your_value: v })),
  }, 20))
  assert.deepEqual(ourCards(s).get('CHA-10'), { need: 'missing', worth: { value: 136.3, estimated: false }, completes: 'page' }, '70 + 25 % of the page (265)')
  apply(s, list('t05', 'CHA-10', 80))
  const [buy] = opportunities(s).buy
  assert.deepEqual([buy?.ref, buy?.net, buy?.completes], ['CHA-10', 56.3, 'page'])
})

test('buy: asks for missing cards under our value, open to anyone or addressed to us; the best per card, the biggest gain first', () => {
  const s = real()
  apply(s, list('t05', 'LAV-08', 30))
  apply(s, list('t06', 'LAV-08', 35))
  apply(s, list('t09', 'LAV-08', 25, { to: 't03' }))
  apply(s, list('t04', 'MAL-02', 9, { to: 't01' }))
  apply(s, list('t07', 'LAV-01', 5))
  apply(s, list('t08', 'LAT-01', 6))
  apply(s, list('t01', 'LAV-09', 20))
  apply(s, list('t10', 'MAL-08', 10, { tick: 5, expires: 15 }))
  const { buy, sell } = opportunities(s)
  assert.deepEqual(buy.map((o) => [o.ref, o.maker, o.price, o.value, o.net, o.more, o.forUs]), [
    ['LAV-08', 't05', 30, 40, 10, 1, false],
    ['MAL-02', 't04', 9, 11, 2, 0, true],
  ], 'not the ask addressed to t03, a card we hold, one over our value, our own, or an expired one')
  assert.equal(buy[0]?.estimated, false, 'our affinity for LAV is known: the value is exact')
  assert.equal(buy[0]?.need, 'missing')
  assert.deepEqual(sell, [])
})

test('buy: an ask under our value that costs more than our cash is only counted', () => {
  const s = real(81)
  apply(s, list('t05', 'SAL-11', 150))
  apply(s, list('t06', 'LAV-08', 30))
  const o = opportunities(s)
  assert.deepEqual(o.buy.map((b) => b.ref), ['LAV-08'])
  assert.equal(o.overCash, 1)
  assert.equal(o.cash, 81)
})

test('sell: bids for our spares at or over our value; never a single copy we keep, never under value', () => {
  const s = real()
  apply(s, list('t03', 'SAL-01', 8, { side: 'bid', tick: 15 }))
  apply(s, list('t04', 'SAL-01', 6, { side: 'bid' }))
  apply(s, list('t05', 'LAV-01', 50, { side: 'bid' }))
  apply(s, list('t06', 'LAV-04', 3, { side: 'bid' }))
  apply(s, list('t07', 'LAV-04', 4, { side: 'bid', to: 't12' }))
  const { sell } = opportunities(s)
  assert.deepEqual(sell.map((o) => [o.ref, o.maker, o.price, o.value, o.net, o.more, o.need]), [['SAL-01', 't03', 8, 3.2, 4.8, 1, 'spare']])
  assert.equal(sell[0]?.untaken, false, "under the agents' minimum sell surplus (5 P) it is not an obvious miss, however long it stays")
})

test('an opportunity left on the board for two ticks is flagged, with what our agents last did about the card', () => {
  const s = real()
  apply(s, list('t05', 'LAV-08', 30, { tick: 17 }))
  apply(s, list('t06', 'MAL-02', 8, { tick: 18 }))
  apply(s, list('t07', 'MAL-08', 20, { tick: 20 }))
  apply(s, ev('agent.decision', {
    decision: 7, agent: 'taker', kind: 'accept_ask', item: 'LAV-08', price: 30, value: 40, status: 'rejected', verdict: 'denied', rule: 'max_spend_per_game_hour',
  }, 18))
  apply(s, ev('agent.decision', { decision: 3, agent: 'taker', kind: 'accept_ask', item: 'MAL-02', price: 8, status: 'done', verdict: 'allowed', rule: null }, 12))
  const byRef = Object.fromEntries(opportunities(s).buy.map((o) => [o.ref, o]))
  assert.deepEqual([byRef['LAV-08']?.age, byRef['LAV-08']?.untaken, byRef['LAV-08']?.agent], [3, true, { agent: 'taker', status: 'rejected', rule: 'max_spend_per_game_hour' }])
  assert.deepEqual([byRef['MAL-02']?.untaken, byRef['MAL-02']?.agent], [true, null], 'a decision older than the offer says nothing about it')
  assert.deepEqual([byRef['MAL-08']?.untaken, byRef['MAL-08']?.expiresIn], [false, 20])
})

test('our offers: expiring first, with our value and whether another team shows a better price', () => {
  const s = real()
  apply(s, list('t01', 'SAL-01', 12, { expires: 30 }))
  apply(s, list('t09', 'SAL-01', 9))
  apply(s, list('t08', 'SAL-01', 5, { to: 't03' }))
  apply(s, list('t01', 'LAV-08', 20, { side: 'bid', expires: 24, venue: 'v02' }))
  apply(s, list('t03', 'LAV-08', 18, { side: 'bid' }))
  apply(s, ev('venue.opened', { venue: 'v02', name: 'El Duende', owner: 't12' }, 20))
  const rows = ourOffers(s)
  assert.deepEqual(rows.map((r) => [r.side, r.ref, r.price, r.worth?.value, r.venueName, r.expiresIn, r.best, r.beatenBy]), [
    ['bid', 'LAV-08', 20, 40, 'El Duende', 4, 18, null],
    ['ask', 'SAL-01', 12, 3.2, 'rastro', 10, 9, 3],
  ])
})

test('prices only for the cards we care about: missing first, then spares, then what we hold', () => {
  const s = real()
  const trade = (ref: string, price: number) => ev('settlement', {
    settlement: nextId, kind: 'trade', parties: ['t02', 't03'], venue: 'rastro', fee: 0, price,
    items: [{ id: nextAsset++, ref, serial: 1, kind: 'card', name: `Card ${ref}`, frm: 't02', to: 't03' }],
  })
  apply(s, trade('MAL-01', 9))
  apply(s, trade('SAL-01', 4))
  apply(s, trade('LAV-08', 28))
  apply(s, trade('LAV-08', 32))
  apply(s, trade('CHA-01', 12))
  const { rows, untraded } = watchPrices(s)
  assert.deepEqual(rows.map((r) => [r.ref, r.need, r.trades, r.median, r.worth?.value]), [
    ['LAV-08', 'missing', 2, 30, 40],
    ['SAL-01', 'spare', 1, 4, 3.2],
    ['MAL-01', 'held', 1, 9, 11],
  ])
  assert.equal(untraded, needs(s).size - 3)
})

test('the mock game opens with a buy and a sell to call out, and they sit there long enough to be flagged', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const game = new MockGame(seed)
    const s = createState()
    for (let i = 0; i < 8 * 3; i++) game.step().forEach((e) => apply(s, e))
    const o = opportunities(s)
    assert.isAtLeast(o.buy.length, 1, `seed ${seed}: a buy`)
    assert.isAtLeast(o.sell.length, 1, `seed ${seed}: a sell`)
    assert.isTrue([...o.buy, ...o.sell].some((x) => x.untaken), `seed ${seed}: one left untaken`)
  }
})
