import { assert, test } from 'vitest'
import { apply, createState, isOurs, KNOWN_TYPES, LIMITS, type GameEvent, type Payload } from './state.ts'

let nextId = 1
// Duel messages and results only reach us from the relay's /api/duels read, which sends them as `team`.
const ev = (type: string, payload: Payload = {}, tick = 10, actor = ''): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: type.startsWith('duel.') ? 'team' : 'public', actor, payload })

const offer = ({ id = 7, maker, to, giveCash = 0, wantCash = 0, giveTypes = [] as string[], wantTypes = [] as string[], giveAssets = [] as Payload[], final = false, expires = 12, created = 10 }: Payload) => ({
  id, maker, to, venue: null, thread: 61, status: 'open',
  give: { cash: giveCash, assets: giveAssets, types: giveTypes },
  want: { cash: wantCash, assets: [], types: wantTypes },
  expires_tick: expires, created_tick: created, final,
})

const message = (sender: string, off: Payload, { team = 't01', text = null as string | null, message = 295, tactic = undefined as unknown } = {}) =>
  ev('thread.message', { thread: 61, kind: 'persona', message, sender, text, team, with: 'abuela', offer: off, ...(tactic === undefined ? {} : { tactic }) }, 10, sender)

const ME = {
  cash: 412,
  score: { score: 18.4, rank: 9, duel_points: 4, ladder_points: 6.5, neg_points: 7.9, mm_points: 0 },
  album: { pages: [{ set: 'LAT', name: 'La Latina', have: 2, of: 10, complete: false, master: false }] },
  assets: [
    { id: 1, kind: 'card', ref: 'LAT-03', serial: 4, your_value: 6 },
    { id: 2, kind: 'card', ref: 'LAT-09', serial: 1, your_value: 40 },
    { id: 3, kind: 'card', ref: 'LAT-09', serial: 2, your_value: 4 },
    { id: 4, kind: 'pack', ref: 'sobre_barrio' },
  ],
}

const fresh = () => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  return s
}

test('hello, clock and phase', () => {
  const s = fresh()
  apply(s, ev('clock', { day: 'sat', tick_seconds: 30 }, 144))
  apply(s, ev('agent.phase', { phase: 'decide', goal: 'complete La Latina' }))
  assert.deepEqual([s.team, s.name, s.tick, s.day, s.tickSeconds, s.phase, s.goal],
    ['t01', 'Team 1', 144, 'sat', 30, 'decide', 'complete La Latina'])
})

test('log lines keep their event id', () => {
  const s = fresh()
  const e = ev('agent.thought', { text: 'Abuela is soft today' }, 3)
  apply(s, e)
  apply(s, ev('agent.action', { kind: 'say', summary: 'bid 18 P' }, 4))
  assert.deepEqual(s.log.map((l) => [l.eventId === e.id || l.kind === 'say', l.tick, l.kind, l.text]),
    [[true, 3, 'thought', 'Abuela is soft today'], [true, 4, 'say', 'bid 18 P']])
})

test('dealer ask and our bid keep thread, offer and message ids', () => {
  const s = fresh()
  apply(s, message('abuela', offer({ id: 334, maker: 'abuela', to: 't01', giveTypes: ['pack:sobre_barrio'], wantCash: 30, created: 31, expires: 33 }), { text: '30 P, cariño', message: 301 }))
  apply(s, message('t01', offer({ id: 335, maker: 't01', to: 'abuela', giveCash: 18, wantTypes: ['pack:sobre_barrio'] }), { message: 302 }))
  const th = s.threads[61]
  assert.deepEqual([th!.with, th!.topic, th!.side, th!.theirPrice, th!.ourPrice, th!.rounds, th!.lastText, th!.final],
    ['abuela', 'sobre_barrio', 'buy', 30, 18, 2, '30 P, cariño', false])
  assert.deepEqual(th!.offers.map((o) => [o.offerId, o.messageId, o.side, o.price, o.maker, o.to]),
    [[334, 301, 'them', 30, 'abuela', 't01'], [335, 302, 'us', 18, 't01', 'abuela']])
  assert.strictEqual(th!.offers[0]!.createdTick, 31)
  assert.strictEqual(th!.offers[0]!.expiresTick, 33)
  assert.ok(th!.offers[0]!.eventId > 0)
})

