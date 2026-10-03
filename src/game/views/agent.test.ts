import { assert, test } from 'vitest'
import type { AgentName, DecisionPayload, OutcomePayload } from '../../../shared/decisions.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { timeline, type Entry } from './agent.ts'

let nextId = 1
const ev = (type: string, payload: Payload = {}, tick = 10, actor = ''): GameEvent => ({
  id: nextId++, tick, t: 0.1, type, scope: type.startsWith('duel.') || type.startsWith('agent.') ? 'team' : 'public', actor, payload,
})

const fresh = (tick = 0) => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }, 0))
  if (tick) apply(s, ev('clock', { day: 'fri', tick_seconds: 60 }, tick))
  return s
}

const feed = (s: State, events: GameEvent[]) => {
  for (const e of events) apply(s, e)
  return s
}

let decisionId = 1
const decision = (agent: AgentName, tick: number, fields: Partial<DecisionPayload> = {}) =>
  ev('agent.decision', {
    decision: decisionId++, agent, kind: 'accept_ask', item: 'LAV-08', counterparty: 't05', price: 24, value: 31.5, status: 'done', verdict: 'allowed',
    rule: null, text: null, jev: 'yes', jevValue: 0.8, method: null, error: null, outcome: null, surplus: null, jevRight: null, ...fields,
  }, tick)

const blocked = (agent: AgentName, tick: number, rule: string, fields: Partial<DecisionPayload> = {}) =>
  decision(agent, tick, { status: 'rejected', verdict: 'denied', rule, text: `${rule} broke`, ...fields })

/** An entry as a short string: what the eye reads on the line. */
const read = (e: Entry): string => {
  switch (e.kind) {
    case 'run':
      return `${e.run.fromTick}-${e.run.toTick} ${e.run.agent} ${e.run.kind} ${e.run.item ?? ''} ${e.run.rule ?? e.run.status} x${e.run.rows.length}`
    case 'idle':
      return `${e.from}-${e.to} idle`
    case 'restart':
      return `${e.tick} ${e.agent} restarted`
    case 'outcome':
      return `${e.tick} deal ${e.row.subject} ${e.row.label ?? ''}`
    case 'line':
      return `${e.tick} ${e.line.text}`
  }
}

test('repeated identical blocks fold into one run with its count, tick range and price range', () => {
  // the real taker: SAL-08 asked every tick, max_price_uncommon refuses it, the price drifts 31 → 32, the text drifts too
  const s = fresh(395)
  for (let t = 380; t <= 391; t++) {
    apply(s, blocked('taker', t, 'max_price_uncommon', { item: 'SAL-08', price: t < 386 ? 31 : 32, text: t % 2 ? 'price 31 > 26' : 'price 31 > 26; cash 57 - 31 < cash_floor 50' }))
  }
  apply(s, decision('taker', 392, { item: 'LAT-02', price: 10 }))
  const runs = timeline(s).filter((e) => e.kind === 'run')
  assert.deepEqual(runs.map(read), ['392-392 taker accept_ask LAT-02 done x1', '380-391 taker accept_ask SAL-08 max_price_uncommon x12'])
  const run = runs[1]!.kind === 'run' ? runs[1]!.run : null
  assert.deepEqual([run?.minPrice, run?.maxPrice, run?.counterparty], [31, 32, 't05'])
})

test('a run breaks on another verdict for the same item or a tick it skipped; a restart or another item in between does not', () => {
  const s = fresh(20)
  feed(s, [
    blocked('taker', 10, 'max_price_uncommon'),
    blocked('taker', 11, 'max_price_uncommon'),
    blocked('taker', 11, 'cash_floor'), // another rule on the same item: ends the first run
    blocked('taker', 12, 'cash_floor', { item: 'SAL-01' }), // another item: a run of its own
    decision('taker', 13, { kind: 'process_started', item: null, verdict: null }), // a marker, not a break
    blocked('taker', 13, 'cash_floor', { item: 'SAL-01' }),
    blocked('taker', 15, 'cash_floor', { item: 'SAL-01' }), // the agent skipped tick 14 on it
    decision('maker', 15, { counterparty: 't07' }),
    decision('maker', 16, { counterparty: 't08' }), // a mixed counterparty still folds, without naming one
  ])
  const all = timeline(s)
  assert.deepEqual(all.filter((e) => e.kind === 'run' || e.kind === 'restart').map(read), [
    '15-16 maker accept_ask LAV-08 done x2',
    '15-15 taker accept_ask SAL-01 cash_floor x1',
    '12-13 taker accept_ask SAL-01 cash_floor x2',
    '13 taker restarted',
    '11-11 taker accept_ask LAV-08 cash_floor x1',
    '10-11 taker accept_ask LAV-08 max_price_uncommon x2',
  ])
  const maker = all.find((e) => e.kind === 'run' && e.run.agent === 'maker')
  assert.equal(maker?.kind === 'run' ? maker.run.counterparty : 'x', null)
})

