import { assert, test } from 'vitest'
import { apply, createState, type GameEvent, type Payload } from '../state.ts'
import { affinityOf, albumRows, albumSummary, bestMoves, buyQuote, scoreBars, sellQuote, series, sparkline } from './album.ts'

let nextId = 1
const ev = (type: string, payload: Payload = {}, tick = 10): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor: '', payload })

const card = (id: number, ref: string, serial: number, your_value: number) => ({ id, kind: 'card', ref, serial, your_value })

const PAGE_BOOK = [10, 10, 10, 10, 10, 25, 25, 25, 70, 70]

// Our values are book × affinity × the marginal of the last copy (1, 0.25, 0.1): LAT ×0.5, RET ×1.2, MAL ×1.5.
const ME = {
  cash: 412,
  score: { score: 18.4, rank: 9, duel_points: 4, ladder_points: 6.5, neg_points: 7.9, mm_points: 0, bench_points: 2.5, deals: 3 },
  affinity: { LAT: 0.5, RET: 1.2, MAL: 1.5 },
  album: {
    pages: [
      { set: 'LAT', name: 'La Latina', have: 2, of: 10, complete: false, master: false },
      { set: 'RET', name: 'El Retiro', have: 10, of: 10, complete: true, master: false },
      { set: 'MAL', name: 'Malasaña', have: 9, of: 10, complete: false, master: false },
    ],
  },
  assets: [
    card(1, 'LAT-03', 4, 5),
    card(2, 'LAT-09', 1, 3.5),
    card(3, 'LAT-09', 2, 3.5),
    card(4, 'LAT-09', 3, 3.5),
    ...PAGE_BOOK.map((book, i) => card(10 + i, `RET-${String(i + 1).padStart(2, '0')}`, 1, book * 1.2)),
    card(30, 'RET-11', 1, 216),
    ...PAGE_BOOK.slice(0, 9).map((book, i) => card(40 + i, `MAL-${String(i + 1).padStart(2, '0')}`, 1, book * 1.5)),
    card(50, 'MAL-02', 2, 3.75),
    { id: 99, kind: 'pack', ref: 'sobre_barrio', name: 'Neighbourhood pack' },
    { id: 98, kind: 'pack', ref: 'sobre_barrio', name: 'Neighbourhood pack' },
    { id: 97, kind: 'pack', ref: 'sobre_dorado', name: 'Golden pack' },
  ],
}

const fresh = () => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  return s
}

const offer = (id: number, venue: string, maker: string, side: 'ask' | 'bid', ref: string, price: number) => {
  const goods = side === 'ask' ? { cash: 0, assets: [{ id: 500 + id, kind: 'card', ref, serial: 1 }], types: [] } : { cash: 0, assets: [], types: [`card:${ref}`] }
  const cash = { cash: price, assets: [], types: [] }
  const [give, want] = side === 'ask' ? [goods, cash] : [cash, goods]
  return ev('offer.listed', { venue, offer: { id, maker, venue, give, want, expires_tick: 99, created_tick: 8 } }, 8)
}

/** The fixture plus a market: LAT-09 traded at 33 then 31, asks for MAL-10 and the MAL epic, bids for our spare MAL-02. */
const loaded = () => {
  const s = fresh()
  apply(s, ev('agent.me', ME, 5))
  apply(s, ev('settlement', { settlement: 1, parties: ['t02', 't03'], price: 33, items: [{ ref: 'LAT-09', frm: 't02', to: 't03' }] }, 6))
  apply(s, ev('settlement', { settlement: 2, parties: ['t02', 't03'], price: 31, items: [{ ref: 'LAT-09', frm: 't03', to: 't02' }] }, 7))
  apply(s, offer(1, 'rastro', 't04', 'ask', 'MAL-10', 96))
  apply(s, offer(2, 't07-puesto', 't05', 'ask', 'MAL-10', 90))
  apply(s, offer(3, 'rastro', 't01', 'ask', 'MAL-10', 60))
  apply(s, offer(4, 'rastro', 't06', 'ask', 'MAL-11', 200))
  apply(s, offer(5, 't07-puesto', 't08', 'bid', 'MAL-02', 12))
  apply(s, offer(6, 'rastro', 't09', 'bid', 'MAL-02', 9))
  return s
}

test('no agent.me yet means no rows, an empty summary and no moves', () => {
  const s = fresh()
  assert.deepEqual(albumRows(s), [])
  assert.deepEqual(albumSummary(s), {
    pages: 0, complete: 0, master: 0, missing: 0, worth: 0, duplicates: { count: 0, worth: 0, market: 0, refs: [] }, cash: 0, estimate: false,
    packs: { count: 0, refs: [] },
  })
  assert.deepEqual(bestMoves(s), { buy: [], sell: [], pages: [] })
})