test('the tactic of our messages is kept per offer; theirs, none and a label that is not an id are null', () => {
  const s = fresh()
  const ask = (tactic: unknown) => message('abuela', offer({ maker: 'abuela', to: 't01', giveTypes: ['card:LAT-08'], wantCash: 30 }), { tactic })
  const bid = (tactic: unknown) => message('t01', offer({ maker: 't01', to: 'abuela', giveCash: 18, wantTypes: ['card:LAT-08'] }), { tactic })
  for (const e of [bid('empathy_label'), ask('scarcity'), bid('none'), bid('Bad label!'), bid(7), bid(undefined), bid('plain')]) apply(s, e)
  assert.deepEqual(s.threads[61]!.offers.map((o) => [o.side, o.tactic]),
    [['us', 'empathy_label'], ['them', null], ['us', null], ['us', null], ['us', null], ['us', null], ['us', 'plain']])
})

test('final offer and topic from types', () => {
  const s = fresh()
  apply(s, message('abuela', offer({ maker: 'abuela', to: 't01', giveTypes: ['card:LAT-08'], wantCash: 22, final: true, expires: 33 })))
  assert.deepEqual([s.threads[61]!.final, s.threads[61]!.expiresTick, s.threads[61]!.topic], [true, 33, 'LAT-08'])
})

test('our sell offer names the asset id', () => {
  const s = fresh()
  apply(s, message('t01', offer({ maker: 't01', to: 't05', wantCash: 14, giveAssets: [{ id: 284, kind: 'card', ref: 'MAL-02', serial: 17 }] })))
  const th = s.threads[61]
  assert.deepEqual([th!.side, th!.topic, th!.offers[0]!.assets], ['sell', 'MAL-02', [284]])
})

test("other teams' threads are not ours, closed is marked", () => {
  const s = fresh()
  apply(s, message('abuela', offer({ maker: 'abuela', to: 't07', wantCash: 27 }), { team: 't07' }))
  assert.deepEqual(s.threads, {})
  apply(s, message('abuela', offer({ maker: 'abuela', to: 't01', wantCash: 30 })))
  apply(s, ev('thread.closed', { thread: 61 }))
  assert.strictEqual(s.threads[61]!.status, 'closed')
})

test('agent.me sets cash, score, album, held assets with ids', () => {
  const s = fresh()
  apply(s, ev('agent.me', ME))
  assert.strictEqual(s.cash, 412)
  assert.strictEqual(s.score.rank, 9)
  assert.strictEqual(s.pages[0]!.set, 'LAT')
  assert.deepEqual(s.owned['LAT-09'], [{ id: 2, serial: 1 }, { id: 3, serial: 2 }])
  assert.strictEqual(s.values['LAT-09'], 4)
  assert.strictEqual(s.owned.sobre_barrio, undefined)
  assert.deepEqual(s.history.at(-1), { tick: 10, score: 18.4, cash: 412 })
})

test('settlements keep settlement, asset and serial ids, and our gain', () => {
  const s = fresh()
  apply(s, ev('agent.me', ME))
  apply(s, ev('settlement', {
    settlement: 9, parties: ['t04', 't11'], venue: 'rastro', price: 14, fee: 1,
    items: [{ id: 501, kind: 'card', ref: 'MAL-02', serial: 33, name: 'Plaza del Dos de Mayo', frm: 't04', to: 't11' }],
  }, 50))
  apply(s, ev('settlement', {
    settlement: 10, parties: ['abuela', 't01'], venue: null, persona: 'abuela', price: 22,
    items: [{ id: 502, kind: 'card', ref: 'LAT-09', serial: 3, frm: 'abuela', to: 't01' }],
  }, 51))
  apply(s, ev('settlement', {
    settlement: 11, parties: ['abuela', 't01'], price: 9, your_value: 16,
    items: [{ id: 503, kind: 'card', ref: 'MAL-05', serial: 2, frm: 'abuela', to: 't01' }],
  }, 52))
  const [c, b, a] = s.tape
  assert.deepEqual([a!.settlementId, a!.assetId, a!.serial, a!.venue, a!.seller, a!.buyer, a!.price, a!.fee, a!.ours, a!.gain],
    [9, 501, 33, 'rastro', 't04', 't11', 14, 1, false, null])
  assert.deepEqual([b!.venue, b!.ours, b!.gain], ['abuela', true, 4 - 22])
  assert.strictEqual(c!.gain, 7)
  assert.ok(a!.eventId > 0)
  assert.deepEqual(s.prices['MAL-02'], [14])
})

