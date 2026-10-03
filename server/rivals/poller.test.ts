import { describe, expect, it } from 'vitest'
import type { Db } from '../transcript/poller.ts'
import { CAPS, RivalsPoller, SQL } from './poller.ts'

const ROWS: Record<string, unknown[]> = {
  [SQL.holdings]: [{ holder: 't03', card: 'LAV-10', copies: 1, how: 'bought', since_tick: 844, seen_tick: 844 }],
  [SQL.teams]: [{ team: 't14', rank: 1, score: 30.36, set_interest: { RET: 9 } }],
  [SQL.wants]: [{ team: 't03', card: 'LAV-10', via: 'bid', times: 12, last_tick: 842, top_bid: 71 }],
  [SQL.head]: [{ tick: 856 }],
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

describe('RivalsPoller', () => {
  it('reads the four views with their caps', async () => {
    const d = db()
    const poller = new RivalsPoller({ db: d, log: () => undefined, now: () => new Date('2026-10-03T10:00:00Z') })
    await poller.pollOnce()
    expect(d.params).toEqual([[CAPS.holdings], [CAPS.teams], [CAPS.wants], [CAPS.head]])
    const s = poller.current()
    expect(s).toMatchObject({ at: '2026-10-03T10:00:00.000Z', tick: 856, parts: { holdings: true, teams: true, wants: true, head: true } })
    expect(s.holdings[0]).toMatchObject({ holder: 't03', card: 'LAV-10', since: 844 })
    expect(s.teams[0]?.interest).toEqual({ RET: 9 })
    expect(s.wants[0]?.topBid).toBe(71)
  })

  it('a view not applied yet blanks only its part, logged once; another error keeps the last good part, redacted', async () => {
    const logs: Record<string, unknown>[] = []
    let missing = true
    const d = db((sql) => (sql === SQL.wants && missing ? { code: '42P01' } : sql === SQL.holdings && !missing ? Object.assign(new Error('timeout at host-secret'), { code: '57014' }) : null))
    const poller = new RivalsPoller({ db: d, log: (e) => logs.push(e), secrets: ['host-secret'] })
    await poller.pollOnce()
    await poller.pollOnce()
    expect(poller.current().parts.wants).toBe(false)
    expect(logs.filter((l) => l.event === 'view_missing')).toHaveLength(1)
    missing = false
    await poller.pollOnce()
    expect(poller.current().holdings).toHaveLength(1)
    expect(poller.current().parts.wants).toBe(true)
    const error = logs.find((l) => l.event === 'poll_error' && l.part === 'holdings')
    expect(error?.message).toBe('timeout at ***')
  })

  it('tells a listener when a read changed the rows (a new head tick alone is no change), and a poke reads at once', async () => {
    const d = db()
    const poller = new RivalsPoller({ db: d, log: () => undefined, now: () => new Date('2026-10-03T10:00:00Z'), setTimer: () => 1, clearTimer: () => undefined })
    const heard: string[] = []
    poller.onChange((at) => heard.push(at))
    await poller.pollOnce()
    ROWS[SQL.head] = [{ tick: 857 }]
    await poller.pollOnce()
    expect(heard).toEqual(['2026-10-03T10:00:00.000Z'])
    expect(poller.current().tick).toBe(857)
    expect(poller.poke()).toBe(false) // not started
    poller.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(poller.poke()).toBe(true)
    poller.stop()
  })
})
