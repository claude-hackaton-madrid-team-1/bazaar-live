import { assert, test } from 'vitest'
import type { AgentName, DecisionPayload } from '../../../shared/decisions.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { chatDuels, duelChat, insideLimit, type ChatLine } from './duelChat.ts'

let nextId = 1
const ev = (type: string, payload: Payload = {}, tick = 10): GameEvent => ({
  id: nextId++, tick, t: 0.1, type, scope: type.startsWith('duel.') || type.startsWith('agent.') || type === 'clock' ? 'team' : 'public', actor: '', payload,
})

const decision = (id: number, agent: AgentName, kind: string, fields: Partial<DecisionPayload>): DecisionPayload => ({
  decision: id, agent, kind, item: null, counterparty: null, price: null, value: null, status: 'approved', verdict: 'allowed', rule: null,
  text: null, jev: null, jevValue: null, method: null, error: null, outcome: null, surplus: null, jevRight: null, ...fields,
})

const fresh = (): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', { day: 'sat' }, 1240))
  return s
}

const start = (s: State, duel: number, role: 'buyer' | 'seller', limit: number, deadline: number) =>
  apply(s, ev('duel.started', { duel, session: 3, role, rival: 'Rival Azul', item: 'Fiesta de San Cayetano', deadline_tick: deadline, limit, decay: 0.08 }, 1240))

const say = (s: State, duel: number, ours: boolean, price: number, days: number | null, tick: number) =>
  apply(s, ev('duel.message', { duel, role: 'seller', rival: 'Rival Azul', sender: ours ? 't01' : 'Rival Azul', price, days }, tick))

const kinds = (lines: ChatLine[]) => lines.map((l) => l.kind)

test('insideLimit: under our value when we buy, over our cost when we sell; unknown without both numbers', () => {
  assert.equal(insideLimit('buy', 90, 100), true)
  assert.equal(insideLimit('buy', 100, 100), false, 'strictly inside')
  assert.equal(insideLimit('sell', 140, 133), true)
  assert.equal(insideLimit('sell', 120, 133), false)
  assert.equal(insideLimit('sell', null, 133), null)
})

test('a duel reads as a conversation: the start, each offer with price and day, the rounds and their decay, the end', () => {
  const s = fresh()
  start(s, 5740, 'seller', 133, 1266)
  say(s, 5740, true, 220, 0, 1245)
  say(s, 5740, false, 120, 4, 1246)
  say(s, 5740, true, 190, 0, 1247)
  say(s, 5740, false, 140, 3, 1248)
  apply(s, ev('duel.result', { duel: 5740, rival: 'Rival Azul', deal: true, price: 140, gain: 6.4, rounds: 2, limit: 133 }, 1249))
  const d = s.duels[5740]
  assert.ok(d)
  const lines = duelChat(d, s.agents.decisions.duels, { limits: true })
  assert.deepEqual(kinds(lines), ['start', 'msg', 'msg', 'msg', 'msg', 'end'])
  const [st, a, b, c, e, end] = lines
  assert.equal(st?.kind === 'start' && st.side, 'sell')
  assert.equal(st?.kind === 'start' && st.limit, 133)
  assert.ok(a?.kind === 'msg' && a.from === 'us' && a.price === 220 && a.days === 0 && a.round === null, 'our anchor adds no round on its own')
  assert.ok(b?.kind === 'msg' && b.from === 'them' && b.inside === false, '120 is under our cost 133: outside')
  assert.deepEqual(b?.kind === 'msg' && b.round, { n: 1, taken: 0.08 }, 'their answer makes round 1: 8 % of the value gone')
  assert.ok(c?.kind === 'msg' && c.round === null)
  assert.ok(e?.kind === 'msg' && e.inside === true && e.days === 3)
  assert.deepEqual(e?.kind === 'msg' && e.round, { n: 2, taken: 0.15 })
  assert.ok(end?.kind === 'end' && end.deal && end.price === 140 && end.gain === 6.4 && end.rounds === 2)
})

test('without the view token our limit stays hidden: no limit, no inside/outside, no gain', () => {
  const s = fresh()
  start(s, 7, 'buyer', 100, 1266)
  say(s, 7, false, 90, 0, 1245)
  apply(s, ev('duel.result', { duel: 7, rival: 'Rival Azul', deal: true, price: 90, gain: 10, rounds: 0, limit: 100 }, 1246))
  const d = s.duels[7]
  assert.ok(d)
  const lines = duelChat(d, s.agents.decisions.duels, { limits: false })
  assert.equal(lines[0]?.kind === 'start' && lines[0].limit, null)
  assert.equal(lines[1]?.kind === 'msg' && lines[1].inside, null)
  assert.equal(lines.at(-1)?.kind === 'end' && (lines.at(-1) as Extract<ChatLine, { kind: 'end' }>).gain, null)
})

test("our offer carries Jev's verdict; holds in a row collapse into one wait; an accept and a refusal are lines of their own", () => {
  const s = fresh()
  start(s, 9, 'seller', 133, 1266)
  say(s, 9, true, 220, 0, 1245)
  apply(s, ev('agent.decision', decision(1, 'duels', 'duel_offer', { item: 'duel:9', status: 'done', jev: 'counter' }), 1245))
  say(s, 9, false, 150, 2, 1246)
  apply(s, ev('agent.decision', decision(2, 'duels', 'duel_hold', { item: 'duel:9', status: 'approved', jev: 'undecided' }), 1246))
  apply(s, ev('agent.decision', decision(3, 'duels', 'duel_hold', { item: 'duel:9', status: 'approved' }), 1247))
  apply(s, ev('agent.decision', decision(4, 'duels', 'duel_hold', { item: 'duel:9', status: 'approved' }), 1248))
  apply(s, ev('agent.decision', decision(5, 'duels', 'duel_accept', { item: 'duel:9', status: 'failed', error: 'duel_closed' }), 1249))
  apply(s, ev('agent.decision', decision(6, 'duels', 'duel_accept', { item: 'duel:9', status: 'done', jev: null }), 1250))
  apply(s, ev('agent.decision', decision(7, 'duels', 'duel_hold', { item: 'duel:10', status: 'approved' }), 1250))
  const d = s.duels[9]
  assert.ok(d)
  const lines = duelChat(d, s.agents.decisions.duels, { limits: true })
  assert.deepEqual(kinds(lines), ['start', 'msg', 'msg', 'wait', 'refused', 'accept'])
  assert.equal(lines[1]?.kind === 'msg' && lines[1].jev, 'counter')
  const wait = lines[3]
  assert.ok(wait?.kind === 'wait' && wait.ticks === 3 && wait.fromTick === 1246 && wait.toTick === 1248, 'three holds, one line; another duel\'s hold is not ours')
  assert.ok(lines[4]?.kind === 'refused' && lines[4].action === 'accept' && lines[4].error === 'duel_closed')
  assert.ok(lines[5]?.kind === 'accept' && lines[5].done)
})

test('chatDuels: the live duels first, the latest move first, then the finished ones, newest first', () => {
  const s = fresh()
  start(s, 1, 'buyer', 100, 1266)
  start(s, 2, 'buyer', 100, 1266)
  start(s, 3, 'buyer', 100, 1266)
  say(s, 1, false, 90, 0, 1245)
  say(s, 2, false, 90, 0, 1250)
  apply(s, ev('duel.result', { duel: 3, rival: 'Rival Azul', deal: false, price: null, gain: null, rounds: 1, limit: 100 }, 1251))
  assert.deepEqual(chatDuels(s.duels).map((d) => d.id), [2, 1, 3])
})
