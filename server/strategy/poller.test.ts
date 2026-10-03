import { describe, expect, it } from 'vitest'
import type { Db } from '../transcript/poller.ts'
import { CAPS, SQL, StrategyPoller } from './poller.ts'

const ROWS: Record<string, unknown[]> = {
  [SQL.me]: [{ team: 't01', tick: 629, cash: 81, affinity: { LAV: 1.6 }, pages: [], cards: [] }],
  [SQL.spend]: [{ ledger_tick: 629, t_hours: 6.5, spent: 0, buys: 0 }],
  [SQL.decisions]: [{ id: 2, tick: 584, agent: 'taker', kind: 'accept_ask', status: 'rejected', guardrail: 'denied: cash 81 - 79 < cash_floor 50' }],
  [SQL.asks]: [{ offer: 9161, tick: 629, card: 'SAL-01', price: 10, ours: true }],
  [SQL.cards]: [{ card: 'MAL-10', page: true }],
}

const db = (fail: (sql: string) => unknown = () => null): Db & { params: unknown[] } => {
  const params: unknown[] = []
  return {
    params,
    query: (sql, p) => {
      params.push(p)
      const error = fail(sql)
      return error ? Promise.reject(error) : Promise.resolve({ rows: ROWS[sql] ?? [] })
    },
  }
}

describe('StrategyPoller', () => {
  it('reads the five views with their caps', async () => {
    const d = db()
    const poller = new StrategyPoller({ db: d, log: () => undefined, now: () => new Date('2026-10-03T10:00:00Z') })
    await poller.pollOnce()
    expect(d.params).toEqual([[CAPS.me], [CAPS.spend], [CAPS.decisions], [CAPS.asks], [CAPS.cards]])
    const s = poller.current()
    expect(s).toMatchObject({ at: '2026-10-03T10:00:00.000Z', parts: { me: true, spend: true, decisions: true, asks: true, cards: true } })
    expect(s.me?.cash).toBe(81)
    expect(s.spend?.spent).toBe(0)
    expect(s.decisions[0]?.guardrail).toContain('cash_floor 50')
    expect(s.asks[0]?.ours).toBe(true)
    expect(s.cards[0]?.page).toBe(true)
  })

  it('a view not applied yet blanks only its part, logged once; another error keeps the last good part, redacted', async () => {
    const logs: Record<string, unknown>[] = []
    let missing = true
    const d = db((sql) => (sql === SQL.asks && missing ? { code: '42P01' } : sql === SQL.me && !missing ? Object.assign(new Error('timeout at host-secret'), { code: '57014' }) : null))
    const poller = new StrategyPoller({ db: d, log: (e) => logs.push(e), secrets: ['host-secret'] })
    await poller.pollOnce()
    await poller.pollOnce()
    expect(poller.current().parts.asks).toBe(false)
    expect(logs.filter((l) => l.event === 'view_missing')).toHaveLength(1)
    missing = false
    await poller.pollOnce()
    expect(poller.current().me?.cash).toBe(81)
    expect(poller.current().parts.asks).toBe(true)
    const error = logs.find((l) => l.event === 'poll_error' && l.part === 'me')
    expect(error?.message).toBe('timeout at ***')
  })
})
