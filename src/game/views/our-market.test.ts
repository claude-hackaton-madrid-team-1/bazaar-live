/**
 * The Our market screen on events shaped like the real game's (Sat 3 Oct): our venue v19 "Team 1 market" (board,
 * 0 % fee, bond 250), our broker's bench matches (b69-*), a bench session, and the offers that ask something of us.
 */
import { assert, test } from 'vitest'
import { OUR_MARKET_STRINGS } from '../ourMarketStrings.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { askedOfUs, benchRows, brokerMatches, isRival, ourVenues } from './our-market.ts'

let nextId = 1
let nextOffer = 100
let nextAsset = 5000
const ev = (type: string, payload: Payload = {}, tick = 900, actor = '', scope = 'public'): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope, actor, payload })

const PAGES = [
  { set: 'LAV', name: 'Lavapiés', have: 6, of: 10, complete: false },
  { set: 'LAT', name: 'La Latina', have: 2, of: 10, complete: false },
  { set: 'SAL', name: 'Salamanca', have: 1, of: 10, complete: false },
]

/** Us (t01) at tick 900: LAV-01..06 (one LAV-06), LAT-01, LAT-02, two SAL-01 (one is a duplicate); LAT-04 missing. */
const fresh = (): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', {}, 900))
  const held: [string, number][] = [['LAV-01', 16], ['LAV-02', 16], ['LAV-03', 16], ['LAV-04', 16], ['LAV-05', 16], ['LAV-06', 40], ['LAT-01', 5], ['LAT-02', 5], ['SAL-01', 3.2], ['SAL-01', 3.2]]
  apply(s, ev('agent.me', {
    cash: 120, album: { pages: PAGES }, affinity: { LAV: 1.6, LAT: 0.5, SAL: 1 }, score: { score: 30, rank: 7, bench_points: 0.5 },
    assets: held.map(([ref, v], i) => ({ id: i + 1, kind: 'card', ref, serial: 1, your_value: v })),
  }, 900, '', 'team'))
  return s
}

const list = (maker: string, venue: string, give: Payload, want: Payload, { to = null as string | null, tick = 899, expires = 905 } = {}) => ev('offer.listed', {
  venue,
  offer: { id: nextOffer++, maker, to, venue, thread: null, status: 'open', give: { cash: 0, assets: [], types: [], ...give }, want: { cash: 0, assets: [], types: [], ...want }, expires_tick: expires, created_tick: tick, final: false },
}, tick, maker)

const card = (ref: string) => ({ id: nextAsset++, kind: 'card', ref, serial: 1 })

const feed = (s: State, events: GameEvent[]) => {
  for (const e of events) apply(s, e)
  return s
}

test('our venue: status, mechanism, fee, bond from venue.opened; trades, volume and traders from the tape; its board; our announcements', () => {
  const s = feed(fresh(), [
    ev('venue.opened', { venue: 'v19', name: 'Team 1 market', owner: 't01', bond: 250, rules: { mechanism: 'board' }, fee_bps: 0, fee_per_card: 0 }, 262),
    ev('venue.opened', { venue: 'v02', name: 'Puesto 2', owner: 't02', bond: 250, rules: { mechanism: 'board' }, fee_bps: 200 }, 300),
    ev('venue.announcement', { venue: 'v19', text: 'Zero fees‮ all day' }, 800),
    ev('venue.announcement', { venue: 'v19', text: 'Bring your SAL duplicates' }, 850),
    ev('settlement', { settlement: 1, kind: 'trade', price: 20, venue: 'v19', parties: ['t05', 't07'], items: [{ id: 9, ref: 'LAV-08', name: 'x', frm: 't05', to: 't07' }] }, 880),
    ev('settlement', { settlement: 2, kind: 'trade', price: 13, venue: 'v19', parties: ['t07', 't09'], items: [{ id: 10, ref: 'RET-01', name: 'y', frm: 't07', to: 't09' }] }, 881),
    ev('settlement', { settlement: 3, kind: 'trade', price: 99, venue: 'v02', parties: ['t03', 't04'], items: [{ id: 11, ref: 'MAL-09', name: 'z', frm: 't03', to: 't04' }] }, 882),
    list('t05', 'v19', { assets: [card('LAV-09')] }, { cash: 80 }),
    list('t09', 'v19', { assets: [card('LAV-09')] }, { cash: 70 }),
    list('t12', 'v19', { cash: 30 }, { types: ['card:LAT-04'] }),
  ])
  const [v] = ourVenues(s)
  assert.deepInclude(v, { id: 'v19', name: 'Team 1 market', status: 'open', mechanism: 'board', feeBps: 0, bond: 250, openedTick: 262, trades: 2, volume: 33 })
  assert.deepEqual(v?.traders, ['t05', 't07', 't09'])
  // asks cheapest first, bids dearest first; t05 and t12 are rivals
  assert.deepEqual(v?.asks.map((o) => [o.maker, o.price, o.rival]), [['t09', 70, false], ['t05', 80, true]])
  assert.deepEqual(v?.bids.map((o) => [o.maker, o.ref, o.price, o.rival]), [['t12', 'LAT-04', 30, true]])
  assert.deepEqual(v?.announcements.map((a) => a.text), ['Bring your SAL duplicates', 'Zero fees all day'])
  assert.deepEqual(ourVenues(s).map((x) => x.id), ['v19'], 'only the venues we own')
  assert.isTrue(isRival('t17'))
  assert.isFalse(isRival('t01'))
})

