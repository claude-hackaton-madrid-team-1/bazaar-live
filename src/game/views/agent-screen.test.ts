/**
 * The Agent screen against the real game's shape (tick 417, Sat 3 Oct): the header, the counters, the ids, the
 * deals tile and the noise, each read from the agents' decisions and outcomes when the feed's window holds none.
 */
import { assert, test } from 'vitest'
import type { AgentName, DecisionPayload, OutcomePayload } from '../../../shared/decisions.ts'
import { GAME_STRINGS } from '../strings.ts'
import { apply, createState, type GameEvent, type State } from '../state.ts'
import { eventLabel, now, timeline } from './agent.ts'
import { deals, isWrite } from './decisions.ts'

let nextId = -(2 ** 50)
const ev = (type: string, payload: object, tick: number | undefined = 10): GameEvent => ({ id: nextId--, tick, t: 0.1, type, scope: 'team', actor: '', payload: { ...payload } })

const decision = (id: number, agent: AgentName, tick: number, fields: Partial<DecisionPayload> = {}) =>
  ev('agent.decision', {
    decision: id, agent, kind: 'accept_ask', item: 'SAL-08', counterparty: 'm00fc33ec', price: 31, value: 55.2, status: 'rejected', verdict: 'denied',
    rule: 'max_price_uncommon', text: 'price 31 > max_price_uncommon 26', jev: null, jevValue: null, method: null, error: null, outcome: null, surplus: null,
    jevRight: null, ...fields,
  }, tick)

const outcome = (subject: string, tick: number, fields: Partial<OutcomePayload>) => ev('agent.outcome', {
  target: 'trade', subject, decision: null, agent: 'taker', item: 'MAL-06', counterparty: 't04', side: 'buy', price: 20, value: 27.5,
  label: 'ok', score: null, surplus: 5.5, jev: null, jevRight: null, ...fields,
}, tick)

const fresh = (tick: number) => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }, 0))
  apply(s, ev('clock', { day: 'sat', tick_seconds: 30 }, tick))
  return s
}

const feed = (s: State, events: GameEvent[]) => {
  for (const e of events) apply(s, e)
  return s
}

