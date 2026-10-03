import { assert, test } from 'vitest'
import type { AgentName, DecisionPayload } from '../../../shared/decisions.ts'
import { setOfName, refOfName } from '../cards.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { duelHealth, duelRecord, finishedDuels, liveDuelCount, liveDuels, roundsOf, stateOf } from './duels.ts'

let nextId = 1
// Duel events only reach us from the relay's duel read, which sends them as `team`.
const ev = (type: string, payload: Payload = {}, tick = 10): GameEvent => ({
  id: nextId++, tick, t: 0.1, type, scope: type.startsWith('duel.') || type.startsWith('agent.') || type === 'clock' ? 'team' : 'public', actor: '', payload,
})

/** A decision row as the server builds it from db/agent_decisions.sql: everything unknown is null. */
const decision = (id: number, agent: AgentName, kind: string, fields: Partial<DecisionPayload>): DecisionPayload => ({
  decision: id, agent, kind, item: null, counterparty: null, price: null, value: null, status: 'approved', verdict: 'allowed', rule: null,
  text: null, jev: null, jevValue: null, method: null, error: null, outcome: null, surplus: null, jevRight: null, ...fields,
})

const fresh = (tick = 10): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', { day: 'sat' }, tick))
  return s
}

const start = (s: State, duel: number, role: string, limit: number | null, deadline: number, extra: Payload = {}) =>
  apply(s, ev('duel.started', { duel, session: 2, role, rival: 'Rival Azul', item: 'Palacio de Cristal', deadline_tick: deadline, limit, decay: 0.06, ...extra }, 1))

const say = (s: State, duel: number, ours: boolean, price: number, tick: number) =>
  apply(s, ev('duel.message', { duel, role: 'buyer', rival: 'Rival Azul', sender: ours ? 't01' : 'Rival Azul', price, days: null }, tick))

test('the card at stake is found by name in the catalog, with its set', () => {
  assert.strictEqual(refOfName('Palacio de Cristal'), 'RET-11')
  assert.strictEqual(refOfName(' la heroína del dos de mayo '), 'MAL-09')
  assert.strictEqual(setOfName('Café en Goya')?.name, 'Salamanca')
  assert.strictEqual(refOfName('No such card'), null)
  assert.strictEqual(setOfName(null), null)
})

test('a live duel inside our limit: strictly inside, the margin, the rounds and what their decay costs', () => {
  const s = fresh(545)
  start(s, 2481, 'buyer', 100, 557)
  say(s, 2481, false, 124, 541)
  say(s, 2481, true, 43, 542)
  say(s, 2481, false, 115, 542)
  say(s, 2481, true, 46, 543)
  say(s, 2481, false, 109, 543)
  say(s, 2481, true, 50, 544)
  say(s, 2481, false, 94, 545)
  const [d] = liveDuels(s)
  assert.ok(d)
  assert.deepEqual([d.side, d.theirPrice, d.ourPrice, d.gap, d.limit, d.inside, d.margin, d.rounds], ['buy', 94, 50, 44, 100, true, 6, 3])
  // 1 − 0.94³ = 0.169: three rounds cost 17 % of the 6 P a deal now would make
  assert.deepEqual([d.decayShare, d.decayCost, d.keepNow], [0.17, 1, 5])
  assert.deepEqual([d.ticksLeft, d.acceptBy, d.state], [12, 555, 'inside'])
  assert.deepEqual([d.set?.name, d.item], ['El Retiro', 'Palacio de Cristal'])
})

test('their price ON our limit is not inside it (duel_inside_limit is strict)', () => {
  const s = fresh(545)
  start(s, 1, 'buyer', 100, 557)
  say(s, 1, false, 104, 544)
  say(s, 1, false, 100, 545)
  const [d] = liveDuels(s)
  assert.deepEqual([d?.inside, d?.margin, d?.acceptBy], [false, 0, null])
})

test('outside our limit: haggling while their pace crosses it in time, outside when it cannot, expiring near the deadline', () => {
  const s = fresh(100)
  start(s, 1, 'seller', 120, 130)
  apply(s, ev('duel.message', { duel: 1, role: 'seller', sender: 'Rival Azul', price: 100 }, 98))
  apply(s, ev('duel.message', { duel: 1, role: 'seller', sender: 'Rival Azul', price: 105 }, 99))
  apply(s, ev('duel.message', { duel: 1, role: 'seller', sender: 'Rival Azul', price: 110 }, 100))
  let [d] = liveDuels(s)
  // 10 P below our cost, coming up 5 P a round: strictly inside (≥ 121) in 3 rounds, with 30 ticks left
  assert.deepEqual([d?.margin, d?.theirStep, d?.roundsToLimit, d?.state], [-10, 5, 3, 'haggling'])
  assert.strictEqual(stateOf({ inside: false, ticksLeft: 2, theirPrice: 110, roundsToLimit: 3 }), 'expiring')
  assert.strictEqual(stateOf({ inside: false, ticksLeft: 10, theirPrice: 110, roundsToLimit: 30 }), 'outside')
  assert.strictEqual(stateOf({ inside: false, ticksLeft: 10, theirPrice: 110, roundsToLimit: null }), 'outside')
  assert.strictEqual(stateOf({ inside: null, ticksLeft: 10, theirPrice: null, roundsToLimit: null }), 'haggling')
  apply(s, ev('duel.message', { duel: 1, role: 'seller', sender: 'Rival Azul', price: 110 }, 101))
  apply(s, ev('duel.message', { duel: 1, role: 'seller', sender: 'Rival Azul', price: 110 }, 102))
  ;[d] = liveDuels(s)
  assert.deepEqual([d?.theirStep, d?.roundsToLimit, d?.state], [0, null, 'outside'])
})

