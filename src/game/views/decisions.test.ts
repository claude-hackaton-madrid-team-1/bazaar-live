import { assert, test } from 'vitest'
import type { AgentName, DecisionPayload, LedgerTick, OutcomePayload } from '../../../shared/decisions.ts'
import { DECISION_LIMITS } from '../decisions.ts'
import { apply, createState, KNOWN_TYPES, type GameEvent, type State } from '../state.ts'
import { agentStatuses, blocksByRule, dealTally, deals, ledger, share, SILENCE, ticksPerHour } from './decisions.ts'

let nextId = -(2 ** 50)
const ev = (type: string, payload: object, tick: number | undefined = 10, t = 0.1): GameEvent => ({ id: nextId--, tick, t, type, scope: 'team', actor: '', payload: { ...payload } })

const decision = (id: number, agent: AgentName, tick: number, fields: Partial<DecisionPayload> = {}) =>
  ev('agent.decision', {
    decision: id, agent, kind: 'accept_ask', item: 'LAV-08', counterparty: 't05', price: 24, value: 31.5, status: 'approved', verdict: 'allowed',
    rule: null, text: null, jev: 'yes', jevValue: 0.8, method: null, error: null, outcome: null, surplus: null, jevRight: null, ...fields,
  }, tick)

const denied = (id: number, agent: AgentName, tick: number, rule: string) => decision(id, agent, tick, { status: 'rejected', verdict: 'denied', rule, text: `${rule} broke` })

const LIMITS = { spendPerHour: 150, cashFloor: 50, acceptsPerTick: 1 }

const fresh = (tick = 10, tickSeconds = 60) => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }, 0))
  apply(s, ev('clock', { day: 'fri', tick_seconds: tickSeconds }, tick, tick * tickSeconds / 3600))
  return s
}

const feed = (s: State, events: GameEvent[]) => {
  for (const e of events) apply(s, e)
  return s
}

test('the three decision types are known and ours', () => {
  for (const type of ['agent.decision', 'agent.outcome', 'agent.ledger']) assert.isTrue(KNOWN_TYPES.has(type))
  const s = feed(fresh(), [decision(1, 'taker', 10)])
  assert.equal(s.mine.at(-1)?.type, 'agent.decision')
})

test('a decision sent again (its status moved on) replaces itself in place', () => {
  const s = feed(fresh(), [decision(1, 'taker', 10), decision(2, 'taker', 10), decision(1, 'taker', 10, { status: 'done', method: 'accept_offer' })])
  assert.deepEqual(s.agents.decisions.taker.map((d) => [d.decision, d.status]), [[1, 'done'], [2, 'approved']])
})

test('a late decision lands in id order, and the log is bounded per agent', () => {
  const s = feed(fresh(), [decision(5, 'maker', 10), decision(3, 'maker', 9)])
  assert.deepEqual(s.agents.decisions.maker.map((d) => d.decision), [3, 5])
  for (let i = 0; i < DECISION_LIMITS.perAgent + 10; i++) apply(s, decision(100 + i, 'taker', 10))
  assert.equal(s.agents.decisions.taker.length, DECISION_LIMITS.perAgent)
  assert.equal(s.agents.decisions.taker[0]?.decision, 110)
})

test('an unknown agent or a decision without an id is dropped', () => {
  const s = feed(fresh(), [ev('agent.decision', { decision: 1, agent: 'broker' }), ev('agent.decision', { agent: 'taker' })])
  assert.deepEqual(s.agents.decisions, { taker: [], maker: [], duels: [] })
})

const statusOf = (s: State) => agentStatuses(s).map((a) => [a.agent, a.state, a.silentFor])

test('silence: an agent with no decision for more than its SILENCE ticks, or never, is silent', () => {
  assert.equal(SILENCE.taker.silent, 3)
  const s = feed(fresh(20), [decision(1, 'taker', 19), decision(2, 'maker', 16), decision(3, 'maker', 17)])
  assert.deepEqual(statusOf(s), [['taker', 'ok', 1], ['maker', 'ok', 3], ['duels', 'silent', null]])
  apply(s, ev('clock', {}, 21, 0.35))
  assert.deepEqual(statusOf(s), [['taker', 'ok', 2], ['maker', 'quiet', 4], ['duels', 'silent', null]])
  apply(s, ev('clock', {}, 23, 0.36))
  assert.deepEqual(statusOf(s), [['taker', 'silent', 4], ['maker', 'quiet', 6], ['duels', 'silent', null]])
})

