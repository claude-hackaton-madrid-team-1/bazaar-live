import { describe, expect, it } from 'vitest'
import type { Db } from '../transcript/poller.ts'
import { CAPS, LearnPoller, SQL } from './poller.ts'

const ROWS: Record<string, unknown[]> = {
  [SQL.learnings]: [{ id: 1, kind: 'lesson', claim: 'abuela folds at 60% of her opening', subject: 'abuela', subject_kind: 'dealer', confidence: 0.7 }],
  [SQL.moves]: [{ id: 5, trader: 'abuela', event: 'concede', source: 'ours' }],
  [SQL.dealers]: [{ dealer: 'abuela', threads: 3 }],
  [SQL.rivals]: [{ team: 't03' }],
}

function fakeDb(fail: (sql: string) => unknown = () => null): Db & { calls: { sql: string; params?: readonly unknown[] }[] } {
  const calls: { sql: string; params?: readonly unknown[] }[] = []
  return {
    calls,
    query: (sql, params) => {
      calls.push({ sql, params })
      const error = fail(sql)
      return error ? Promise.reject(error) : Promise.resolve({ rows: ROWS[sql] ?? [] })
    },
  }
}

const now = () => new Date('2026-10-03T10:00:00Z')

describe('LearnPoller', () => {
  it('reads the four views with their caps and keeps the snapshot', async () => {
    const db = fakeDb()
    const poller = new LearnPoller({ db, log: () => undefined, now })
    await poller.pollOnce()
    expect(db.calls.map((c) => c.params)).toEqual([[CAPS.learnings], [CAPS.moves], [CAPS.dealers], [CAPS.rivals]])
    const s = poller.current()
    expect(s.at).toBe('2026-10-03T10:00:00.000Z')
    expect(s.parts).toEqual({ learnings: true, moves: true, dealers: true, rivals: true })
    expect(s.learnings[0]?.claim).toBe('abuela folds at 60% of her opening')
    expect(s.moves[0]?.ours).toBe(true)
    expect(s.dealers).toHaveLength(1)
    expect(s.rivals[0]?.team).toBe('t03')
  })

  it('blanks only the part whose view is missing, and logs that once', async () => {
    const logs: Record<string, unknown>[] = []
    const db = fakeDb((sql) => (sql === SQL.rivals ? { code: '42P01', message: 'relation "show.rival_profiles" does not exist' } : null))
    const poller = new LearnPoller({ db, log: (e) => logs.push(e), now })
    await poller.pollOnce()
    await poller.pollOnce()
    expect(poller.current().parts).toEqual({ learnings: true, moves: true, dealers: true, rivals: false })
    expect(poller.current().learnings).toHaveLength(1)
    expect(logs.filter((l) => l.event === 'view_missing')).toEqual([{ route: 'learn', event: 'view_missing', part: 'rivals', code: '42P01' }])
  })

  it('keeps the last good rows on another error, keeps the old time, and redacts the secrets', async () => {
    const logs: Record<string, unknown>[] = []
    let down = false
    const db = fakeDb((sql) => (down && sql === SQL.moves ? new Error('connect to secret-host.railway.internal failed') : null))
    let t = 0
    const poller = new LearnPoller({ db, log: (e) => logs.push(e), secrets: ['secret-host.railway.internal'], now: () => new Date(Date.UTC(2026, 9, 3, 10, 0, t++)) })
    await poller.pollOnce()
    const first = poller.current()
    down = true
    await poller.pollOnce()
    expect(poller.current().moves).toEqual(first.moves)
    expect(poller.current().at).toBe(first.at)
    expect(logs).toHaveLength(1)
    expect(String(logs[0]?.message)).toBe('connect to *** failed')
  })

  it('never throws, whatever the database does', async () => {
    const db: Db = { query: () => Promise.reject(null) }
    const poller = new LearnPoller({ db, log: () => undefined })
    await expect(poller.pollOnce()).resolves.toBeUndefined()
    expect(poller.current().learnings).toEqual([])
  })

  it('polls on its timer and stops', async () => {
    const timers: { fn: () => void; ms: number }[] = []
    const db = fakeDb()
    const poller = new LearnPoller({ db, log: () => undefined, intervalMs: 10_000, setTimer: (fn, ms) => timers.push({ fn, ms }), clearTimer: () => undefined })
    poller.start()
    await new Promise((r) => setTimeout(r, 0))
    expect(timers.map((x) => x.ms)).toEqual([10_000])
    poller.stop()
    timers[0]?.fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(db.calls).toHaveLength(4)
  })
})
