import { describe, expect, it } from 'vitest'
import type { Timers } from '../net/feed'
import type { SourceLike } from '../net/transcript'
import { GameFeed, parseEvents, type GameFeedStatus } from './feed'

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

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const flush = () => new Promise((r) => setTimeout(r, 0))
const ev = (id: number, type = 'settlement') => ({ id, tick: 1, type, payload: {} })

function setup(info: () => Promise<Response> = () => json({ enabled: true, target: 'real', tokenRequired: false }), token: string | null = null) {
  const sources: FakeSource[] = []
  const timers = new FakeTimers()
  const got: { ids: number[]; replay: boolean }[] = []
  const statuses: GameFeedStatus[] = []
  const feed = new GameFeed({
    url: '/api/game',
    token,
    onEvents: (events, replay) => got.push({ ids: events.map((e) => e.id), replay }),
    onStatus: (s) => statuses.push(s),
    createSource: (url) => {
      const source = new FakeSource(url)
      sources.push(source)
      return source
    },
    fetchImpl: (() => info()) as unknown as typeof fetch,
    timers,
    random: () => 0.5,
  })
  return { feed, sources, timers, got, statuses }
}

describe('parseEvents', () => {
  it('keeps objects with a numeric id and a string type, drops the rest', () => {
    expect(parseEvents(JSON.stringify([ev(1), { id: 'x', type: 'a' }, null, { id: 2 }, { id: 3, type: 'clock', payload: 4 }, ev(-1, 'clock')])).map((e) => e.id)).toEqual([1, -1])
    expect(parseEvents('not json')).toEqual([])
    expect(parseEvents(JSON.stringify({ id: 1 }))).toEqual([])
    expect(parseEvents(42)).toEqual([])
  })
})

describe('GameFeed', () => {
  it('opens the stream when the relay is on, and the first batch after an open is a replay', async () => {
    const { feed, sources, got, statuses } = setup()
    feed.start()
    await flush()
    expect(sources).toHaveLength(1)
    expect(sources[0]!.url).toBe('/api/game/stream')
    sources[0]!.open()
    sources[0]!.emit('events', [ev(-1, 'agent.hello'), ev(5)])
    sources[0]!.emit('events', [ev(6)])
    expect(got).toEqual([
      { ids: [-1, 5], replay: true },
      { ids: [6], replay: false },
    ])
    expect(statuses).toEqual(['connecting', 'live'])
    feed.stop()
    expect(sources[0]!.closed).toBe(true)
  })

  it('a reconnect starts again from a replay', async () => {
    const { feed, sources, timers, got } = setup()
    feed.start()
    await flush()
    sources[0]!.emit('events', [ev(1)])
    sources[0]!.fail()
    expect(sources[0]!.closed).toBe(true)
    timers.advance(20_000)
    await flush()
    expect(sources).toHaveLength(2)
    sources[1]!.emit('events', [ev(1), ev(2)])
    expect(got.map((g) => g.replay)).toEqual([true, true])
    feed.stop()
  })

  it('says off and opens nothing while the server has no key, then looks again', async () => {
    let enabled = false
    const { feed, sources, timers, statuses } = setup(() => json({ enabled, target: null, tokenRequired: false }))
    feed.start()
    await flush()
    expect(sources).toHaveLength(0)
    expect(statuses.at(-1)).toBe('off')
    enabled = true
    timers.advance(120_000)
    await flush()
    expect(sources).toHaveLength(1)
    feed.stop()
  })

  it('stays locked without a token when the server asks for one, and sends it when given', async () => {
    const locked = setup(() => json({ enabled: true, target: 'real', tokenRequired: true }))
    locked.feed.start()
    await flush()
    expect(locked.sources).toHaveLength(0)
    expect(locked.statuses.at(-1)).toBe('locked')
    locked.feed.stop()

    const open = setup(() => json({ enabled: true, target: 'real', tokenRequired: true }), 'a b&c')
    open.feed.start()
    await flush()
    expect(open.sources[0]!.url).toBe('/api/game/stream?token=a%20b%26c')
    open.feed.stop()
  })

  it('replaces a stream that went quiet, and a heartbeat keeps it', async () => {
    const { feed, sources, timers } = setup()
    feed.start()
    await flush()
    timers.advance(40_000)
    sources[0]!.emit('hb', '1')
    timers.advance(40_000)
    expect(sources[0]!.closed).toBe(false)
    timers.advance(10_000)
    expect(sources[0]!.closed).toBe(true)
    feed.stop()
  })

  it('retries when /api/game cannot be read', async () => {
    let fail = true
    const { feed, sources, timers, statuses } = setup(() => (fail ? Promise.reject(new Error('down')) : json({ enabled: true, tokenRequired: false })))
    feed.start()
    await flush()
    expect(statuses.at(-1)).toBe('reconnecting')
    fail = false
    timers.advance(20_000)
    await flush()
    expect(sources).toHaveLength(1)
    feed.stop()
  })
})
