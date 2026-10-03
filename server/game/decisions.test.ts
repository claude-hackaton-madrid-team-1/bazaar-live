import { describe, expect, it } from 'vitest'
import type { Db } from '../transcript/poller.ts'
import { DecisionsPoller, DEFAULT_LIMITS, FIRST_ID, SQL, decisionOf, ledgerOf, outcomeOf, readLimits, ruleText, startDecisions } from './decisions.ts'
import { GameHub, type GameEvent } from './relay.ts'

const SECRET_URL = 'postgresql://bazaar_live_reader:hunter2-secret@postgres.railway.internal:5432/railway'

interface Call { readonly sql: string; readonly params: readonly unknown[] }

const pgError = (code: string, message = 'boom') => Object.assign(new Error(message), { code })

function fakeDb(handler: (call: Call) => unknown[] | Error): { db: Db; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    db: {
      query: async (sql, params = []) => {
        const call = { sql, params }
        calls.push(call)
        const out = handler(call)
        if (out instanceof Error) throw out
        return { rows: out }
      },
    },
  }
}

const decisionRow = (id: number, extra: Record<string, unknown> = {}) => ({
  id: String(id), tick: 100 + id, agent: 'taker', kind: 'accept_ask', item: 'LAV-08', counterparty: 't05', price: 24, our_value: '31.5',
  status: 'approved', verdict: 'allowed', rule: null, rule_text: null, jev_verdict: 'yes', jev_value: '0.81', exec_method: null, error_code: null,
  outcome_label: null, realized_surplus: null, jev_right: null, ...extra,
})

const outcomeRow = (subject: string, stamp: string, extra: Record<string, unknown> = {}) => ({
  target: 'trade', subject, decision_id: '1', agent: 'taker', tick: 101, item: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, our_value: '31.5',
  label: 'good', score: '0.240', realized_surplus: '7.5', jev_verdict: 'yes', jev_right: true, stamp, ...extra,
})

/** A fake of the three views that honours the query shapes (backfill, after the mark, the look-back window, the keyset). */
function viewsDb(state: { decisions: Record<string, unknown>[]; outcomes: Record<string, unknown>[]; ledger: Record<string, unknown>[] }) {
  return fakeDb((c) => {
    const id = (r: Record<string, unknown>) => Number(r.id)
    if (c.sql === SQL.decisionsBackfill) return state.decisions.slice(-(c.params[0] as number))
    if (c.sql === SQL.decisionsAfter) return state.decisions.filter((r) => id(r) > (c.params[0] as number)).slice(0, c.params[1] as number)
    if (c.sql === SQL.decisionsWindow) return state.decisions.filter((r) => id(r) > (c.params[0] as number) && id(r) <= (c.params[1] as number)).reverse()
    if (c.sql === SQL.outcomesBackfill) return state.outcomes.slice(-(c.params[0] as number))
    if (c.sql === SQL.outcomesAfter) {
      const [stamp, target, subject] = c.params as string[]
      return state.outcomes.filter((r) => `${r.stamp}|${r.target}|${r.subject}` > `${stamp}|${target}|${subject}`)
    }
    if (c.sql === SQL.ledger) return state.ledger
    return []
  })
}

function setup(state = { decisions: [] as Record<string, unknown>[], outcomes: [] as Record<string, unknown>[], ledger: [] as Record<string, unknown>[] }) {
  const { db, calls } = viewsDb(state)
  const hub = new GameHub()
  const batches: GameEvent[][] = []
  hub.subscribe((b) => batches.push([...b]))
  const logs: Record<string, unknown>[] = []
  const poller = new DecisionsPoller({ db, hub, log: (e) => logs.push(e), random: () => 0.5, backfill: 50, idWindow: 20, cap: 100, secrets: [SECRET_URL, 'hunter2-secret'] })
  return { state, db, calls, hub, batches, logs, poller }
}