test('the duels agent\'s last call on a duel: the offer with the price we sent at that tick, or the rule that blocked it', () => {
  const s = fresh(545)
  start(s, 5, 'buyer', 100, 557)
  say(s, 5, false, 110, 543)
  say(s, 5, true, 50, 544)
  apply(s, ev('agent.decision', decision(1, 'duels', 'duel_offer', { item: 'duel:5', status: 'done' }), 544))
  apply(s, ev('agent.decision', decision(2, 'duels', 'duel_hold', { item: null, status: 'approved' }), 545))
  apply(s, ev('agent.decision', decision(3, 'duels', 'duel_offer', { item: 'duel:6', status: 'done' }), 545))
  let [d] = liveDuels(s)
  assert.deepEqual(d?.decision, { action: 'offer', kind: 'duel_offer', price: 50, status: 'done', rule: null, error: null, tick: 544 })
  apply(s, ev('agent.decision', decision(4, 'duels', 'duel_offer', { item: 'duel:5', status: 'rejected', verdict: 'denied', rule: 'duel_inside_limit' }), 546))
  ;[d] = liveDuels(s)
  assert.deepEqual([d?.decision?.status, d?.decision?.rule, d?.decision?.price], ['rejected', 'duel_inside_limit', null])
})

test('rounds are the fewer priced messages of the two sides while live, the game\'s count once over', () => {
  const s = fresh()
  start(s, 1, 'buyer', 60, 20)
  say(s, 1, false, 80, 5)
  say(s, 1, false, 75, 6)
  say(s, 1, true, 40, 6)
  assert.strictEqual(roundsOf(s.duels[1]!), 1)
  apply(s, ev('duel.result', { duel: 1, rival: 'Rival Azul', deal: true, price: 55, points: null, gain: 4.4, rounds: 2, limit: 60 }, 8))
  assert.strictEqual(roundsOf(s.duels[1]!), 2)
})

test('finished duels, most recent first: deal at X vs our limit, the edge, what it kept, rounds', () => {
  const s = fresh(30)
  start(s, 1, 'buyer', 60, 20)
  apply(s, ev('duel.result', { duel: 1, rival: 'Rival Azul', deal: true, price: 47, points: null, gain: 11.5, rounds: 2, limit: 60 }, 12))
  start(s, 2, 'seller', 52, 20, { rival: 'Rival Oro' })
  apply(s, ev('duel.result', { duel: 2, rival: 'Rival Oro', deal: false, price: null, points: null, gain: 0, rounds: 1, limit: 52 }, 20))
  start(s, 3, 'seller', 85, 40)
  const done = finishedDuels(s)
  assert.deepEqual(done.map((d) => [d.id, d.deal, d.price, d.limit, d.edge, d.gain, d.rounds, d.tick]), [
    [2, false, null, 52, null, 0, 1, 20],
    [1, true, 47, 60, 13, 11.5, 2, 12],
  ])
  assert.strictEqual(liveDuelCount(s), 1)
})

test('the record: per rival (live first), per session (newest first), in all, and the game\'s duel points', () => {
  const s = fresh(30)
  apply(s, ev('agent.me', { cash: 100, score: { score: 25.6, duel_points: 8.35 } }))
  const end = (duel: number, rival: string, session: number, deal: boolean, gain: number) => {
    apply(s, ev('duel.started', { duel, session, role: 'buyer', rival, deadline_tick: 20, limit: 60 }, 1))
    apply(s, ev('duel.result', { duel, rival, deal, price: deal ? 50 : null, points: null, gain, rounds: 1, limit: 60 }, 12))
  }
  end(1, 'Rival Oro', 1, true, 9.4)
  end(2, 'Rival Oro', 1, false, 0)
  end(3, 'Rival Noche', 2, true, 7.6)
  apply(s, ev('duel.started', { duel: 4, session: 2, role: 'seller', rival: 'Rival Sol', deadline_tick: 40, limit: 90 }, 25))
  const rec = duelRecord(s)
  assert.strictEqual(rec.scorePoints, 8.35)
  assert.deepEqual(rec.total, { duels: 4, live: 1, deals: 2, noDeals: 1, gain: 17, points: null })
  assert.deepEqual(rec.rivals.map((r) => [r.rival, r.duels, r.live, r.deals, r.noDeals, r.gain]), [
    ['Rival Sol', 1, 1, 0, 0, null], ['Rival Oro', 2, 0, 1, 1, 9.4], ['Rival Noche', 1, 0, 1, 0, 7.6],
  ])
  assert.deepEqual(rec.sessions.map((r) => [r.session, r.duels, r.deals]), [[2, 2, 1], [1, 2, 1]])
  assert.strictEqual(duelRecord(fresh()).scorePoints, null)
})

test('the duels agent\'s health: silent since its last decision, and the rule that blocked it most', () => {
  const s = fresh(4)
  apply(s, ev('agent.decision', decision(1, 'duels', 'duel_offer', { item: 'duel:7', status: 'rejected', verdict: 'denied', rule: 'duel_inside_limit' }), 4))
  apply(s, ev('agent.decision', decision(2, 'taker', 'accept_ask', { item: 'LAV-01', status: 'done' }), 12))
  apply(s, ev('clock', { day: 'sat' }, 12))
  let h = duelHealth(s)
  assert.deepEqual([h.status?.state, h.lastTick, h.status?.silentFor, h.status?.topBlock], ['quiet', 4, 8, { rule: 'duel_inside_limit', count: 1 }])
  apply(s, ev('clock', { day: 'sat' }, 20))
  h = duelHealth(s)
  assert.deepEqual([h.status?.state, h.status?.silentFor], ['silent', 16])
})