test('tape is newest first and bounded', () => {
  const s = fresh()
  for (let i = 0; i < 300; i++) {
    apply(s, ev('settlement', { settlement: i, parties: ['t02', 't03'], price: i, items: [{ id: i, ref: 'LAV-01', frm: 't02', to: 't03' }] }, i))
  }
  assert.strictEqual(s.tape[0]!.price, 299)
  assert.ok(s.tape.length <= 200)
})

test('our value created adds up over the session, not just the tape window', () => {
  const s = fresh()
  apply(s, ev('settlement', { settlement: 1, parties: ['abuela', 't01'], price: 9, your_value: 16, items: [{ id: 1, ref: 'MAL-05', frm: 'abuela', to: 't01' }] }))
  for (let i = 0; i < 300; i++) {
    apply(s, ev('settlement', { settlement: i + 2, parties: ['t02', 't03'], price: 5, items: [{ id: i + 2, ref: 'LAV-01', frm: 't02', to: 't03' }] }))
  }
  assert.strictEqual(s.tape.some((t) => t.ours), false)
  assert.deepEqual(s.ours, { trades: 1, gain: 7 })
})

test('duels track both sides and the result', () => {
  const s = fresh()
  apply(s, ev('duel.message', { duel: 3, role: 'seller', sender: 't01', price: 60, days: 4 }))
  apply(s, ev('duel.message', { duel: 3, role: 'seller', sender: 'rival', price: 41, days: 7 }))
  apply(s, ev('duel.result', { duel: 3, deal: true, price: 47, points: 1.2 }))
  const d = s.duels[3]
  assert.deepEqual([d!.role, d!.ourPrice, d!.theirPrice, d!.ourDays, d!.theirDays, d!.rounds, d!.status, d!.dealPrice, d!.points],
    ['seller', 60, 41, 4, 7, 2, 'deal', 47, 1.2])
})

test('duels keep their rival: from the payload, else from a named sender, never from us or the bare "rival"', () => {
  const s = fresh()
  apply(s, ev('duel.message', { duel: 3, role: 'seller', rival: 'Rival Azul', sender: 't01', price: 60 }))
  apply(s, ev('duel.message', { duel: 4, role: 'buyer', sender: 't01', price: 30 }))
  apply(s, ev('duel.message', { duel: 4, role: 'buyer', sender: 'rival', price: 35 }))
  apply(s, ev('duel.message', { duel: 5, role: 'buyer', sender: 'Rival Oro', price: 35 }))
  apply(s, ev('duel.result', { duel: 6, rival: 'Rival Noche', deal: false, price: null, points: 0 }))
  assert.deepEqual([3, 4, 5, 6].map((id) => s.duels[id]!.rival), ['Rival Azul', null, 'Rival Oro', 'Rival Noche'])
  apply(s, ev('duel.result', { duel: 4, rival: 'Rival Sol', deal: true, price: 33, points: 1 }))
  assert.strictEqual(s.duels[4]!.rival, 'Rival Sol')
})

test('a result for a duel we never heard a word of still makes a row', () => {
  const s = fresh()
  apply(s, ev('duel.result', { duel: 7, deal: false, price: null, points: 0 }))
  assert.deepEqual([s.duels[7]!.status, s.duels[7]!.rounds], ['no deal', 0])
})

test('the feed\'s public duel.closed is ours only for a duel of ours; a public duel message builds no row', () => {
  const s = fresh()
  const pub = (type: string, payload: Payload): GameEvent => ({ ...ev(type, payload), scope: 'public' })
  apply(s, ev('duel.message', { duel: 3, role: 'seller', sender: 'Rival Oro', price: 41 }))
  const theirs = pub('duel.closed', { duel: 9, session: 4, status: 'deal', item: 'El Instituto' })
  const ours = pub('duel.closed', { duel: 3, session: 4, status: 'no_deal', item: 'El Instituto' })
  apply(s, theirs)
  apply(s, ours)
  assert.deepEqual([s.mine.includes(theirs), s.mine.includes(ours)], [false, true])
  apply(s, pub('duel.message', { duel: 12, role: 'buyer', sender: 't05', price: 30 }))
  apply(s, pub('duel.result', { duel: 13, deal: true, price: 30 }))
  assert.deepEqual(Object.keys(s.duels), ['3'])
})

