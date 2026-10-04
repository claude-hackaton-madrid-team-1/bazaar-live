import { describe, expect, it } from 'vitest'
import type { Db } from './transcript/poller.ts'
import { ViewPoller, type ViewPollerDeps } from './view-poller.ts'

interface Snap {
  readonly at: string | null
  readonly parts: { readonly rows: boolean; readonly head: boolean }
  readonly rows: readonly number[]
  readonly head: number | null
}

const EMPTY: Snap = { at: null, parts: { rows: false, head: false }, rows: [], head: null }
const SQL = { rows: 'select n from rows limit $1', head: 'select n from head limit $1' }
const int = (raw: unknown): number | null => (typeof raw === 'object' && raw !== null && typeof (raw as { n?: unknown }).n === 'number' ? (raw as { n: number }).n : null)

/** Two parts; a new head alone is no change, like the rivals poller. */
class TestPoller extends ViewPoller<'rows' | 'head', Snap> {
  constructor(deps: ViewPollerDeps) {
    super({ route: 'test', empty: EMPTY, sql: SQL, caps: { rows: 10, head: 1 }, intervalMs: 1_000 }, deps)
  }

  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const read = this.begin()
    const rows = await this.view(read, 'rows', int, prev.rows)
    const head = (await this.view(read, 'head', int, prev.head === null ? [] : [prev.head]))[0] ?? null
    this.finish(read, { rows, head }, { rows })
  }
}

describe('ViewPoller', () => {
  it('tells listeners only when the signature moves, with the parts in it', async () => {
    let rows = [{ n: 1 }]
    let head = 7
    let missing = false
    const db: Db = {
      query: (sql) => {
        if (sql === SQL.head) return Promise.resolve({ rows: [{ n: head }] })
        return missing ? Promise.reject(Object.assign(new Error('no view'), { code: '42P01' })) : Promise.resolve({ rows })
      },
    }
    let t = 0
    const poller = new TestPoller({ db, log: () => undefined, now: () => new Date(Date.UTC(2026, 9, 4, 10, 0, t++)) })
    const seen: string[] = []
    poller.onChange((at) => seen.push(at))
    await poller.pollOnce()
    head = 8
    await poller.pollOnce()
    expect(poller.current()).toMatchObject({ at: '2026-10-04T10:00:01.000Z', head: 8, rows: [1] })
    rows = [{ n: 1 }, { n: 2 }]
    await poller.pollOnce()
    // the rows read empty either way, but the part went missing: that is a change
    missing = true
    rows = []
    await poller.pollOnce()
    expect(seen).toEqual(['2026-10-04T10:00:00.000Z', '2026-10-04T10:00:02.000Z', '2026-10-04T10:00:03.000Z'])
    expect(poller.current().parts).toEqual({ rows: false, head: true })
  })

  it('a stop and start during a read keeps one timer going, not two', async () => {
    const timers: { fn: () => void; ms: number }[] = []
    let release: (() => void) | null = null
    let calls = 0
    const db: Db = {
      query: () => {
        calls += 1
        return calls === 1 ? new Promise((resolve) => (release = () => resolve({ rows: [] }))) : Promise.resolve({ rows: [] })
      },
    }
    const poller = new TestPoller({ db, log: () => undefined, setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => undefined })
    poller.start()
    poller.stop()
    poller.start()
    ;(release as (() => void) | null)?.()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toBe(2)
    expect(timers).toHaveLength(1)
    poller.stop()
  })
})
