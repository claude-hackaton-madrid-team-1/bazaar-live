/**
 * The Negotiations screen by dealer: Pilar with a deal we bought and a sale still live, Chato with a buy that closed
 * without a deal, Abuela with one live buy. What each dealer's summary says, and which thread a dealer's view reads.
 */
import { assert, test } from 'vitest'
import { GAME_STRINGS } from '../strings.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { negRows } from './negotiations.ts'
import { dealerGroups, dealerOf, selectedIn } from './negotiations-dealers.ts'

let nextId = 1
const ev = (type: string, payload: Payload = {}, tick = 10): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor: '', payload })

const offer = (thread: number, maker: string, to: string, give: Payload, want: Payload, tick: number, final = false) => ({
  id: nextId, maker, to, venue: null, thread, status: 'open',
  give: { cash: 0, assets: [], types: [], ...give }, want: { cash: 0, assets: [], types: [], ...want },
  created_tick: tick, expires_tick: tick + 30, final,
})

const say = (thread: number, who: string, sender: string, off: Payload, tick: number, tactic?: string) =>
  ev('thread.message', { thread, kind: 'persona', team: 't01', with: who, sender, text: null, offer: off, ...(tactic ? { tactic } : {}) }, tick)

/** Buying LAT-08: their ask, our bid. */
const theirAsk = (thread: number, who: string, price: number, tick: number, final = false) =>
  say(thread, who, who, offer(thread, who, 't01', { types: ['card:LAT-08'] }, { cash: price }, tick, final), tick)
const ourBid = (thread: number, who: string, price: number, tick: number, tactic?: string) =>
  say(thread, who, 't01', offer(thread, 't01', who, { cash: price }, { types: ['card:LAT-08'] }, tick), tick, tactic)

/** Selling SAL-01: our ask, their bid. */
const ourAsk = (thread: number, who: string, price: number, tick: number) =>
  say(thread, who, 't01', offer(thread, 't01', who, { assets: [{ id: 41, ref: 'SAL-01' }] }, { cash: price }, tick), tick)
const theirBid = (thread: number, who: string, price: number, tick: number) =>
  say(thread, who, who, offer(thread, who, 't01', { cash: price }, { types: ['card:SAL-01'] }, tick), tick)

const scored = (thread: number, who: string, price: number, value: number, tick: number) => ev('agent.outcome', {
  target: 'dealer', subject: `thread:${thread}`, decision: null, agent: 'taker', item: 'LAT-08', counterparty: who, side: 'buy',
  price, value, label: 'good', score: 1, surplus: value - price, jev: null, jevRight: null,
}, tick)

const game = (): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', { day: 'sat' }, 30))
  // Pilar: came down 40 → 34 → 30 (final) and we took it at 30 against our 45: +15
  for (const e of [theirAsk(10, 'pilar', 40, 10), ourBid(10, 'pilar', 20, 10, 'calibrated_question'), theirAsk(10, 'pilar', 34, 12), ourBid(10, 'pilar', 25, 12), theirAsk(10, 'pilar', 30, 14, true), scored(10, 'pilar', 30, 45, 15)]) apply(s, e)
  // Pilar: a sale still live, her bid up 10 → 14
  for (const e of [ourAsk(11, 'pilar', 30, 20), theirBid(11, 'pilar', 10, 20), ourAsk(11, 'pilar', 25, 22), theirBid(11, 'pilar', 14, 22)]) apply(s, e)
  // Chato: one ask of 50 and nothing more; it closed
  for (const e of [theirAsk(12, 'chato', 50, 5), ourBid(12, 'chato', 20, 5), ev('thread.closed', { thread: 12 }, 8)]) apply(s, e)
  // Abuela: one live buy
  for (const e of [theirAsk(13, 'abuela', 12, 25)]) apply(s, e)
  return s
}

test('one group per dealer, most threads first then by name, each with its live and its ended threads', () => {
  const s = game()
  const groups = dealerGroups(s)
  assert.deepEqual(groups.map((g) => [g.with, g.live.map((r) => r.id), g.ended.map((r) => r.id)]), [
    ['pilar', [11], [10]],
    ['abuela', [13], []],
    ['chato', [], [12]],
  ])
})

test("a dealer's summary: deals, our edge on them, how they move, their finals, the last offer and what closed", () => {
  const s = game()
  const [pilar, abuela, chato] = dealerGroups(s)
  // buy: 40 → 30 over two rounds is 5 a round towards us; sell: 10 → 14 in one is 4; on average 4.5
  assert.deepInclude(pilar!, { threads: 2, deals: 1, edge: 15, step: 4.5, lastTick: 22 })
  assert.deepEqual(pilar!.finals, { n: 1, of: 1 })
  assert.deepEqual(pilar!.tactics, [{ tactic: 'calibrated_question', threads: 1, deals: 1 }])
  // one price says nothing about how they move; no deal, no edge
  assert.deepInclude(chato!, { threads: 1, deals: 0, edge: null, step: null, lastTick: 5 })
  assert.deepEqual(chato!.finals, { n: 0, of: 1 })
  assert.deepEqual(abuela!.finals, { n: 0, of: 0 })
  assert.equal(GAME_STRINGS.es.neg.moves(pilar!.step!), 'cede ~4.5 P por ronda')
  assert.equal(GAME_STRINGS.en.neg.moves(0), 'does not move')
  assert.equal(GAME_STRINGS.es.neg.finals(1, 1), 'cierra con oferta final en 1 de 1')
})

test('?dealer= names a dealer with threads, or every dealer', () => {
  const groups = dealerGroups(game())
  assert.equal(dealerOf(groups, 'chato')?.with, 'chato')
  assert.isNull(dealerOf(groups, 'picaros'))
  assert.isNull(dealerOf(groups, null))
})

test("a dealer's view reads the requested thread when it is theirs, else their first one", () => {
  const s = game()
  const pilar = dealerOf(dealerGroups(s), 'pilar')!
  const rows = [...pilar.live, ...pilar.ended]
  assert.equal(selectedIn(rows, '10'), 10)
  assert.equal(selectedIn(rows, '12'), 11)
  assert.equal(selectedIn(rows, null), 11)
  assert.equal(selectedIn(negRows(s), '12'), 12)
  assert.isNull(selectedIn([], '12'))
})