test('every event lands in the bounded stream and the id index, unknown types change nothing else', () => {
  const s = fresh()
  const before = JSON.stringify({ ...s, events: [], byId: null, mine: [] })
  const e = ev('egg.found', { x: 1 })
  apply(s, e)
  assert.strictEqual(JSON.stringify({ ...s, events: [], byId: null, mine: [] }), before)
  assert.strictEqual(s.events.at(-1), e)
  assert.strictEqual(s.byId.get(e.id), e)
  for (let i = 0; i < 700; i++) apply(s, ev('egg.found'))
  assert.ok(s.events.length <= 500)
  assert.ok(s.byId.size <= LIMITS.events + s.mine.length)
  assert.ok(KNOWN_TYPES.has('settlement') && !KNOWN_TYPES.has('egg.found'))
})

test('isOurs: our agent, our threads, our settlements and duels (from our duel list); nothing else', () => {
  const s = fresh()
  apply(s, message('abuela', offer({ maker: 'abuela', to: 't01', wantCash: 30 })))
  const yes = [
    ev('agent.thought', { text: 'x' }), ev('agent.action', { kind: 'say', summary: 'x' }), ev('agent.phase', { phase: 'act' }),
    ev('agent.me', ME), ev('agent.hello', { team: 't01' }), ev('clock', { day: 'fri' }),
    ev('thread.message', { thread: 61, team: 't01', sender: 'abuela' }), ev('thread.closed', { thread: 61 }),
    ev('settlement', { parties: ['abuela', 't01'], items: [] }),
    ev('duel.message', { duel: 1, sender: 'rival' }), ev('duel.result', { duel: 1 }),
  ]
  const no = [
    { ...ev('duel.closed', { duel: 1 }), scope: 'public' }, { ...ev('duel.message', { duel: 2, sender: 'rival' }), scope: 'public' },
    ev('thread.message', { thread: 70, team: 't07', sender: 'abuela' }), ev('thread.closed', { thread: 70 }),
    ev('settlement', { parties: ['t02', 't03'], items: [] }), ev('egg.found'), ev('announcement', { text: 'hi' }),
  ]
  assert.deepEqual(yes.map((e) => isOurs(s, e)), yes.map(() => true))
  assert.deepEqual(no.map((e) => isOurs(s, e)), no.map(() => false))
})

test('our events live in their own list, a market flood does not evict them', () => {
  const s = fresh()
  const mine = ev('agent.action', { kind: 'accept', summary: 'took 22 P' }, 5)
  apply(s, mine)
  for (let i = 0; i < 2000; i++) {
    apply(s, ev('settlement', { settlement: i, parties: ['t02', 't03'], price: 5, items: [{ id: i, ref: 'LAV-01', frm: 't02', to: 't03' }] }))
  }
  assert.ok(s.mine.includes(mine))
  assert.strictEqual(s.mine.some((e) => e.type === 'settlement'), false)
  for (let i = 0; i < LIMITS.mine + 10; i++) apply(s, ev('agent.thought', { text: String(i) }))
  assert.strictEqual(s.mine.length, LIMITS.mine)
})

const card = (id: number, ref: string, serial = 1) => ({ id, kind: 'card', ref, serial, rarity: 'common', set: ref.slice(0, 3), print_run: 300 })

/** A board listing as the game sends it: an ask gives a copy for cash, a bid gives cash for a card type. */
const listed = (id: number, maker: string, { venue = 'rastro', ask = null as Payload | null, bid = null as string | null, price = 10, tick = 10, expires = null as number | null } = {}) =>
  ev('offer.listed', {
    venue,
    offer: {
      id, maker, to: null, venue, thread: null, status: 'open',
      give: ask ? { cash: 0, assets: [ask], types: [] } : { cash: price, assets: [], types: [] },
      want: ask ? { cash: price, assets: [], types: [] } : { cash: 0, assets: [], types: [`card:${bid}`] },
      expires_tick: expires ?? tick + 20, created_tick: tick, final: false,
    },
  }, tick, maker)