test("our broker's matches and the bench sessions: bench matches counted inside each session's ticks, our venue's part flagged", () => {
  const s = fresh()
  const broker = (decision: number, tick: number, fields: Payload) => ev('agent.broker', { decision, bench: true, item: 'bench:b69', buyer: 'b69-3', seller: 'b69-19', makers: ['b69-19', 'b69-3'], price: 43, surplus: 15, ...fields }, tick, 'broker', 'team')
  feed(s, [
    ev('venue.opened', { venue: 'v19', name: 'Team 1 market', owner: 't01', bond: 250, rules: { mechanism: 'board' }, fee_bps: 0 }, 262),
    ev('bench.started', { name: 'The Market Test: every venue gets the same synthetic book', ticks: 16, venues: ['v01', 'v19'], session: 3, start_tick: 681 }, 681),
    ev('bench.started', { name: 'The Market Test: every venue gets the same synthetic book', ticks: 16, venues: ['v01', 'v19'], session: 4, start_tick: 892 }, 892),
    broker(2111, 893, { price: 73, surplus: 20 }),
    broker(2112, 895, { surplus: 28 }),
    broker(2113, 920, { surplus: 26 }), // after session 4 ended (892 + 16 = 908)
    broker(2120, 899, { bench: false, item: 'LAV-08', buyer: '13280', seller: '13276', makers: ['m1a2b3c4d', 'm9f8e7d6c'], price: 25, surplus: 10 }),
    broker(2112, 895, { surplus: 28 }), // the same match sent again: kept once
  ])
  assert.deepEqual(brokerMatches(s).map((m) => m.decision), [2120, 2113, 2112, 2111])
  assert.deepEqual(brokerMatches(s, { bench: false }).map((m) => [m.buyer, m.seller, m.price]), [['13280', '13276', 25]])
  const [live, , , bench] = brokerMatches(s)
  assert.equal(OUR_MARKET_STRINGS.en.match(live!), 'm1a2b3c4d × m9f8e7d6c (offers #13276 → #13280) at 25 P')
  assert.equal(OUR_MARKET_STRINGS.es.match(bench!), 'b69-19 → b69-3 a 73 P')
  const [now, before] = benchRows(s)
  assert.deepInclude(now, { session: 4, startTick: 892, endTick: 908, live: true, ours: true, matches: 2, surplus: 48 })
  assert.deepInclude(before, { session: 3, live: false, matches: 0 })
})

test('what people are asking us: addressed to us first, then bids for our cards, then asks for cards we miss; ours and other teams’ private offers left out', () => {
  const s = feed(fresh(), [
    list('t08', 'v02', { assets: [card('SAL-04')] }, { types: ['card:LAV-02'] }, { to: 't01', expires: 902 }),
    list('t17', 'rastro', { cash: 15 }, { types: ['card:LAV-06'] }),
    list('t09', 'rastro', { cash: 6 }, { types: ['card:SAL-01'] }),
    list('t02', 'v02', { assets: [card('LAT-04')] }, { cash: 7 }),
    list('t03', 'rastro', { assets: [card('LAT-04')] }, { cash: 4 }, { to: 't17' }),
    list('t01', 'rastro', { assets: [card('SAL-01')] }, { cash: 8 }),
    list('t04', 'rastro', { cash: 9 }, { types: ['card:MAL-01'] }),
  ])
  const rows = askedOfUs(s)
  assert.deepEqual(rows.map((r) => [r.maker, r.kind, r.ref, r.held, r.duplicate, r.rival]), [
    ['t08', 'forUs', 'SAL-04', 0, false, false],
    ['t17', 'bidHeld', 'LAV-06', 1, false, true],
    ['t09', 'bidHeld', 'SAL-01', 2, true, false],
    ['t02', 'askMissing', 'LAT-04', 0, false, false],
  ])
  assert.deepInclude(rows[0], { venue: 'v02', expiresIn: 2 })
  const en = OUR_MARKET_STRINGS.en
  const es = OUR_MARKET_STRINGS.es
  assert.equal(en.askLine(rows[0]!, true), "t08 offers SAL-04 to us with no cash if we give LAV-02 (we're missing SAL-04; LAV-02 is our only copy)")
  assert.equal(en.askLine(rows[1]!, false), 't17 bids 15 P for LAV-06 (we hold 1, not a duplicate: keep)')
  assert.equal(en.askLine(rows[2]!, true), 't09 bids 6 P for SAL-01 (we hold 2, a duplicate; worth 3.2 P to us: sell)')
  assert.equal(en.askLine(rows[3]!, true), 't02 sells LAT-04 at 7 P (worth 5 P to us: skip)')
  // without GAME_VIEW_TOKEN no value and no verdict read off one
  assert.equal(en.askLine(rows[2]!, false), 't09 bids 6 P for SAL-01 (we hold 2, a duplicate)')
  assert.equal(en.askLine(rows[3]!, false), "t02 sells LAT-04 at 7 P (we're missing it)")
  assert.equal(es.askLine(rows[0]!, false), 't08 nos ofrece SAL-04 sin dinero si le damos LAV-02 (nos falta SAL-04; LAV-02 es nuestra única copia)')
  assert.equal(es.askLine(rows[3]!, true), 't02 vende LAT-04 a 7 P (nos vale 5 P: no comprar)')
  assert.equal(es.askLine(rows[1]!, true), 't17 puja 15 P por LAV-06 (tenemos 1, no es repetida: la guardamos)')
})