/** The SAL-08 thread with Abuela as the taker logged it: open, bid, accept, closed; one settlement. */
const abuelaDeal = () => [
  decision(743, 'taker', 376, { kind: 'dealer_open', counterparty: 'abuela', price: null, status: 'done', verdict: 'allowed', rule: null, text: null, method: 'open_thread' }),
  decision(744, 'taker', 376, { kind: 'dealer_opened', counterparty: 'abuela', price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
  decision(748, 'taker', 376, { kind: 'dealer_bid', counterparty: 'abuela', price: 10, value: null, status: 'done', verdict: 'allowed', rule: null, text: null, method: 'say' }),
  decision(752, 'taker', 378, { kind: 'dealer_accept', counterparty: 'abuela', price: 25, status: 'done', verdict: 'allowed', rule: null, text: null, method: 'accept' }),
  decision(753, 'taker', 379, { kind: 'dealer_closed', counterparty: 'abuela', price: 25, value: null, status: 'done', verdict: null, rule: null, text: null }),
]

test('bug 1: with no agent.thought or agent.action, "Now" shows the latest real decision and the latest executed one', () => {
  const s = feed(fresh(417), [
    ...abuelaDeal(),
    decision(760, 'maker', 416, { kind: 'post_ask', item: 'LAT-08', counterparty: null, price: 25, value: 12.5, status: 'done', verdict: 'allowed', rule: null, text: null, jev: 'aggressive' }),
    decision(770, 'taker', 417, { kind: 'process_started', item: null, counterparty: null, price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
  ])
  const n = now(s)
  assert.isNull(n.thought)
  assert.isNull(n.action)
  // the restart is not a decision; the maker's listing is the latest one
  assert.deepInclude(n.decision, { decision: 760, agent: 'maker', kind: 'post_ask', item: 'LAT-08', verdict: 'allowed', jev: 'aggressive' })
  // the latest decision whose request went out: the accept of Abuela's offer
  assert.deepInclude(n.executed, { decision: 752, method: 'accept', item: 'SAL-08', price: 25 })
})

test('bug 2: open threads, our trades and value gained come from the same outcomes as the deals tile', () => {
  const s = feed(fresh(417), [
    ...abuelaDeal(),
    decision(800, 'taker', 410, { kind: 'dealer_opened', item: 'SAL-07', counterparty: 'abuela', price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
    outcome('settlement:409', 321, {}),
    outcome('settlement:460', 376, { agent: 'maker', item: 'SAL-10', counterparty: 't06', side: 'sell', price: 76, value: 22.8, surplus: 53.2 }),
    outcome('thread:486', 320, { target: 'dealer', item: 'SAL-08', counterparty: 'abuela', price: null, value: null, surplus: null, label: 'bad' }),
    outcome('thread:574', 379, { target: 'dealer', item: 'SAL-08', counterparty: 'abuela', price: 25, value: null, surplus: null, label: 'bad' }),
    outcome('duel:85', 153, { target: 'duel', agent: 'duels', item: null, counterparty: null, side: null, price: null, value: null, surplus: null, label: 'good' }),
  ])
  const n = now(s)
  // three settled deals: two trades and the Abuela fill (the walked thread 486 and the duel are not trades)
  assert.equal(n.trades, 3)
  assert.closeTo(n.gain, 5.5 + 53.2 + (55.2 - 25), 1e-9)
  // the SAL-07 thread opened at 410 has no close yet; the SAL-08 one closed at 379
  assert.equal(n.openThreads, 1)
})

test('bug 3: a synthetic (negative) event id never shows as a number; a real one does', () => {
  assert.equal(eventLabel(21888), '#21888')
  assert.isNull(eventLabel(-(2 ** 50) - 345))
  assert.isNull(eventLabel(-29))
})

test('bug 4: a dealer thread that closed with no fill is not a deal, and a dealer fill is scored against our value', () => {
  const s = feed(fresh(417), [
    ...abuelaDeal(),
    outcome('thread:115', 69, { target: 'dealer', item: 'LAV-06', counterparty: 'abuela', price: 22, value: null, surplus: null, label: 'ok' }),
    outcome('thread:486', 320, { target: 'dealer', item: 'SAL-08', counterparty: 'abuela', price: null, value: null, surplus: null, label: 'bad' }),
    outcome('thread:574', 379, { target: 'dealer', item: 'SAL-08', counterparty: 'abuela', price: 25, value: null, surplus: null, label: 'bad' }),
  ])
  const d = deals(s)
  assert.deepEqual(d.map((x) => x.row.subject), ['thread:574', 'thread:115'])
  assert.deepInclude(d[0], { value: 55.2, verdict: 'beat' })
  assert.closeTo(d[0]?.edge ?? 0, 30.2, 1e-9)
  // no decision of ours names LAV-06's value: no score, and the tile says so
  assert.deepInclude(d[1], { value: null, edge: null, verdict: null })
  assert.equal(GAME_STRINGS.es.decide.noValue, 'sin valor')
})

test('bug 5: identical refusals in a row collapse into one row with ×N and the tick range; past ticks drop idle lines', () => {
  const s = feed(fresh(380), [
    decision(700, 'taker', 360, { price: 32 }),
    decision(701, 'taker', 361, { price: 34 }),
    decision(702, 'taker', 361, { kind: 'process_started', item: null, counterparty: null, price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
    decision(703, 'taker', 362, { price: 31 }),
    decision(704, 'taker', 363, { price: 31 }),
    decision(705, 'maker', 364, { kind: 'post_ask', item: 'LAT-08', price: 25, status: 'done', verdict: 'allowed', rule: null, text: null }),
  ])
  const cards = timeline(s)
  const rows = cards.flatMap((c) => c.decide.filter((d) => d.kind === 'row').map((d) => [c.tick, d.kind === 'row' ? d.row.decision : 0, d.kind === 'row' ? d.run : null]))
  assert.deepEqual(rows, [
    [364, 705, null],
    [363, 704, { count: 4, from: 360, to: 363, low: 31, high: 34 }],
    [361, 702, null],
  ])
  // only the current tick says who did not decide, in one compact line
  assert.deepEqual(cards.map((c) => [c.tick, c.decide.filter((d) => d.kind === 'idle').length]), [[380, 1], [364, 0], [363, 0], [361, 0]])
  const idle = cards[0]?.decide[0]
  assert.deepEqual(idle?.kind === 'idle' ? idle.agents : null, [{ agent: 'taker', last: 363 }, { agent: 'maker', last: 364 }, { agent: 'duels', last: null }])
  assert.equal(GAME_STRINGS.es.decide.run(4, 360, 363), '×4, turnos 360–363')
})

test('bug 6: a restart reads "reinicio (deploy)", and kinds that write nothing carry no guardrail badge', () => {
  assert.isFalse(isWrite('process_started'))
  assert.isFalse(isWrite('dealer_opened'))
  assert.isFalse(isWrite('dealer_closed'))
  assert.isTrue(isWrite('accept_ask'))
  assert.equal(GAME_STRINGS.es.decide.kind('process_started'), 'reinicio (deploy)')
  assert.equal(GAME_STRINGS.en.decide.kind('process_started'), 'restart (deploy)')
  assert.equal(GAME_STRINGS.es.decide.kind('accept_ask'), 'accept_ask')
})

test('review: interleaved refusals of two asks each fold into their own run; an accepted move on that item ends it', () => {
  const rows: GameEvent[] = []
  for (let i = 0; i < 4; i++) {
    rows.push(decision(900 + 2 * i, 'taker', 300 + i, { price: 31 }))
    rows.push(decision(901 + 2 * i, 'taker', 300 + i, { item: 'LAV-08', price: 33 }))
  }
  rows.push(decision(950, 'taker', 310, { status: 'done', verdict: 'allowed', rule: null, text: null, method: 'accept' }))
  rows.push(decision(951, 'taker', 311, { price: 30 }))
  const s = feed(fresh(320), rows)
  const shown = timeline(s).flatMap((c) => c.decide.flatMap((d) => (d.kind === 'row' ? [[d.row.decision, d.run?.count ?? 1]] : [])))
  assert.deepEqual(shown, [[951, 1], [950, 1], [906, 4], [907, 4]])
})

test('review: a dealer fill takes its value from its own thread, never from an older one', () => {
  const s = feed(fresh(300), [
    decision(100, 'taker', 100, { kind: 'dealer_open', counterparty: 'abuela', price: null, value: 80, status: 'done', verdict: 'allowed', rule: null, text: null, method: 'open_thread' }),
    decision(101, 'taker', 100, { kind: 'dealer_opened', counterparty: 'abuela', price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
    decision(102, 'taker', 101, { kind: 'dealer_closed', counterparty: 'abuela', price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
    decision(200, 'taker', 289, { kind: 'dealer_opened', counterparty: 'abuela', price: null, value: null, status: 'done', verdict: null, rule: null, text: null }),
    decision(201, 'taker', 290, { kind: 'dealer_closed', counterparty: 'abuela', price: 25, value: null, status: 'done', verdict: null, rule: null, text: null }),
    outcome('thread:700', 290, { target: 'dealer', item: 'SAL-08', counterparty: 'abuela', price: 25, value: null, surplus: null, label: 'bad' }),
  ])
  assert.deepInclude(deals(s)[0], { value: null, edge: null, verdict: null })
  assert.equal(now(s).gain, 0)
})