test('each page row has twelve slots with rarity, copies held, prices and what each is worth to us', () => {
  const s = loaded()
  const lat = albumRows(s, { sort: 'set' })[0]
  assert.deepEqual([lat!.set, lat!.name, lat!.color, lat!.have, lat!.of, lat!.missing, lat!.complete, lat!.master, lat!.affinity],
    ['LAT', 'La Latina', '#F4A259', 2, 10, 8, false, false, { value: 0.5, known: true }])
  assert.strictEqual(lat!.slots.length, 12)
  assert.deepEqual(lat!.slots.map((c) => c.ref).slice(9), ['LAT-10', 'LAT-11', 'LAT-12'])
  assert.deepEqual(lat!.slots.map((c) => c.rarity).slice(7, 12), ['uncommon', 'rare', 'rare', 'epic', 'legendary'])
  assert.deepEqual(lat!.slots.map((c) => c.count), [0, 0, 1, 0, 0, 0, 0, 0, 3, 0, 0, 0])
  const rare = lat!.slots[8]
  assert.deepEqual([rare!.num, rare!.color, rare!.book, rare!.value, rare!.last, rare!.spare, rare!.worth, rare!.tier],
    [9, '#4C8DFF', 70, 3.5, 31, true, 35, 3])
  assert.deepEqual(rare!.held, [{ id: 2, serial: 1 }, { id: 3, serial: 2 }, { id: 4, serial: 3 }])
  // a spare copy: sold at the last trade (nobody bids), it loses us the last copy's value
  assert.deepEqual([rare!.quote, rare!.net, rare!.move], [{ price: 31, source: 'tape', venue: null, maker: null }, 27.5, 'sell'])
  assert.strictEqual(rare!.title, 'LAT-09 · rare · ×3\nworth to us 35 P (book 70 × 0.5)\nsell a copy at 31 P (last trade): +27.5 P')
  const gap = lat!.slots[0]
  assert.deepEqual([gap!.count, gap!.value, gap!.last, gap!.spare, gap!.worth], [0, null, null, false, 5])
  // missing and worth 5 to us; nobody sells it, and at book it would lose us 5
  assert.deepEqual([gap!.quote?.source, gap!.net, gap!.move], ['book', -5, null])
  assert.strictEqual(gap!.title, 'LAT-01 · common · missing\nworth to us 5 P (book 10 × 0.5)\nbuy at 10 P (book): −5 P')
})

test('the card that finishes a page carries the page bonus, priced at the cheapest ask that is not ours', () => {
  const mal = albumRows(loaded()).find((r) => r.set === 'MAL')!
  const last = mal.slots[9]!
  assert.deepEqual(last.quote, { price: 90, source: 'board', venue: 't07-puesto', maker: 't05' })
  // 70 × 1.5 = 105, plus 25 % of the page (265 × 1.5) = 99.375, minus 90
  assert.deepEqual([last.worth, last.completes, last.net, last.move], [105, 'page', 114.4, 'buy'])
  assert.strictEqual(mal.bonus, 99.4)
  const epic = mal.slots[10]!
  assert.deepEqual([epic.worth, epic.completes, epic.net, epic.move], [270, null, 70, 'buy'])
  // nobody has priced the MAL legendary: at book it is a guess, never a move
  assert.deepEqual([mal.slots[11]!.quote?.source, mal.slots[11]!.move], ['book', null])
})

test('rows sort closest to completion first, or keep set order', () => {
  const s = loaded()
  assert.deepEqual(albumRows(s).map((r) => [r.set, r.missing]), [['RET', 0], ['MAL', 1], ['LAT', 8]])
  assert.deepEqual(albumRows(s, { sort: 'set' }).map((r) => r.set), ['LAT', 'RET', 'MAL'])
})

test('ties on missing slots break on the special slots, then set order', () => {
  const s = fresh()
  apply(s, ev('agent.me', {
    album: { pages: [{ set: 'LAV', have: 0, of: 10 }, { set: 'SAL', have: 0, of: 10 }, { set: 'CHA', have: 0, of: 10 }] },
    assets: [card(1, 'CHA-12', 1, 300)],
  }))
  assert.deepEqual(albumRows(s).map((r) => r.set), ['CHA', 'LAV', 'SAL'])
  assert.strictEqual(albumRows(s)[1]!.name, 'Lavapiés')
})

test('a page without have counts the page slots we hold', () => {
  const s = fresh()
  apply(s, ev('agent.me', { album: { pages: [{ set: 'SAL' }] }, assets: [card(1, 'SAL-01', 1, 9), card(2, 'SAL-01', 2, 9), card(3, 'SAL-11', 1, 90)] }))
  const [row] = albumRows(s)
  assert.deepEqual([row!.name, row!.have, row!.of, row!.missing, row!.complete], ['Salamanca', 1, 10, 9, false])
})