test('the maker decides in bursts: quiet (amber) first, silent (red) only past SILENCE.maker.silent', () => {
  const s = feed(fresh(20), [decision(1, 'maker', 20)])
  apply(s, ev('clock', {}, 20 + SILENCE.maker.silent, 0.5))
  assert.deepEqual(statusOf(s)[1], ['maker', 'quiet', SILENCE.maker.silent])
  apply(s, ev('clock', {}, 21 + SILENCE.maker.silent, 0.5))
  assert.deepEqual(statusOf(s)[1], ['maker', 'silent', SILENCE.maker.silent + 1])
})

test('before any decision log arrives (the game API alone) no agent is called silent', () => {
  assert.deepEqual(statusOf(fresh(20)), [['taker', 'none', null], ['maker', 'none', null], ['duels', 'none', null]])
})

test('a restart is not a sign of life: the silence counts from the last real decision, the restarts are counted apart', () => {
  const s = feed(fresh(20), [
    decision(1, 'taker', 10),
    decision(2, 'taker', 12, { kind: 'process_started', item: null, verdict: null }),
    decision(3, 'taker', 19, { kind: 'process_started', item: null, verdict: null }),
  ])
  const [taker] = agentStatuses(s)
  assert.deepEqual([taker?.state, taker?.silentFor, taker?.restarts, taker?.restartedAt, taker?.decisions], ['silent', 10, 2, 19, 1])
  assert.equal(taker?.last?.kind, 'accept_ask')
})

test('stuck: alive, but its last run is STUCK_AFTER identical blocks; the rule that blocks it most this game hour', () => {
  const s = feed(fresh(20), [
    denied(1, 'taker', 15, 'cash_floor'),
    decision(2, 'taker', 16),
    denied(3, 'taker', 17, 'max_price_uncommon'),
    denied(4, 'taker', 18, 'max_price_uncommon'),
    denied(5, 'maker', 19, 'protect_page_sets'),
    denied(6, 'maker', 20, 'protect_page_sets'),
  ])
  const [taker, maker, duels] = agentStatuses(s)
  assert.deepEqual([taker?.state, taker?.last?.rows.length, maker?.state], ['ok', 2, 'ok'], 'two in a row is not stuck yet')
  apply(s, denied(7, 'taker', 19, 'max_price_uncommon'))
  const [stuck] = agentStatuses(s)
  assert.deepEqual([stuck?.state, stuck?.last?.rows.length, stuck?.last?.fromTick, stuck?.last?.toTick], ['stuck', 3, 17, 19])
  assert.deepEqual([stuck?.topBlock, stuck?.blocks, stuck?.decisions], [{ rule: 'max_price_uncommon', count: 3 }, 4, 5])
  assert.deepEqual([duels?.topBlock, duels?.blocks], [null, 0])
})

test('the deal tally: good, ok and bad, and how often Jev was right', () => {
  const outcome = (subject: string, label: 'good' | 'ok' | 'bad' | null, jevRight: boolean | null) => ev('agent.outcome', {
    target: 'trade', subject, decision: null, agent: 'taker', item: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, value: 31.5,
    label, score: null, surplus: null, jev: 'yes', jevRight,
  }, 11)
  const s = feed(fresh(), [outcome('a', 'good', true), outcome('b', 'good', false), outcome('c', 'bad', true), outcome('d', 'ok', null), outcome('e', null, null)])
  assert.deepEqual(dealTally(s), { good: 2, ok: 1, bad: 1, unscored: 1, jevRight: 2, jevJudged: 3 })
})

test('ticks in a game hour follow the tick length', () => {
  assert.equal(ticksPerHour(60), 60)
  assert.equal(ticksPerHour(30), 120)
  assert.equal(ticksPerHour(0), 60)
})

