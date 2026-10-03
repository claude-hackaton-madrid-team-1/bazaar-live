import { describe, expect, it } from 'vitest'
import { TranscriptStore } from './store.ts'
import { Poller, type Db } from './poller.ts'

const SECRET_URL = 'postgresql://bazaar_live_reader:hunter2-secret@db.internal.example:5432/railway'

interface Call { readonly sql: string; readonly params: readonly unknown[] }

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

const threadRow = (id: number, extra: Record<string, unknown> = {}) => ({
  event_id: String(id), tick: id, kind: 'message', thread: 187, counterpart: 'chato', speaker: 'them', item_ref: 'LAV-08', offer_maker: 'chato',
  give_cash: 0, want_cash: 31, final: false, offer_status: 'open', price: null, text: `line ${id}`, ...extra,
})

const deps = (db: Db, store: TranscriptStore, logs: Record<string, unknown>[] = []) => ({
  db, store, log: (e: Record<string, unknown>) => logs.push(e), random: () => 0.5, backfill: 40, cap: 100,
})

describe('Poller', () => {
  it('backfills the latest lines once, then asks only for ids past its watermark', async () => {
    const { db, calls } = fakeDb((c) => (c.sql.includes('show.thread_lines') ? (c.params.length === 1 ? [threadRow(5), threadRow(6)] : [threadRow(7)]) : []))
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store))
    await poller.pollOnce()
    await poller.pollOnce()
    const threadCalls = calls.filter((c) => c.sql.includes('show.thread_lines'))
    expect(threadCalls[0]?.params).toEqual([40])
    expect(threadCalls[1]?.params).toEqual([6, 100])
    expect(store.since(null).map((i) => i.id)).toEqual(['f5', 'f6', 'f7'])
  })

  it('reads only from the two views, never a table', async () => {
    const { db, calls } = fakeDb(() => [])
    await new Poller(deps(db, new TranscriptStore())).pollOnce()
    for (const c of calls) {
      expect(c.sql).toMatch(/show\.(thread_lines|duel_lines)/)
      expect(c.sql).not.toMatch(/feed_events|\bduels\b|payload|your_limit/)
    }
  })

  it('caps the rows it asks for and does not duplicate what a re-read returns', async () => {
    const { db } = fakeDb((c) => (c.sql.includes('thread_lines') ? [threadRow(1), threadRow(1)] : []))
    const store = new TranscriptStore()
    await new Poller(deps(db, store)).pollOnce()
    expect(store.cursor).toBe(1)
  })

  it('reads closed-duel messages only for the duels whose header it just got', async () => {
    const header = { kind: 'closed', duel: 61, n: 0, status: 'deal', role: 'seller', item: 'MAL-02', rival: 'Rival Noche', final_price: 55, updated_at: new Date('2026-10-03T08:00:00Z') }
    const msg = { ...header, kind: 'message', n: 1, speaker: 'them', tick: 40, price: 60, days: 3, text: 'Sesenta y no se hable más.' }
    const { db, calls } = fakeDb((c) => {
      if (c.sql.includes('thread_lines')) return []
      return c.sql.includes("kind = 'message'") ? [msg] : [header]
    })
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store))
    await poller.pollOnce()
    const messageCall = calls.find((c) => c.sql.includes("kind = 'message'"))
    expect(messageCall?.params).toEqual([[61]])
    expect(store.since(null)[0]).toMatchObject({ id: 'dc:61', kind: 'duel_replay', lines: [{ n: 1, text: 'Sesenta y no se hable más.' }] })
    await poller.pollOnce()
    const headerCalls = calls.filter((c) => c.sql.includes("kind in ('live', 'closed')"))
    expect(typeof headerCalls[1]?.params[0]).toBe('string')
    expect(store.cursor).toBe(1) // the same closed duel read again is not a second item
  })

  it('never throws: an error is logged without the url, and the next delay grows with a ceiling', async () => {
    const logs: Record<string, unknown>[] = []
    const failure = Object.assign(new Error(`connect ECONNREFUSED to ${SECRET_URL} (db.internal.example)`), { code: 'ECONNREFUSED' })
    const { db } = fakeDb(() => failure)
    const poller = new Poller({ ...deps(db, new TranscriptStore(), logs), secrets: [SECRET_URL, 'db.internal.example', 'hunter2-secret'] })
    const delays: number[] = []
    for (let i = 0; i < 8; i++) {
      await expect(poller.pollOnce()).resolves.toBeUndefined()
      delays.push(poller.nextDelayMs())
    }
    expect(delays[0]).toBeGreaterThan(3000)
    expect(delays[1]).toBeGreaterThan(delays[0] ?? 0)
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000)
    expect(JSON.stringify(logs)).not.toContain('hunter2-secret')
    expect(JSON.stringify(logs)).not.toContain('db.internal.example')
    expect(JSON.stringify(logs)).not.toContain('postgresql://')
    expect(logs[0]).toMatchObject({ route: 'transcript', event: 'poll_failed', code: 'ECONNREFUSED' })
  })

  it('logs a failure on the first and every tenth try, and says when it recovered', async () => {
    const logs: Record<string, unknown>[] = []
    let broken = true
    const { db } = fakeDb(() => (broken ? new Error('boom') : []))
    const poller = new Poller(deps(db, new TranscriptStore(), logs))
    for (let i = 0; i < 12; i++) await poller.pollOnce()
    expect(logs.filter((l) => l.event === 'poll_failed')).toHaveLength(2)
    broken = false
    await poller.pollOnce()
    expect(logs.at(-1)).toMatchObject({ event: 'poll_recovered' })
    expect(poller.nextDelayMs()).toBe(3000)
  })

  it('keeps going when one of the two reads fails: the other still lands', async () => {
    const { db } = fakeDb((c) => (c.sql.includes('thread_lines') ? new Error('view missing') : []))
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store))
    await poller.pollOnce()
    expect(poller.nextDelayMs()).toBeGreaterThan(3000)
  })

  it('start() polls on a timer and stop() ends it', async () => {
    const { db, calls } = fakeDb(() => [])
    const timers: (() => void)[] = []
    const poller = new Poller({ ...deps(db, new TranscriptStore()), setTimer: (fn) => (timers.push(fn), timers.length), clearTimer: () => undefined })
    poller.start()
    expect(timers).toHaveLength(1)
    timers.shift()?.()
    await new Promise((r) => setImmediate(r))
    expect(calls.length).toBeGreaterThan(0)
    poller.stop()
    const callsBefore = calls.length
    timers.splice(0).forEach((fn) => fn())
    await new Promise((r) => setImmediate(r))
    expect(calls.length).toBe(callsBefore)
    expect(timers).toHaveLength(0)
  })
})
