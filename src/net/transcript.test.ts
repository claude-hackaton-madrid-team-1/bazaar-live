import { describe, expect, it } from 'vitest'
import { EMPTY_ITEM, type TranscriptBatch, type TranscriptItem } from '../../shared/transcript.ts'
import { TranscriptFeed, type SourceLike, type TranscriptStatus } from './transcript'
import type { Timers } from './feed'

class FakeSource implements SourceLike {
  onopen: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  closed = false
  private readonly handlers = new Map<string, (ev: { data: unknown }) => void>()
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  addEventListener(type: string, fn: (ev: { data: unknown }) => void): void {
    this.handlers.set(type, fn)
  }
  close(): void {
    this.closed = true
  }
  open(): void {
    this.onopen?.({})
  }
  emit(type: string, data: unknown): void {
    this.handlers.get(type)?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  fail(): void {
    this.onerror?.({})
  }
}

class FakeTimers implements Timers {
  now_ = 0
  private seq = 0
  readonly pending = new Map<number, { at: number; fn: () => void }>()
  setTimeout(fn: () => void, ms: number): unknown {
    this.seq += 1
    this.pending.set(this.seq, { at: this.now_ + ms, fn })
    return this.seq
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number)
  }
  now(): number {
    return this.now_
  }
  advance(ms: number): void {
    const until = this.now_ + ms
    for (;;) {
      const next = [...this.pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      this.pending.delete(next[0])
      this.now_ = next[1].at
      next[1].fn()
    }
    this.now_ = until
  }
}

const item = (id: string, seq: number): TranscriptItem => ({ ...EMPTY_ITEM, id, seq, who: 'them', text: `line ${id}` })
const batch = (items: TranscriptItem[], extra: Partial<TranscriptBatch> = {}): TranscriptBatch => ({ epoch: 'e1', cursor: items.at(-1)?.seq ?? 0, enabled: true, replay: false, items, ...extra })
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(snapshot: () => Promise<Response> = () => json(batch([], { replay: true }))) {
  const sources: FakeSource[] = []
  const timers = new FakeTimers()
  const got: { ids: string[]; replay: boolean }[] = []
  const statuses: TranscriptStatus[] = []
  const urls: string[] = []
  const feed = new TranscriptFeed({
    url: '/api/transcript',
    onItems: (items, replay) => got.push({ ids: items.map((i) => i.id), replay }),
    onStatus: (s) => statuses.push(s),
    createSource: (url) => {
      const source = new FakeSource(url)
      sources.push(source)
      return source
    },
    fetchImpl: ((url: string) => (urls.push(String(url)), snapshot())) as unknown as typeof fetch,
    timers,
    random: () => 0.5,
  })
  return { feed, sources, timers, got, statuses, urls }
}

describe('TranscriptFeed', () => {
  it('asks first whether the feature is on, takes the history as replay, then opens the stream after its cursor', async () => {
    const t = setup(() => json(batch([item('a', 1), item('b', 2)], { replay: true })))
    t.feed.start()
    await flush()
    expect(t.urls).toEqual(['/api/transcript'])
    expect(t.got).toEqual([{ ids: ['a', 'b'], replay: true }])
    expect(t.sources[0]?.url).toBe('/api/transcript/stream?since=2&epoch=e1')
    t.sources[0]?.open()
    expect(t.statuses.at(-1)).toBe('open')
    t.feed.stop()
  })

  it('hands live batches to the page as live, and history batches as replay', async () => {
    const t = setup()
    t.feed.start()
    await flush()
    t.sources[0]?.open()
    t.sources[0]?.emit('items', batch([item('c', 1)]))
    t.sources[0]?.emit('items', batch([item('d', 2)], { replay: true }))
    expect(t.got).toEqual([{ ids: ['c'], replay: false }, { ids: ['d'], replay: true }])
    t.feed.stop()
  })

  it('drops duplicates by id, also across a reconnect', async () => {
    const t = setup()
    t.feed.start()
    await flush()
    t.sources[0]?.emit('items', batch([item('a', 1), item('a', 1), item('b', 2)]))
    t.sources[0]?.fail()
    t.timers.advance(20_000)
    await flush()
    expect(t.sources).toHaveLength(2)
    t.sources[1]?.emit('items', batch([item('b', 2), item('c', 3)], { replay: true }))
    expect(t.got.map((g) => g.ids)).toEqual([['a', 'b'], ['c']])
    t.feed.stop()
  })

  it('reconnects with backoff, resuming from the last cursor it saw', async () => {
    const t = setup()
    t.feed.start()
    await flush()
    t.sources[0]?.emit('items', batch([item('a', 7)]))
    t.sources[0]?.fail()
    expect(t.sources[0]?.closed).toBe(true)
    expect(t.statuses.at(-1)).toBe('reconnecting')
    t.timers.advance(100)
    expect(t.sources).toHaveLength(1) // still waiting: the first delay is at least 250 ms
    t.timers.advance(2000)
    await flush()
    expect(t.sources).toHaveLength(2)
    expect(t.sources[1]?.url).toBe('/api/transcript/stream?since=7&epoch=e1')
    t.feed.stop()
  })

  it('treats a silent stream as dead and replaces it (the server sends hb events)', async () => {
    const t = setup()
    t.feed.start()
    await flush()
    t.sources[0]?.open()
    t.timers.advance(40_000)
    t.sources[0]?.emit('hb', '1')
    t.timers.advance(40_000)
    expect(t.sources).toHaveLength(1) // the hb kept it alive
    t.timers.advance(40_000)
    t.timers.advance(5_000)
    await flush()
    expect(t.sources.length).toBeGreaterThan(1)
    t.feed.stop()
  })

  it('stays off, without opening a stream, when the server has no database', async () => {
    const t = setup(() => json(batch([], { enabled: false })))
    t.feed.start()
    await flush()
    expect(t.sources).toHaveLength(0)
    expect(t.statuses.at(-1)).toBe('off')
    t.feed.stop()
  })

  it('asks again later when the first question fails, and never throws', async () => {
    let calls = 0
    const t = setup(() => (++calls === 1 ? Promise.reject(new Error('offline')) : json(batch([item('a', 1)], { replay: true }))))
    t.feed.start()
    await flush()
    expect(t.statuses.at(-1)).toBe('reconnecting')
    t.timers.advance(2000)
    await flush()
    expect(t.got).toEqual([{ ids: ['a'], replay: true }])
    t.feed.stop()
  })

  it('ignores garbage on the stream', async () => {
    const t = setup()
    t.feed.start()
    await flush()
    t.sources[0]?.emit('items', 'not json')
    t.sources[0]?.emit('items', { epoch: 1 })
    expect(t.got).toEqual([])
    expect(t.feed.rejected).toBe(2)
    t.feed.stop()
  })

  it('stop() closes the stream and cancels every timer', async () => {
    const t = setup()
    t.feed.start()
    await flush()
    t.feed.stop()
    expect(t.sources[0]?.closed).toBe(true)
    expect(t.timers.pending.size).toBe(0)
    expect(t.statuses.at(-1)).toBe('stopped')
  })

  it('forgets a cursor from another epoch', async () => {
    let asked = 0
    const t = setup(() => json(asked++ === 0 ? batch([], { replay: true }) : batch([], { epoch: 'new', cursor: 1 })))
    t.feed.start()
    await flush()
    t.sources[0]?.emit('items', batch([item('a', 50)], { epoch: 'old' }))
    t.sources[0]?.emit('items', batch([item('z', 1)], { epoch: 'new', cursor: 1 }))
    t.sources[0]?.fail()
    t.timers.advance(20_000)
    await flush()
    expect(t.sources[1]?.url).toBe('/api/transcript/stream?since=1&epoch=new')
    t.feed.stop()
  })
})