describe('decisionOf', () => {
  it('builds the wire payload from a row, numbers out of numeric text', () => {
    expect(decisionOf(decisionRow(7, { status: 'rejected', verdict: 'denied', rule: 'max_spend_per_game_hour', rule_text: 'spend 140 + 20 > max_spend_per_game_hour 150' }))).toEqual({
      tick: 107,
      payload: {
        decision: 7, agent: 'taker', kind: 'accept_ask', item: 'LAV-08', counterparty: 't05', price: 24, value: 31.5, status: 'rejected',
        verdict: 'denied', rule: 'max_spend_per_game_hour', text: 'spend 140 + 20 > max_spend_per_game_hour 150', jev: 'yes', jevValue: 0.81,
        method: null, error: null, outcome: null, surplus: null, jevRight: null,
      },
    })
  })

  it('drops a row it cannot place: another agent, an odd status or kind, no id', () => {
    expect(decisionOf(decisionRow(1, { agent: 'broker' }))).toBeNull()
    expect(decisionOf(decisionRow(1, { status: 'whatever' }))).toBeNull()
    expect(decisionOf(decisionRow(1, { kind: 'DROP TABLE' }))).toBeNull()
    expect(decisionOf(decisionRow(1, { id: null }))).toBeNull()
    expect(decisionOf('nope')).toBeNull()
  })

  it('re-checks every field: a duel item, a bad name, a denial without a rule id', () => {
    const d = decisionOf(decisionRow(2, { agent: 'duels', kind: 'duel_offer', item: 'duel:85', counterparty: '<script>', verdict: 'denied', rule: 'Bad Rule!' }))
    expect(d?.payload).toMatchObject({ item: 'duel:85', counterparty: null, rule: 'other' })
    expect(decisionOf(decisionRow(3, { verdict: 'allowed', rule: 'cash_floor' }))?.payload.rule).toBeNull()
  })
})

describe('ruleText', () => {
  it('keeps the comparison signs and cuts control characters, links and length', () => {
    expect(ruleText('cash 60 - 20 < cash_floor 50')).toBe('cash 60 - 20 < cash_floor 50')
    expect(ruleText('a\u0000b‮c  see https://evil.test/x')).toBe('a bc see')
    expect(ruleText('x'.repeat(300))).toHaveLength(140)
    expect(ruleText(42)).toBeNull()
  })
})

describe('outcomeOf and ledgerOf', () => {
  it('reads an outcome, and refuses an odd target or subject', () => {
    expect(outcomeOf(outcomeRow('settlement:67', '2026-10-03T10:00:00.000000Z'))).toEqual({
      tick: 101,
      payload: { target: 'trade', subject: 'settlement:67', decision: 1, agent: 'taker', item: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, value: 31.5, label: 'good', score: 0.24, surplus: 7.5, jev: 'yes', jevRight: true },
    })
    expect(outcomeOf(outcomeRow('settlement:67', 'x', { target: 'market_test' }))).toBeNull()
    expect(outcomeOf(outcomeRow('<b>', 'x'))).toBeNull()
  })

  it('reads the ledger rows and carries the caps', () => {
    expect(ledgerOf([{ tick: 100, t_hours: '1.6667', spent: 24, accepts: 1, listings: 0 }, { tick: 'x' }], DEFAULT_LIMITS)).toEqual({
      ticks: [{ tick: 100, t: 1.6667, spent: 24, accepts: 1, listings: 0 }],
      limits: { spendPerHour: 150, cashFloor: 50, acceptsPerTick: 1 },
    })
  })

  it('takes the caps from GUARDRAILS.md, or from GUARDRAIL_* when an edit changed them', () => {
    expect(readLimits({})).toEqual(DEFAULT_LIMITS)
    expect(readLimits({ GUARDRAIL_CASH_FLOOR: '100', GUARDRAIL_SPEND_PER_HOUR: 'lots', GUARDRAIL_ACCEPTS_PER_TICK: '-1' })).toEqual({ ...DEFAULT_LIMITS, cashFloor: 100 })
  })
})