const bookIds = (s: ReturnType<typeof fresh>) => Object.fromEntries([...s.book].map(([v, offers]) => [v, [...offers.keys()]]))

test('agent.me keeps our sealed packs, and an empty hand empties the album', () => {
  const s = fresh()
  apply(s, ev('agent.me', ME))
  assert.deepEqual(s.packs, [{ id: 4, ref: 'sobre_barrio', name: 'sobre_barrio' }])
  apply(s, ev('agent.me', { cash: 400 }))
  assert.strictEqual(s.owned['LAT-09']?.length, 2)
  apply(s, ev('agent.me', { cash: 400, assets: [] }))
  assert.deepEqual([s.owned, s.values, s.packs], [{}, {}, []])
})

test('the board: asks and bids by venue, cancelled and expired ones leave', () => {
  const s = fresh()
  apply(s, ev('clock', {}, 10))
  apply(s, listed(23, 't07', { ask: card(100, 'LAT-03', 5), price: 11 }))
  apply(s, listed(24, 't14', { bid: 'MAL-06', price: 18 }))
  apply(s, listed(25, 't09', { venue: 't07-puesto', ask: card(101, 'SAL-02'), price: 9, expires: 12 }))
  assert.deepEqual(bookIds(s), { rastro: [23, 24], 't07-puesto': [25] })
  const [ask, bid] = [s.book.get('rastro')!.get(23)!, s.book.get('rastro')!.get(24)!]
  assert.deepEqual([ask.side, ask.ref, ask.kind, ask.price, ask.assetIds, ask.serial, ask.maker, ask.createdTick, ask.expiresTick],
    ['ask', 'LAT-03', 'card', 11, [100], 5, 't07', 10, 30])
  assert.deepEqual([bid.side, bid.ref, bid.kind, bid.price, bid.assetIds], ['bid', 'MAL-06', 'card', 18, []])
  apply(s, ev('offer.cancelled', { offer: 24, venue: 'rastro' }))
  assert.deepEqual(bookIds(s), { rastro: [23], 't07-puesto': [25] })
  apply(s, ev('clock', {}, 12))
  assert.deepEqual(bookIds(s), { rastro: [23], 't07-puesto': [25] }, 'an offer expiring this tick is still open')
  apply(s, ev('clock', {}, 13))
  assert.deepEqual(bookIds(s), { rastro: [23] })
  apply(s, listed(26, 't07', { ask: card(102, 'LAT-04'), tick: 2, expires: 9 }))
  assert.deepEqual(bookIds(s), { rastro: [23] }, 'a replayed listing that already expired is not on the board')
})

test('a settlement takes the filled ask and the buyer bid off the board', () => {
  const s = fresh()
  apply(s, listed(23, 't07', { ask: card(100, 'LAT-03'), price: 11 }))
  apply(s, listed(24, 't07', { venue: 't12-mercadillo', ask: card(100, 'LAT-03'), price: 14 }))
  apply(s, listed(30, 't14', { bid: 'MAL-06', price: 18 }))
  apply(s, listed(31, 't14', { bid: 'MAL-06', price: 15 }))
  apply(s, listed(32, 't02', { bid: 'MAL-06', price: 20 }))
  apply(s, ev('settlement', { settlement: 1, parties: ['t07', 't05'], venue: 'rastro', price: 11, items: [{ id: 100, ref: 'LAT-03', frm: 't07', to: 't05' }] }))
  apply(s, ev('settlement', { settlement: 2, parties: ['t14', 't03'], venue: 'rastro', price: 15, items: [{ id: 200, ref: 'MAL-06', frm: 't03', to: 't14' }] }))
  assert.deepEqual(bookIds(s), { rastro: [30, 32] })
  apply(s, ev('settlement', { settlement: 3, parties: ['t14', 't03'], venue: 'rastro', price: 16, items: [{ id: 201, ref: 'MAL-06', frm: 't03', to: 't14' }] }))
  assert.deepEqual(bookIds(s), { rastro: [32] })
})