test("our affinity comes from /me, else from a card's your_value, else it is a ×1 guess", () => {
  const s = fresh()
  apply(s, ev('agent.me', {
    affinity: { LAV: 1.6, SAL: 'x' },
    album: { pages: [{ set: 'LAV' }, { set: 'SAL' }, { set: 'RET' }] },
    assets: [card(1, 'SAL-04', 1, 3.25), card(2, 'SAL-04', 2, 3.25)],
  }))
  assert.deepEqual(affinityOf(s, 'LAV'), { value: 1.6, known: true })
  // 3.25 = book 10 × affinity × 0.25 (the second copy's marginal)
  assert.deepEqual(affinityOf(s, 'SAL'), { value: 1.3, known: true })
  assert.deepEqual(affinityOf(s, 'RET'), { value: 1, known: false })
  assert.deepEqual(albumRows(s, { sort: 'set' }).map((r) => r.slots[0]!.title.split('\n')[1]), [
    'worth to us 16 P (book 10 × 1.6)', 'worth to us 13 P (book 10 × 1.3)', 'worth to us 10 P (book 10 × ~1)',
  ])
})

test('a quote is the best open offer of another team, else the last trade, else book', () => {
  const s = loaded()
  assert.deepEqual(buyQuote(s, 'MAL-10', 70), { price: 90, source: 'board', venue: 't07-puesto', maker: 't05' })
  assert.deepEqual(sellQuote(s, 'MAL-02', 10), { price: 12, source: 'board', venue: 't07-puesto', maker: 't08' })
  assert.deepEqual(buyQuote(s, 'LAT-09', 70), { price: 31, source: 'tape', venue: null, maker: null })
  assert.deepEqual(sellQuote(s, 'RET-12', 450), { price: 450, source: 'book', venue: null, maker: null })
  // an offer past its tick no longer counts
  apply(s, ev('clock', {}, 100))
  assert.strictEqual(buyQuote(s, 'MAL-10', 70).source, 'book')
})

test('best moves: buys that beat their price, copies the market overpays for, pages one or two cards away', () => {
  const m = bestMoves(loaded())
  assert.deepEqual(m.buy.map((b) => [b.ref, b.net, b.gain, b.completes, b.quote.source, b.estimate]), [
    ['MAL-10', 114.4, 204.4, 'page', 'board', false],
    ['MAL-11', 70, 270, null, 'board', false],
  ])
  assert.deepEqual(m.sell.map((x) => [x.ref, x.why, x.count, x.lose, x.quote.price, x.quote.source, x.net, x.estimate]), [
    ['LAT-09', 'spare', 3, 3.5, 31, 'tape', 27.5, false],
    ['MAL-02', 'spare', 2, 3.8, 12, 'board', 8.3, false],
    // our only LAT-03: LAT is worth ×0.5 to us and eight cards from its page
    ['LAT-03', 'low', 1, 5, 10, 'book', 5, true],
  ])
  assert.deepEqual(m.pages.map((p) => [p.set, p.have, p.missing.map((x) => x.ref), p.cost, p.gain, p.bonus, p.net, p.estimate]), [
    ['MAL', 9, ['MAL-10'], 90, 204.4, 99.4, 114.4, false],
  ])
  // never our only copy of a card of a set worth book or more to us
  assert.ok(m.sell.every((x) => x.why === 'spare' || x.ref.startsWith('LAT')))
  assert.deepEqual(bestMoves(loaded(), { limit: 1 }).sell.map((x) => x.ref), ['LAT-09'])
})

test('summary: what the album is worth to us, the spares at our value and at market, and cash', () => {
  const sum = albumSummary(loaded())
  assert.deepEqual([sum.pages, sum.complete, sum.master, sum.missing, sum.cash, sum.estimate], [3, 1, 0, 9, 412, false])
  // LAT 5 + 35 × 1.35 = 52.25; RET 265 × 1.2 + 216 + the 79.5 page bonus = 613.5; MAL 296.25
  assert.strictEqual(sum.worth, 962)
  assert.deepEqual(sum.duplicates, { count: 3, worth: 16, market: 74, refs: [{ ref: 'LAT-09', spare: 2 }, { ref: 'MAL-02', spare: 1 }] })
})