test('ticks where nothing happened fold into one idle line each, up to the current tick', () => {
  const s = fresh(20)
  feed(s, [decision('taker', 10), decision('maker', 11), decision('taker', 16), blocked('taker', 17, 'cash_floor')])
  assert.deepEqual(timeline(s).map(read), [
    '18-20 idle',
    '17-17 taker accept_ask LAV-08 cash_floor x1',
    '16-16 taker accept_ask LAV-08 done x1',
    '12-15 idle',
    '11-11 maker accept_ask LAV-08 done x1',
    '10-10 taker accept_ask LAV-08 done x1',
  ])
})

test('a restart is a marker, not a decision; a scored deal is a line and keeps its tick busy', () => {
  const outcome: OutcomePayload = {
    target: 'trade', subject: 'settlement:7', decision: null, agent: 'taker', item: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, value: 31.5,
    label: 'good', score: null, surplus: 7.5, jev: 'yes', jevRight: true,
  }
  const s = fresh(14)
  feed(s, [decision('taker', 10), decision('taker', 12, { kind: 'process_started', item: null, verdict: null }), ev('agent.outcome', outcome, 13)])
  assert.deepEqual(timeline(s).map(read), ['14-14 idle', '13 deal settlement:7 good', '12 taker restarted', '11-11 idle', '10-10 taker accept_ask LAV-08 done x1'])
})

test('filters: blocked keeps only the blocked runs, deals only the scored deals; neither folds idle ticks', () => {
  const outcome: OutcomePayload = {
    target: 'duel', subject: 'duel:4', decision: null, agent: 'duels', item: null, counterparty: null, side: null, price: null, value: null,
    label: 'bad', score: null, surplus: null, jev: null, jevRight: null,
  }
  const s = fresh(20)
  feed(s, [decision('taker', 10), blocked('taker', 12, 'cash_floor'), ev('agent.outcome', outcome, 15)])
  assert.deepEqual(timeline(s, { filter: 'blocked' }).map(read), ['12-12 taker accept_ask LAV-08 cash_floor x1'])
  assert.deepEqual(timeline(s, { filter: 'deals' }).map(read), ['15 deal duel:4 bad'])
})

test('upToTick freezes the timeline on the ticks it had, and the limit bounds it', () => {
  const s = fresh(20)
  feed(s, [decision('taker', 10), decision('taker', 15), decision('taker', 19)])
  assert.deepEqual(timeline(s, { upToTick: 16 }).map(read), ['16-16 idle', '15-15 taker accept_ask LAV-08 done x1', '11-14 idle', '10-10 taker accept_ask LAV-08 done x1'])
  assert.equal(timeline(s, { limit: 2 }).length, 2)
})

test('without a decision log: our settlements, duel results and listings, quiet ticks folded, never their chatter or our snapshots', () => {
  const s = fresh()
  const offer = (maker: string) => ({
    id: 23, maker, to: null, venue: 'rastro', thread: null, status: 'open',
    give: { cash: 0, assets: [{ id: 123, kind: 'card', ref: 'LAT-03', serial: 1 }], types: [] }, want: { cash: 11, assets: [], types: [] },
    expires_tick: 30, created_tick: 4, final: false,
  })
  feed(s, [
    ev('clock', {}, 4),
    ev('agent.me', { cash: 400, score: { score: 2, rank: 9 } }, 4),
    ev('offer.listed', { venue: 'rastro', offer: offer('t01') }, 4, 't01'),
    ev('offer.listed', { venue: 'rastro', offer: { ...offer('t07'), id: 24 } }, 4, 't07'),
    ev('clock', {}, 5),
    ev('agent.me', { cash: 390 }, 5),
    ev('duel.message', { duel: 3, role: 'seller', rival: 'Rival Azul', sender: 'Rival Azul', price: 41 }, 5),
    ev('clock', {}, 8),
    ev('settlement', { settlement: 1, parties: ['abuela', 't01'], price: 22, your_value: 30, items: [{ id: 9, ref: 'LAT-09', name: 'San Isidro', frm: 'abuela', to: 't01' }] }, 8),
    ev('duel.result', { duel: 3, rival: 'Rival Azul', deal: true, price: 47, points: 1.2 }, 8),
    ev('clock', {}, 9),
  ])
  assert.deepEqual(timeline(s).map(read), [
    '9-9 idle',
    '8 bought San Isidro from abuela at 22 P',
    '8 duel #3 vs Rival Azul deal at 47 P · +1.2 pts',
    '5-7 idle',
    '4 list LAT-03 at 11 P on rastro',
  ])
  const settled = timeline(s).find((e) => e.kind === 'line' && e.line.type === 'settlement')
  assert.equal(settled?.kind === 'line' ? settled.line.gain : null, 8)
  assert.deepEqual(timeline(s, { filter: 'blocked' }), [])
})