test('the board is bounded, the oldest offers go first', () => {
  const s = fresh()
  for (let i = 1; i <= LIMITS.book + 25; i++) apply(s, listed(i, 't07', { ask: card(1000 + i, 'LAT-01') }))
  const ids = [...s.book.get('rastro')!.keys()]
  assert.strictEqual(ids.length, LIMITS.book)
  assert.strictEqual(Math.min(...ids), 26)
})

test('venues: seen on the board, opened with an owner, the last announcement, closing empties its board', () => {
  const s = fresh()
  apply(s, listed(23, 't07', { ask: card(100, 'LAT-03') }))
  assert.deepEqual([s.venues.get('rastro')!.owner, s.venues.get('rastro')!.status], [null, 'open'])
  apply(s, ev('venue.opened', { venue: 'v-t05', name: 'El Puesto', owner: 't05', fee_bps: 200, fee_per_card: 1, rules: { mechanism: 'board' }, bond: 50 }, 20))
  apply(s, ev('venue.announcement', { venue: 'v-t05', name: 'El Puesto', text: 'Fees down today' }, 21, 'v-t05'))
  apply(s, ev('venue.announcement', { venue: 'v-t05', name: 'El Puesto', text: 'Rares wanted' }, 22, 'v-t05'))
  apply(s, ev('venue.fee_announced', { venue: 'v-t05', fee_bps: 100, fee_per_card: 0, effective_tick: 30 }, 22))
  const v = s.venues.get('v-t05')!
  assert.deepEqual([v.name, v.owner, v.openedTick, v.feeBps, v.feePerCard, v.announcement?.text, v.announcement?.tick, v.announcements],
    ['El Puesto', 't05', 20, 200, 1, 'Rares wanted', 22, 2])
  apply(s, ev('venue.fee_changed', { venue: 'v-t05', fee_bps: 100, fee_per_card: 0 }, 30))
  assert.deepEqual([v.feeBps, v.feePerCard], [100, 0])
  apply(s, listed(24, 't09', { venue: 'v-t05', ask: card(101, 'SAL-02') }))
  apply(s, ev('venue.closing', { venue: 'v-t05', bond_back_tick: 40 }, 31))
  assert.deepEqual([v.status, bookIds(s)], ['closing', { rastro: [23] }])
  apply(s, ev('venue.closed', { venue: 'v-t05', bond_returned: 50 }, 40))
  assert.strictEqual(v.status, 'closed')
})

test('packs opened, gifts, failed settlements and opened threads are kept, bounded', () => {
  const s = fresh()
  apply(s, listed(23, 't01', { ask: card(100, 'LAT-03') }))
  apply(s, ev('pack.opened', { team: 't07', name: 'Team 7', pack: 'sobre_barrio', best: 'LAT-09' }))
  apply(s, ev('gift.given', { team: 't01', name: 'Team 1', cash: 0, packs: [], cards: ['MAL-03'], reason: 'gift from Abuela Carmen' }, 10, 'abuela'))
  apply(s, ev('settlement.failed', { offer: 23, reason: 'seller no longer holds the asset' }))
  apply(s, ev('thread.opened', { thread: 70, kind: 'persona', team: 't01', with: 'abuela', topic: { buy: { pack: 'sobre_barrio' } } }))
  assert.deepEqual(s.packsOpened.map((p) => [p.team, p.pack, p.best]), [['t07', 'sobre_barrio', 'LAT-09']])
  assert.deepEqual(s.gifts.map((g) => [g.team, g.from, g.cards, g.reason]), [['t01', 'abuela', ['MAL-03'], 'gift from Abuela Carmen']])
  assert.deepEqual(s.failed.map((f) => [f.offer, f.venue, f.ref, f.ours]), [[23, 'rastro', 'LAT-03', true]])
  assert.strictEqual(s.book.size, 0, 'a failed offer leaves the board')
  assert.deepEqual(s.opened.map((o) => [o.thread, o.with, o.topic]), [[70, 'abuela', { buy: { pack: 'sobre_barrio' } }]])
  for (let i = 0; i < LIMITS.packsOpened + 5; i++) apply(s, ev('pack.opened', { team: 't02', pack: 'sobre_barrio', best: null }))
  assert.strictEqual(s.packsOpened.length, LIMITS.packsOpened)
})