test('no team yet, no venue of ours: nothing claimed', () => {
  const s = createState()
  assert.deepEqual([ourVenues(s), askedOfUs(s), benchRows(s)], [[], [], []])
})

test('our venues from our database (agent.venues): the feed window starts long after we opened ours, so the page still knows it', () => {
  const s = fresh()
  apply(s, ev('agent.venues', {
    venues: [
      { venue: 'v08', tick: 201, name: 'Puesto de Team 1', bond: 0, mechanism: 'auto', feeBps: 300, feePerCard: 0, closedTick: 260 },
      { venue: 'v19', tick: 262, name: 'Team 1 market', bond: 250, mechanism: 'board', feeBps: 0, feePerCard: 0, closedTick: null },
    ],
  }, 900, 'broker', 'team'))
  // a fee change in the window comes after and wins
  apply(s, ev('venue.fee_changed', { venue: 'v19', fee_bps: 100, fee_per_card: 0 }, 901))
  const venues = ourVenues(s)
  assert.deepEqual(venues.map((v) => [v.id, v.name, v.bond, v.mechanism, v.feeBps, v.openedTick]), [['v19', 'Team 1 market', 250, 'board', 100, 262]])
})

test('review: a bid for another team\'s named copy is not asking us; one for a copy of ours is', () => {
  const s = fresh()
  // our LAV-06 is asset id 6 (fresh: ids follow the held list)
  feed(s, [
    list('t17', 'rastro', { cash: 15 }, { assets: [{ id: 7777, ref: 'LAV-06' }] }),
    list('t18', 'rastro', { cash: 16 }, { assets: [{ id: 6, ref: 'LAV-06' }] }),
  ])
  assert.deepEqual(askedOfUs(s).map((r) => [r.maker, r.kind, r.ref]), [['t18', 'bidHeld', 'LAV-06']])
})

test('review: agent.venues before agent.hello waits for it; a re-sent one keeps a fee changed in the window', () => {
  const s = createState()
  const venues = ev('agent.venues', { venues: [{ venue: 'v19', tick: 262, name: 'Team 1 market', bond: 250, mechanism: 'board', feeBps: 0, feePerCard: 0, closedTick: null }] }, 900, 'broker', 'team')
  apply(s, ev('clock', {}, 900))
  apply(s, venues)
  assert.deepEqual(ourVenues(s), [], 'no team yet: nothing claimed')
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  assert.deepEqual(ourVenues(s).map((v) => [v.id, v.bond]), [['v19', 250]])
  assert.equal(s.venues.get('v19')?.seenTick, 900, 'seen now, not at its opening tick')
  apply(s, ev('venue.fee_changed', { venue: 'v19', fee_bps: 100, fee_per_card: 0 }, 901))
  apply(s, { ...venues, id: nextId++ })
  assert.equal(ourVenues(s)[0]?.feeBps, 100)
})

test('review: a listing seen before agent.venues leaves the fee empty; agent.venues fills it, a later fee change still wins', () => {
  const s = fresh()
  apply(s, list('t05', 'v19', { assets: [card('LAV-09')] }, { cash: 80 }))
  assert.isNull(s.venues.get('v19')?.feeBps ?? null)
  apply(s, ev('agent.venues', { venues: [{ venue: 'v19', tick: 262, name: 'Team 1 market', bond: 250, mechanism: 'board', feeBps: 0, feePerCard: 0, closedTick: null }] }, 900, 'broker', 'team'))
  assert.deepEqual(ourVenues(s).map((v) => [v.id, v.feeBps, v.bond]), [['v19', 0, 250]])
  apply(s, ev('venue.fee_changed', { venue: 'v19', fee_bps: 150, fee_per_card: 0 }, 901))
  apply(s, ev('agent.venues', { venues: [{ venue: 'v19', tick: 262, name: 'Team 1 market', bond: 250, mechanism: 'board', feeBps: 0, feePerCard: 0, closedTick: null }] }, 902, 'broker', 'team'))
  assert.equal(ourVenues(s)[0]?.feeBps, 150)
})