describe('DecisionsPoller', () => {
  it('reads only the three views, never a table or a private column', async () => {
    const { calls, poller } = setup()
    await poller.pollOnce()
    await poller.pollOnce()
    for (const c of calls) {
      expect(c.sql).toMatch(/show\.agent_(decisions|outcomes|ledger)/)
      expect(c.sql).not.toMatch(/public\.|candidates|reason|payload|request|response|explanation|details|your_limit|source/)
    }
  })

  it('backfills, then publishes only new decisions and the ones whose status changed, with ids of their own', async () => {
    const { state, batches, poller } = setup()
    state.decisions = [decisionRow(1), decisionRow(2)]
    await poller.pollOnce()
    expect(batches).toHaveLength(1)
    // An empty ledger still goes out once: the page learns the caps before the first spend.
    expect(batches[0]!.map((e) => [e.type, e.payload.decision, e.scope, e.actor])).toEqual([['agent.decision', 1, 'team', 'taker'], ['agent.decision', 2, 'team', 'taker'], ['agent.ledger', undefined, 'team', '']])
    expect(batches[0]!.map((e) => e.id)).toEqual([FIRST_ID, FIRST_ID - 1, FIRST_ID - 2])
    await poller.pollOnce()
    expect(batches).toHaveLength(1) // nothing changed: nothing sent
    state.decisions = [decisionRow(1), decisionRow(2, { status: 'done', exec_method: 'accept_offer' }), decisionRow(3)]
    await poller.pollOnce()
    expect(batches[1]!.map((e) => [e.payload.decision, e.payload.status])).toEqual([[2, 'done'], [3, 'approved']])
  })

  it('follows outcomes by their stamp and the ledger when it changes', async () => {
    const { state, batches, poller } = setup()
    state.outcomes = [outcomeRow('settlement:1', '2026-10-03T10:00:00.000000Z')]
    state.ledger = [{ tick: 100, t_hours: '1.6667', spent: 24, accepts: 1, listings: 0 }]
    await poller.pollOnce()
    expect(batches[0]!.map((e) => e.type)).toEqual(['agent.outcome', 'agent.ledger'])
    expect(batches[0]![1]).toMatchObject({ tick: 100, payload: { limits: DEFAULT_LIMITS } })
    state.outcomes.push(outcomeRow('settlement:2', '2026-10-03T10:00:00.000000Z'))
    await poller.pollOnce()
    expect(batches[1]!.map((e) => [e.type, e.payload.subject])).toEqual([['agent.outcome', 'settlement:2']])
  })

  it('says once that the views are missing, re-checks slowly, and says when they are back', async () => {
    let missing = true
    const { db } = fakeDb((c) => (missing ? pgError('42P01', 'relation "show.agent_decisions" does not exist') : c.sql === SQL.ledger ? [] : []))
    const logs: Record<string, unknown>[] = []
    const hub = new GameHub()
    const poller = new DecisionsPoller({ db, hub, log: (e) => logs.push(e), recheckMs: 60_000 })
    await poller.pollOnce()
    await poller.pollOnce()
    expect(poller.off).toBe(true)
    expect(poller.nextDelayMs()).toBe(60_000)
    expect(logs).toEqual([{ route: 'agent_decisions', event: 'off', reason: 'view_missing', code: '42P01', note: 'apply db/agent_decisions.sql (after db/show.sql)' }])
    missing = false
    await poller.pollOnce()
    expect(poller.off).toBe(false)
    expect(logs.at(-1)).toEqual({ route: 'agent_decisions', event: 'on' })
  })

  it('treats a dropped grant (show.sql re-run) like a missing view', async () => {
    const { db } = fakeDb(() => pgError('42501', 'permission denied for view agent_decisions'))
    const logs: Record<string, unknown>[] = []
    const poller = new DecisionsPoller({ db, hub: new GameHub(), log: (e) => logs.push(e) })
    await poller.pollOnce()
    expect(logs[0]).toMatchObject({ event: 'off', code: '42501' })
  })

  it('backs off on other errors and never logs the url or the password', async () => {
    const { db } = fakeDb(() => pgError('ECONNREFUSED', `connect failed ${SECRET_URL} password hunter2-secret`))
    const logs: Record<string, unknown>[] = []
    const poller = new DecisionsPoller({ db, hub: new GameHub(), log: (e) => logs.push(e), random: () => 0.5, secrets: [SECRET_URL, 'hunter2-secret'] })
    await poller.pollOnce()
    expect(poller.nextDelayMs()).toBe(6000)
    expect(logs[0]).toMatchObject({ event: 'poll_failed', code: 'ECONNREFUSED' })
    expect(JSON.stringify(logs)).not.toMatch(/hunter2|railway\.internal/)
  })
})

describe('startDecisions', () => {
  it('is off, and says why, without the database or without the game', () => {
    const logs: Record<string, unknown>[] = []
    const { db } = fakeDb(() => [])
    startDecisions({}, { db: null, hub: new GameHub(), log: (e) => logs.push(e) }).stop()
    startDecisions({}, { db, hub: null, log: (e) => logs.push(e) }).stop()
    expect(logs).toEqual([
      { route: 'agent_decisions', event: 'off', reason: 'no_database' },
      { route: 'agent_decisions', event: 'off', reason: 'no_game' },
    ])
  })

  it('keeps the latest ledger sticky in the hub, so a late viewer gets it first', async () => {
    const hub = new GameHub()
    const { db } = fakeDb((c) => (c.sql === SQL.ledger ? [{ tick: 9, t_hours: '0.15', spent: 12, accepts: 0, listings: 0 }] : []))
    await new DecisionsPoller({ db, hub, log: () => undefined }).pollOnce()
    hub.publish(Array.from({ length: 3 }, (_, i) => ({ id: i + 1, type: 'settlement', payload: {} })))
    expect(hub.replay()[0]?.type).toBe('agent.ledger')
  })
})
