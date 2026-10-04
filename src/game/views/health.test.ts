import { assert, test } from 'vitest'
import type { AgentName } from '../../../shared/decisions.ts'
import type { HealthReport } from '../../../shared/health.ts'
import { MockGame } from '../mock.ts'
import { apply, createState, type GameEvent, type State } from '../state.ts'
import { HEALTH_STALE_MS, healthChips } from './health.ts'

const NOW = Date.parse('2026-10-03T10:40:00Z')
let nextId = -(2 ** 51)
const ev = (type: string, payload: object, tick: number | undefined = 10): GameEvent => ({ id: nextId--, tick, type, scope: 'team', actor: '', payload: { ...payload } })

const report = (agent: 'taker' | 'maker', fields: Partial<HealthReport> = {}): HealthReport => ({
  agent, checkedAt: new Date(NOW - 3000).toISOString(), error: null, mode: 'live', target: 'real', ledger: 'shared', tick: 10, serverTick: 10,
  lastTickAt: new Date(NOW - 5000).toISOString(), tickAgeS: 5, doors: 'open', paused: false, nextOpens: null, tickSeconds: 30,
  tickMs: null, tickBudgetS: null, rateLimited: null, jevMs: null, jevUndecided: null, since: {}, ...fields,
})

const decided = (id: number, agent: AgentName, tick: number) =>
  ev('agent.decision', { decision: id, agent, kind: 'accept_ask', item: 'LAV-08', status: 'approved', verdict: 'allowed' }, tick)

function game(tick: number, events: GameEvent[]): State {
  const s = createState()
  apply(s, ev('clock', { tick_seconds: 30 }, tick))
  for (const e of events) apply(s, e)
  return s
}

const brief = (s: State, now = NOW) => healthChips(s, now).map((c) => [c.agent, c.tone, c.reason?.kind ?? null])

test('agent.health is kept apart: never in the event lists, only the latest reports', () => {
  const s = game(10, [])
  for (let i = 0; i < 5; i++) apply(s, ev('agent.health', { agents: [report('taker'), report('maker', { mode: 'dry' }), { agent: 'broker' }] }))
  assert.equal(s.events.filter((e) => e.type === 'agent.health').length, 0)
  assert.equal(s.mine.filter((e) => e.type === 'agent.health').length, 0)
  assert.deepEqual(s.health.map((r) => [r.agent, r.mode]), [['taker', 'live'], ['maker', 'dry']])
})

test('one reason per chip: /health for the taker and the maker, decisions for the duels', () => {
  const s = game(10, [decided(1, 'taker', 10), decided(2, 'maker', 9), decided(3, 'duels', 10)])
  apply(s, ev('agent.health', { agents: [report('taker', { ledger: 'down', since: { ledger_down: '2026-10-03T09:40:00Z' } }), report('maker', { tickMs: 14_200 })] }))
  assert.deepEqual(brief(s), [['taker', 'bad', 'ledger_down'], ['maker', 'warn', 'tick_slow'], ['duels', 'good', null], ['sales', 'bad', 'silent']])
  assert.equal(healthChips(s, NOW)[0]?.since, '2026-10-03T09:40:00Z')
})

test('a silent agent with a healthy /health is red for its silence; /health explains it when it can', () => {
  const s = game(20, [decided(1, 'taker', 10), decided(2, 'maker', 18)])
  apply(s, ev('agent.health', { agents: [report('taker'), report('maker')] }))
  assert.deepEqual(brief(s).slice(0, 2), [['taker', 'bad', 'silent'], ['maker', 'good', null]])
  apply(s, ev('agent.health', { agents: [report('taker', { ledger: 'down' }), report('maker')] }))
  assert.deepEqual(brief(s)[0], ['taker', 'bad', 'ledger_down'])
})

test('the maker is quiet (amber) before it is silent', () => {
  const s = game(16, [decided(1, 'taker', 16), decided(2, 'maker', 10)])
  assert.deepEqual(brief(s)[1], ['maker', 'warn', 'quiet'])
})

test('closed doors explain the silence; a stale report says so instead of a stale green', () => {
  const s = game(20, [decided(1, 'taker', 10), decided(2, 'maker', 20)])
  apply(s, ev('agent.health', { agents: [report('taker', { doors: 'closed' }), report('maker')] }))
  assert.deepEqual(brief(s)[0], ['taker', 'neutral', 'closed'])
  assert.deepEqual(brief(s, NOW + HEALTH_STALE_MS + 5000)[1], ['maker', 'neutral', 'stale'])
})

test('the mock: the taker red (ledger down), the maker amber (tick budget), the duels green', () => {
  const game = new MockGame(7, undefined, undefined, () => NOW)
  const s = createState()
  for (let i = 0; i < 8 * 6; i++) for (const e of game.step()) apply(s, e)
  assert.deepEqual(healthChips(s, NOW).map((c) => [c.agent, c.tone, c.health?.reason?.kind ?? c.reason?.kind ?? null]), [
    ['taker', 'bad', 'ledger_down'], ['maker', 'warn', 'tick_slow'], ['duels', 'good', null], ['sales', 'warn', 'quiet'],
  ])
})
