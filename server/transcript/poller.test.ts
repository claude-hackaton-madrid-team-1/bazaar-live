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

const deps = (db: Db, store: TranscriptStore, logs: Record<string, unknown>[] = [], duels = false) => ({
  db, store, log: (e: Record<string, unknown>) => logs.push(e), random: () => 0.5, backfill: 40, cap: 100, idWindow: 1000, duels,
})

describe('Poller', () => {
  /** A fake view of thread lines that honours the three query shapes (backfill, after the mark, the look-back window). */
  const threadDb = (rows: () => Record<string, unknown>[]) =>
    fakeDb((c) => {
      if (!c.sql.includes('show.thread_lines')) return []
      const all = rows().sort((x, y) => Number(x.event_id) - Number(y.event_id))
      const id = (r: Record<string, unknown>) => Number(r.event_id)
      if (c.sql.includes('event_id <= $2')) {
        const inWindow = all.filter((r) => id(r) > (c.params[0] as number) && id(r) <= (c.params[1] as number))
        return (c.sql.includes('order by event_id desc') ? inWindow.reverse() : inWindow).slice(0, c.params[2] as number)
      }
      if (c.sql.includes('order by event_id desc')) return all.slice(-(c.params[0] as number))
      return all.filter((r) => id(r) > (c.params[0] as number)).slice(0, c.params[1] as number)
    })

  it('backfills the latest lines once (as history), then asks only for ids past its watermark', async () => {
    const rows = [threadRow(5), threadRow(6)]
    const { db, calls } = threadDb(() => rows)
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store))
    await poller.pollOnce()
    rows.push(threadRow(7))
    await poller.pollOnce()
    const threadCalls = calls.filter((c) => c.sql.includes('show.thread_lines'))
    expect(threadCalls[0]?.params).toEqual([40])
    expect(threadCalls[1]?.params).toEqual([6, 100]) // new rows: past the mark, capped
    expect(threadCalls[2]?.params).toEqual([0, 6, 100]) // the look-back: the window under the mark, floored at 0
    expect(store.since(null).map((i) => [i.id, i.history])).toEqual([['f5', true], ['f6', true], ['f7', false]])
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

  const closed = (duel: number, stamp = '2026-10-03T08:00:00.000000Z') => ({
    kind: 'closed', duel, n: 0, session: 2, status: 'deal', role: 'seller', item: 'MAL-02', rival: 'Rival Noche', final_price: 55, stamp,
  })
  const message = (duel: number) => ({ ...closed(duel), kind: 'message', n: 1, speaker: 'them', tick: 40, price: 60, days: 3, text: 'Sesenta y no se hable más.' })

  it('reads closed-duel messages only for the duels whose header it just got, and each duel once', async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.sql.includes('thread_lines')) return []
      return c.sql.includes("kind = 'message'") ? [message(61)] : [closed(61)]
    })
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store, [], true))
    await poller.pollOnce()
    expect(calls.find((c) => c.sql.includes("kind = 'message'"))?.params).toEqual([[61]])
    expect(store.since(null)[0]).toMatchObject({ id: 'dc:61', kind: 'duel_replay', lines: [{ n: 1, text: 'Sesenta y no se hable más.' }] })
    const messageCallsBefore = calls.filter((c) => c.sql.includes("kind = 'message'")).length
    await poller.pollOnce()
    const after = calls.filter((c) => c.sql.includes("kind = 'closed' and (updated_at"))
    expect(after[0]?.params).toEqual(['2026-10-03T08:00:00.000000Z', 61, 100]) // the keyset: exact stamp, duel, cap
    expect(calls.filter((c) => c.sql.includes("kind = 'message'")).length).toBe(messageCallsBefore) // already shown: not read again
    expect(store.cursor).toBe(1)
  })

  it('never reads a live duel: every duel query is for closed ones only', async () => {
    const { db, calls } = fakeDb(() => [])
    await new Poller(deps(db, new TranscriptStore(), [], true)).pollOnce()
    expect(calls.filter((x) => x.sql.includes('duel_lines')).length).toBeGreaterThan(0)
    for (const c of calls.filter((x) => x.sql.includes('duel_lines'))) expect(c.sql).not.toContain("'live'")
  })

  it('SHOW_DUELS off (the default): the duel view is never queried and no duel is ever served', async () => {
    const { db, calls } = fakeDb((c) => (c.sql.includes('duel_lines') ? [closed(61)] : []))
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store))
    for (let i = 0; i < 3; i++) await poller.pollOnce()
    expect(calls.some((c) => c.sql.includes('duel_lines'))).toBe(false)
    expect(store.cursor).toBe(0)
  })

  it('starts the duel keyset over every N polls, to find a duel the gate opened without touching its row', async () => {
    const all = [closed(1, '2026-10-03T08:00:00.000000Z')]
    const { db } = fakeDb((c) => {
      if (c.sql.includes('thread_lines') || c.sql.includes("kind = 'message'")) return []
      if (c.sql.includes('(updated_at, duel) >')) {
        const [stamp, duel, cap] = c.params as [string, number, number]
        return all.filter((r) => r.stamp > stamp || (r.stamp === stamp && r.duel > duel)).slice(0, cap)
      }
      return all.slice(0, 20)
    })
    const store = new TranscriptStore()
    const poller = new Poller({ ...deps(db, store, [], true), rescanEvery: 3 })
    await poller.pollOnce()
    all.unshift(closed(0, '2026-10-03T07:00:00.000000Z')) // opened by the gate later, with an OLD stamp
    await poller.pollOnce()
    expect(store.has('dc:0')).toBe(false)
    await poller.pollOnce() // the 3rd poll restarts from the top
    expect(store.has('dc:0')).toBe(true)
  })

  it('gets past 100 duels that share one updated_at (bazaar re-stamps every finished duel together)', async () => {
    const all = Array.from({ length: 150 }, (_, i) => closed(i + 1))
    const { db } = fakeDb((c) => {
      if (c.sql.includes('thread_lines')) return []
      if (c.sql.includes("kind = 'message'")) return []
      if (c.sql.includes('(updated_at, duel) >')) {
        const [stamp, duel, cap] = c.params as [string, number, number]
        return all.filter((r) => r.stamp > stamp || (r.stamp === stamp && r.duel > duel)).slice(0, cap)
      }
      return all.slice(0, 20)
    })
    const store = new TranscriptStore({ ring: 1000 })
    const poller = new Poller(deps(db, store, [], true))
    for (let i = 0; i < 4; i++) await poller.pollOnce()
    expect(store.since(0, 1000).filter((i) => i.kind === 'duel_replay')).toHaveLength(150)
    // A duel that closes later has a later stamp and is not shadowed by the 150 before it.
    all.push(closed(1150, '2026-10-03T08:00:05.000000Z'))
    await poller.pollOnce()
    expect(store.since(0, 1000).some((i) => i.id === 'dc:1150')).toBe(true)
  })

  it('re-reads a trailing id window in a second query, so a gap-fill inserted after a newer id is not lost', async () => {
    const rows = [threadRow(9_000_002)]
    const { db } = threadDb(() => rows)
    const store = new TranscriptStore()
    const poller = new Poller(deps(db, store))
    await poller.pollOnce() // backfill sees only the newer streamed event
    rows.push(threadRow(9_000_001)) // the monitor's gap-fill (an older id) lands later
    await poller.pollOnce()
    expect(store.since(null).map((i) => i.id).sort()).toEqual(['f9000001', 'f9000002'])
  })

  it('reads the look-back newest first, so a late gap-fill near the mark is never cut by the cap', async () => {
    const rows = [900, 901, 902, 903, 904, 1000].map((id) => threadRow(id))
    const { db } = threadDb(() => rows)
    const store = new TranscriptStore({ ring: 100 })
    const poller = new Poller({ ...deps(db, store), cap: 3 })
    await poller.pollOnce() // the backfill: the mark is 1000
    rows.push(threadRow(998)) // inserted late, just under the mark
    await poller.pollOnce() // the window holds 7 rows; an oldest-first look would return 900..902 and miss it
    expect(store.has('f998')).toBe(true)
  })

  it('drains a burst bigger than the cap, and the look-back cannot starve the new rows', async () => {
    const rows = [threadRow(1)]
    const { db } = threadDb(() => rows)
    const store = new TranscriptStore({ ring: 1000 })
    const poller = new Poller({ ...deps(db, store), cap: 200 })
    await poller.pollOnce()
    for (let id = 2; id <= 251; id++) rows.push(threadRow(id)) // 250 of ours in one tick
    await poller.pollOnce()
    await poller.pollOnce()
    rows.push(threadRow(252)) // a later row, after the burst
    await poller.pollOnce()
    const ids = store.since(0, 1000).map((i) => i.id)
    expect(ids).toHaveLength(252)
    expect(ids).toContain('f252')
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