test('blocks by rule over the last game hour, most frequent first', () => {
  const s = feed(fresh(100), [
    denied(1, 'taker', 30, 'max_spend_per_game_hour'), // more than a game hour ago (60 ticks at 60 s): not counted
    denied(2, 'taker', 50, 'max_spend_per_game_hour'),
    denied(3, 'taker', 70, 'max_accepts_per_tick'),
    denied(4, 'maker', 80, 'max_accepts_per_tick'),
    denied(5, 'duels', 90, 'duel_inside_limit'),
    decision(6, 'taker', 95),
    decision(7, 'taker', 96, { status: 'rejected', verdict: 'denied', rule: null }),
  ])
  const b = blocksByRule(s)
  assert.equal(b.fromTick, 41)
  assert.equal(blocksByRule(fresh(5)).fromTick, 0)
  assert.equal(b.total, 5)
  assert.deepEqual(b.rules.map((r) => [r.rule, r.count, r.lastTick, r.agents]), [
    ['max_accepts_per_tick', 2, 80, ['taker', 'maker']],
    ['other', 1, 96, ['taker']],
    ['duel_inside_limit', 1, 90, ['duels']],
    ['max_spend_per_game_hour', 1, 50, ['taker']],
  ])
})

test('the ledger: spend over the last game hour by t_hours, cash against the floor, accepts this tick', () => {
  const ticks: LedgerTick[] = [
    { tick: 30, t: 0.5, spent: 80, accepts: 1, listings: 0 }, // more than an hour before t 1.6667
    { tick: 70, t: 1.1667, spent: 60, accepts: 1, listings: 0 },
    { tick: 99, t: 1.65, spent: 30, accepts: 0, listings: 2 },
    { tick: 100, t: 1.6667, spent: -10, accepts: 1, listings: 0 }, // a refund
  ]
  const s = feed(fresh(100), [ev('agent.me', { cash: 120 }, 100), ev('agent.ledger', { ticks, limits: LIMITS }, 100)])
  assert.deepEqual(ledger(s), { spent: 80, cash: 120, accepts: 1, limits: LIMITS, headroom: 70, tick: 100 })
  apply(s, ev('agent.me', { cash: 60 }, 100))
  assert.equal(ledger(s)?.headroom, 10)
  assert.isNull(ledger(fresh()))
})

test('share is a 0..1 meter, and a zero cap is full once anything is used', () => {
  assert.equal(share(75, 150), 0.5)
  assert.equal(share(200, 150), 1)
  assert.equal(share(0, 0), 0)
  assert.equal(share(1, 0), 1)
})

test('deals: newest first, did each beat our value, and the outcome lands on its decision', () => {
  const outcome = (subject: string, fields: Partial<OutcomePayload>) => ev('agent.outcome', {
    target: 'trade', subject, decision: null, agent: 'taker', item: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, value: 31.5,
    label: 'good', score: 0.24, surplus: 7.5, jev: 'yes', jevRight: true, ...fields,
  }, 11)
  const s = feed(fresh(), [
    decision(1, 'taker', 10, { status: 'done' }),
    outcome('settlement:1', { decision: 1 }),
    outcome('settlement:2', { surplus: null, price: 12, value: 9, label: 'bad', jevRight: false }),
    outcome('duel:85', { target: 'duel', agent: 'duels', item: null, price: null, value: null, surplus: null, side: null }),
  ])
  assert.deepEqual(deals(s).map((d) => [d.row.subject, d.edge, d.verdict]), [['duel:85', null, null], ['settlement:2', -3, 'below'], ['settlement:1', 7.5, 'beat']])
  assert.deepInclude(s.agents.decisions.taker[0], { outcome: 'good', surplus: 7.5, jevRight: true })
  apply(s, outcome('settlement:2', { label: 'ok', surplus: 0 }))
  assert.equal(s.agents.outcomes.length, 3)
  assert.deepEqual([deals(s)[0]?.row.subject, deals(s)[0]?.verdict], ['settlement:2', 'even'])
})