test("the album total matches the game's collection_value (Saturday's real /me: 621.1 P, no page complete)", () => {
  const s = fresh()
  const refs = ['LAT-02', 'LAT-03', 'LAV-01', 'LAV-02', 'LAV-03', 'LAV-04', 'LAV-04', 'LAV-05', 'LAV-06', 'LAV-07', 'LAV-08', 'MAL-01', 'MAL-02', 'MAL-02',
    'MAL-03', 'MAL-04', 'MAL-05', 'MAL-06', 'MAL-07', 'MAL-08', 'MAL-08', 'SAL-01', 'SAL-01', 'SAL-02', 'SAL-03', 'SAL-03', 'SAL-04', 'SAL-05', 'SAL-06',
    'SAL-07', 'SAL-08', 'SAL-10']
  apply(s, ev('agent.me', {
    cash: 176,
    affinity: { CHA: 0.9, LAT: 0.5, LAV: 1.6, MAL: 1.1, RET: 0.7, SAL: 1.3 },
    album: { pages: [{ set: 'LAV', have: 8, of: 10 }, { set: 'MAL', have: 8, of: 10 }, { set: 'LAT', have: 2, of: 10 }, { set: 'SAL', have: 9, of: 10 }, { set: 'RET', have: 0, of: 10 }] },
    assets: refs.map((ref, i) => ({ id: i + 1, kind: 'card', ref, serial: 1 })),
  }))
  const sum = albumSummary(s)
  assert.strictEqual(sum.worth, 621.1)
  // the five spare copies at their marginal (0.25): 4 + 2.75 + 6.875 + 3.25 + 3.25
  assert.deepEqual([sum.duplicates.count, sum.duplicates.worth], [5, 20.1])
  // Salamanca is one rare away: SAL-09's 91 + the 86.1 bonus, priced at book (nobody offers it)
  assert.deepEqual(bestMoves(s).pages.map((p) => [p.set, p.missing.map((x) => x.ref), p.gain, p.estimate]), [
    ['SAL', ['SAL-09'], 177.1, true],
    ['LAV', ['LAV-09', 'LAV-10'], 330, true],
    ['MAL', ['MAL-09', 'MAL-10'], 226.9, true],
  ])
})

test('summary counts the sealed packs we hold, by kind', () => {
  assert.deepEqual(albumSummary(loaded()).packs, {
    count: 3, refs: [{ ref: 'sobre_barrio', name: 'Neighbourhood pack', count: 2 }, { ref: 'sobre_dorado', name: 'Golden pack', count: 1 }],
  })
  assert.deepEqual(albumSummary(fresh()).packs, { count: 0, refs: [] })
})

test('score bars break the total into its five sources', () => {
  const sc = scoreBars(loaded())
  assert.deepEqual([sc.total, sc.rank, sc.deals], [18.4, 9, 3])
  assert.deepEqual(sc.bars.map((b) => [b.key, b.label, b.points]), [
    ['duel_points', 'Duels', 4], ['ladder_points', 'Ladder', 6.5], ['neg_points', 'Negotiation', 7.9], ['mm_points', 'Market-making', 0],
    ['bench_points', 'Bench', 2.5],
  ])
  assert.deepEqual(sc.bars.map((b) => Math.round(b.pct)), [40, 65, 79, 0, 25])
})

test('score bars scale to the largest part and never go negative', () => {
  const s = fresh()
  apply(s, ev('agent.me', { score: { score: 22, duel_points: 30, ladder_points: -8, neg_points: 15 } }))
  const sc = scoreBars(s)
  assert.deepEqual([sc.total, sc.rank, sc.deals], [22, null, null])
  assert.deepEqual(sc.bars.map((b) => [b.points, b.pct]), [[30, 100], [-8, 0], [15, 50], [0, 0], [0, 0]])
  assert.deepEqual(scoreBars(fresh()).bars.map((b) => b.pct), [0, 0, 0, 0, 0])
  apply(s, ev('agent.me', { score: { score: 22, bench_points: null } }))
  assert.strictEqual(scoreBars(s).bars.at(-1)!.points, 0, 'the game sends bench_points null until a bench run')
})

test('series reads score or cash per snapshot, and a sparkline draws it', () => {
  const s = fresh()
  apply(s, ev('agent.me', { cash: 100, score: { score: 1 } }, 1))
  apply(s, ev('agent.me', { cash: 80, score: { score: 3 } }, 2))
  apply(s, ev('agent.me', { cash: 120, score: { score: 2 } }, 3))
  assert.deepEqual(series(s.history, 'cash'), [100, 80, 120])
  assert.deepEqual(series(s.history, 'score'), [1, 3, 2])
  const line = sparkline([100, 80, 120], { w: 104, h: 26 })
  assert.deepEqual(line, { d: 'M2,13L52,23L102,3', x: 102, y: 3 })
  assert.strictEqual(sparkline([5], { w: 104, h: 26 }), null)
  assert.deepEqual(sparkline([5, 5], { w: 104, h: 26 }), { d: 'M2,13L102,13', x: 102, y: 13 })
})
