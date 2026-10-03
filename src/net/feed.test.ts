import { describe, expect, it } from 'vitest'
import type { ShowEvent } from '../model/events'
import { backoffDelay } from './backoff'
import { EventFeed, type FeedStatus, type SocketLike, type Timers } from './feed'

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  closed = false
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  close(): void {
    this.closed = true
  }
  open(): void {
    this.onopen?.({})
  }
  send(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  drop(): void {
    this.onerror?.({})
    this.onclose?.({})
  }
}

/** A manual clock: timers fire only when the test advances time. */
class FakeTimers implements Timers {
  time = 0
  private tasks: { at: number; fn: () => void; id: number }[] = []
  private next = 1
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++
    this.tasks.push({ at: this.time + ms, fn, id })
    return id
  }
  clearTimeout(handle: unknown): void {
    this.tasks = this.tasks.filter((t) => t.id !== handle)
  }
  now(): number {
    return this.time
  }
  advance(ms: number): void {
    const end = this.time + ms
    for (;;) {
      const due = this.tasks.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.tasks = this.tasks.filter((t) => t !== due)
      this.time = due.at
      due.fn()
    }
    this.time = end
  }
  pending(): number[] {
    return this.tasks.map((t) => t.at - this.time)
  }
}

const decision = (id: number, tick = 1) => ({ id, tick, t: tick / 100, type: 'agent.decision', agent: 'maker', payload: { kind: 'post_ask', status: 'approved', dry_run: false, inputs: { ref: 'LAT-09' } } })

function setup() {
  const timers = new FakeTimers()
  const sockets: FakeSocket[] = []
  const events: { e: ShowEvent; replay: boolean }[] = []
  const statuses: FeedStatus[] = []
  const feed = new EventFeed({
    url: 'wss://maker/events',
    agent: 'maker',
    timers,
    random: () => 0.5,
    replayWindowMs: 1000,
    stableAfterMs: 5000,
    createSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    onEvent: (e, replay) => events.push({ e, replay }),
    onStatus: (s) => statuses.push(s),
  })
  const last = () => sockets[sockets.length - 1]!
  return { timers, sockets, events, statuses, feed, last }
}

describe('EventFeed', () => {
  it('flags the join burst as replay and later events as live', () => {
    const { feed, last, timers, events } = setup()
    feed.start()
    last().open()
    last().send(decision(-1))
    last().send(decision(-2))
    timers.advance(1500)
    last().send(decision(-3, 2))
    expect(events.map((x) => [x.e.id, x.replay])).toEqual([
      [-1, true],
      [-2, true],
      [-3, false],
    ])
  })

  it('drops duplicates, including the replay after a reconnect', () => {
    const { feed, last, timers, events, sockets } = setup()
    feed.start()
    last().open()
    last().send(decision(-1))
    last().send(decision(-1))
    timers.advance(2000)
    last().send(decision(-2, 2))
    last().drop()
    timers.advance(10_000)
    expect(sockets.length).toBe(2)
    last().open()
    // The agent replays its buffer: two known events and one we missed while away.
    last().send(decision(-1))
    last().send(decision(-2, 2))
    last().send(decision(-3, 3))
    expect(events.map((x) => [x.e.id, x.replay])).toEqual([
      [-1, true],
      [-2, false],
      [-3, true],
    ])
  })

  it('tells a restarted agent (ids from -1 again, later tick) apart from a duplicate', () => {
    const { feed, last, events } = setup()
    feed.start()
    last().open()
    last().send(decision(-1, 10))
    last().send(decision(-1, 55))
    expect(events.length).toBe(2)
  })

  it('reconnects with growing, capped backoff and resets once stable', () => {
    const { feed, last, timers, sockets, statuses } = setup()
    feed.start()
    last().drop()
    expect(timers.pending()).toEqual([backoffDelay(0, undefined, () => 0.5)])
    timers.advance(timers.pending()[0]!)
    last().drop()
    expect(timers.pending()).toEqual([backoffDelay(1, undefined, () => 0.5)])
    timers.advance(timers.pending()[0]!)
    expect(sockets.length).toBe(3)
    last().open()
    timers.advance(5000)
    last().drop()
    expect(timers.pending()).toEqual([backoffDelay(0, undefined, () => 0.5)])
    expect(statuses).toContain('reconnecting')
    expect(statuses).toContain('open')
  })

  it('stops for good on stop() and ignores a stale socket', () => {
    const { feed, last, timers, sockets, events } = setup()
    feed.start()
    const first = last()
    first.open()
    feed.stop()
    expect(first.closed).toBe(true)
    first.send(decision(-9))
    timers.advance(60_000)
    expect(sockets.length).toBe(1)
    expect(events.length).toBe(0)
    expect(feed.currentStatus).toBe('stopped')
  })

  it('counts bad messages and events from another agent without crashing', () => {
    const { feed, last } = setup()
    feed.start()
    last().open()
    last().onmessage?.({ data: '{not json' })
    last().send({ ...decision(-1), agent: 'taker' })
    expect(feed.rejected).toBe(2)
  })
})

describe('backoffDelay', () => {
  it('doubles from 500 ms up to 15 s, with jitter in [step/2, step]', () => {
    expect(backoffDelay(0, undefined, () => 0)).toBe(250)
    expect(backoffDelay(0, undefined, () => 1)).toBe(500)
    expect(backoffDelay(3, undefined, () => 1)).toBe(4000)
    expect(backoffDelay(20, undefined, () => 1)).toBe(15_000)
  })
})

describe('EventFeed on a slow network', () => {
  it('keeps a slow replay burst as history, then goes live after the first real gap', () => {
    const { feed, last, timers, events } = setup()
    feed.start()
    last().open()
    for (let i = 1; i <= 10; i += 1) {
      last().send(decision(-i, i))
      timers.advance(300) // 3 s of replay, longer than the 1 s window, but never a 400 ms gap
    }
    timers.advance(2000)
    last().send(decision(-11, 11))
    expect(events.filter((x) => x.replay).length).toBe(10)
    expect(events.at(-1)).toMatchObject({ replay: false })
  })

  it('replaces a socket that went silent (half-open) without waiting for a close', () => {
    const timers = new FakeTimers()
    const sockets: FakeSocket[] = []
    const feed = new EventFeed({
      url: 'wss://maker/events',
      agent: 'maker',
      timers,
      idleMs: 60_000,
      random: () => 0.5,
      createSocket: (url) => {
        const s = new FakeSocket(url)
        sockets.push(s)
        return s
      },
      onEvent: () => undefined,
    })
    feed.start()
    sockets[0]!.open()
    timers.advance(59_000)
    sockets[0]!.send(decision(-1))
    timers.advance(59_000)
    expect(sockets.length).toBe(1)
    timers.advance(2000)
    expect(sockets[0]!.closed).toBe(true)
    timers.advance(1000)
    expect(sockets.length).toBe(2)
    feed.stop()
  })
})