test('isOurs on the board: our listings and their cancels, our packs, gifts, threads, failures and venue', () => {
  const s = fresh()
  apply(s, listed(23, 't01', { ask: card(100, 'LAT-03') }))
  apply(s, listed(24, 't07', { ask: card(101, 'LAT-04') }))
  apply(s, message('t01', offer({ id: 335, maker: 't01', to: 'abuela', giveCash: 18, wantTypes: ['pack:sobre_barrio'] })))
  apply(s, ev('venue.opened', { venue: 'v-t01', owner: 't01', name: 'Our stall' }))
  const yes = [
    listed(25, 't01', { bid: 'MAL-06' }), ev('offer.cancelled', { offer: 23, venue: 'rastro' }),
    ev('settlement.failed', { offer: 335, reason: 'x' }), ev('pack.opened', { team: 't01', pack: 'sobre_barrio' }),
    ev('gift.given', { team: 't01', cards: [] }, 10, 'abuela'), ev('thread.opened', { thread: 80, team: 't01', with: 'abuela' }),
    ev('thread.opened', { thread: 81, team: 't05', with: 't01' }), ev('venue.announcement', { venue: 'v-t01', text: 'hi' }, 10, 'v-t01'),
  ]
  const no = [
    listed(26, 't07', { bid: 'MAL-06' }), ev('offer.cancelled', { offer: 24, venue: 'rastro' }), ev('offer.cancelled', { offer: 999 }),
    ev('settlement.failed', { offer: 24, reason: 'x' }), ev('pack.opened', { team: 't07', pack: 'sobre_barrio' }),
    ev('gift.given', { team: 't06', cards: [] }, 10, 'abuela'), ev('thread.opened', { thread: 82, team: 't05', with: 'abuela' }),
    ev('venue.opened', { venue: 'v-t05', owner: 't05' }),
  ]
  assert.deepEqual(yes.map((e) => isOurs(s, e)), yes.map(() => true))
  assert.deepEqual(no.map((e) => isOurs(s, e)), no.map(() => false))
  const nobody = createState()
  assert.strictEqual(isOurs(nobody, ev('pack.opened', { pack: 'sobre_barrio' })), false, 'no team yet: an empty actor is not ours')
})

test('a Market Test session: announced once, its venues kept, closed by bench.finished', () => {
  const s = createState()
  const start = { name: 'The Market Test: every venue gets the same synthetic book', ticks: 16, venues: ['v01', 'v19', 7], session: 6, start_tick: 1401 }
  apply(s, ev('bench.started', start, 1401))
  apply(s, ev('bench.started', start, 1401))
  assert.lengthOf(s.bench, 1)
  assert.deepInclude(s.bench[0], { session: 6, startTick: 1401, ticks: 16, venues: ['v01', 'v19'], finishedTick: null })
  apply(s, ev('bench.finished', { session: 6 }, 1417))
  assert.strictEqual(s.bench[0]?.finishedTick, 1417)
  assert.isTrue(KNOWN_TYPES.has('bench.started') && KNOWN_TYPES.has('bench.finished'))
})

test("venues.ours: our database's venues are ours however long before the feed window they opened; before hello they wait", () => {
  const s = createState()
  apply(s, { ...ev('venues.ours', { venues: [
    { venue: 'v19', name: 'Team 1 market', mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open', openedTick: 262 },
    { venue: 'v30', name: 'Old stall', status: 'suspended', openedTick: 40 },
    { venue: 'v31', status: 'nonsense' },
  ] }), scope: 'team' })
  assert.equal(s.venues.size, 0, 'no team yet: nothing to mark them with')
  assert.equal(s.events.length, 0, 'a status, never an event of the lists')
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  const v19 = s.venues.get('v19')
  assert.deepEqual([v19?.owner, v19?.name, v19?.status, v19?.feeBps, v19?.openedTick], ['t01', 'Team 1 market', 'open', 0, 262])
  assert.deepEqual([s.venues.get('v30')?.owner, s.venues.get('v30')?.status], ['t01', 'closed'], 'suspended reads closed')
  assert.equal(s.venues.has('v31'), false, 'an unknown status is left out')
  assert.equal(s.pendingVenues, null)
  assert.equal(isOurs(s, ev('venue.announcement', { venue: 'v19', text: '0 % fee' })), true, 'its later events are ours')
})
