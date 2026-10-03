import { describe, expect, it } from 'vitest'
import type { ShowEvent } from '../../src/model/events.ts'
import { FIRST_PAGES_ID, PageNotices, startPages, WAKES, Waker, type LiveEvent, type PagePoller, type Timers } from './pages.ts'
import { GameHub, type GameEvent } from './relay.ts'

function fakeTimers(): Timers & { pending: Map<number, { fn: () => void; ms: number }>; run: (ms: number) => void } {
  const pending = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  return {
    pending,
    setTimeout: (fn, ms) => (pending.set(next, { fn, ms }), next++),
    clearTimeout: (h) => pending.delete(h as number),
    run: (ms) => {
      for (const [h, t] of [...pending]) {
        if (t.ms !== ms) continue
        pending.delete(h)
        t.fn()
      }
    },
  }
}

const base = { key: 'k', id: -1, tick: 10, t: 1 }
const tick = (agent: 'taker' | 'maker'): LiveEvent => ({ agent, kind: 'tick', event: { ...base, agent, type: 'agent.tick', mode: 'live' } })
const exec = (method: string, agent: 'taker' | 'maker' = 'taker'): LiveEvent => ({
  agent,
  kind: 'execution',
  event: { ...base, agent, type: 'agent.execution', execution: { decisionId: 7, tick: 10, method, ok: true, errorCode: null, createdId: null, request: {} } } as ShowEvent,
})

class FakePoller implements PagePoller {
  pokes = 0
  readonly listeners = new Set<(at: string) => void>()
  poke(): boolean {
    this.pokes += 1
    return true
  }
  onChange(listener: (at: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  change(at: string): void {
    this.listeners.forEach((l) => l(at))
  }
}

class FakeAgents {
  readonly listeners = new Set<(e: LiveEvent) => void>()
  onEvent(listener: (e: LiveEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(e: LiveEvent): void {
    this.listeners.forEach((l) => l(e))
  }
}

describe('WAKES', () => {
  it('history reads after any execution and after the taker\'s tick; learn after a thread\'s execution and the taker\'s tick', () => {
    expect(WAKES.history(exec('list_offer', 'maker'))).toEqual([250, 2_500])
    expect(WAKES.history(tick('taker'))).toEqual([250, 5_000])
    expect(WAKES.history(tick('maker'))).toEqual([])
    expect(WAKES.learn(exec('close_thread'))).toEqual([1_500, 5_000])
    expect(WAKES.learn(exec('list_offer', 'maker'))).toEqual([])
    expect(WAKES.learn(tick('taker'))).toEqual([5_000])
    // the strategy also follows the taker's refusals, decided early in its tick and never on a socket
    expect(WAKES.strategy(tick('taker'))).toEqual([250, 2_500, 5_000])
    expect(WAKES.strategy(tick('maker'))).toEqual([])
    expect(WAKES.strategy(exec('cancel', 'maker'))).toEqual([250, 2_500])
    // the rivals come from the feed archive, caught up a few seconds after the taker's tick
    expect(WAKES.rivals(tick('taker'))).toEqual([5_000])
    expect(WAKES.rivals(tick('maker'))).toEqual([])
    expect(WAKES.rivals(exec('accept'))).toEqual([])
  })
})

describe('Waker', () => {
  it('a burst shares one read per delay', () => {
    const timers = fakeTimers()
    let pokes = 0
    const waker = new Waker(() => (pokes += 1), timers)
    waker.ring([250, 2_500])
    waker.ring([250, 2_500])
    expect(timers.pending.size).toBe(2)
    timers.run(250)
    expect(pokes).toBe(1)
    waker.ring([250])
    timers.run(250)
    timers.run(2_500)
    expect(pokes).toBe(3)
    waker.ring([250])
    waker.stop()
    expect(timers.pending.size).toBe(0)
  })
})

describe('PageNotices', () => {
  it('publishes when each screen last changed as one sticky status, ids counting down', () => {
    const sent: GameEvent[] = []
    const notices = new PageNotices({ publishStatus: (e) => sent.push(e) }, () => undefined)
    notices.changed('history', '2026-10-03T10:00:00.000Z')
    notices.changed('learn', '2026-10-03T10:00:01.000Z')
    expect(sent.map((e) => [e.id, e.type])).toEqual([[FIRST_PAGES_ID, 'pages.changed'], [FIRST_PAGES_ID - 1, 'pages.changed']])
    expect(sent[1]?.payload).toEqual({ history: '2026-10-03T10:00:00.000Z', learn: '2026-10-03T10:00:01.000Z' })
  })

  it('a page that connects later gets only the latest in the replay, never in the backlog', () => {
    const hub = new GameHub()
    const notices = new PageNotices(hub, () => undefined)
    notices.changed('history', 'a')
    notices.changed('learn', 'b')
    expect(hub.replay().filter((e) => e.type === 'pages.changed').map((e) => e.payload)).toEqual([{ history: 'a', learn: 'b' }])
    expect(hub.size).toBe(0)
  })

  it('a hub that throws is logged, never thrown', () => {
    const logs: Record<string, unknown>[] = []
    const notices = new PageNotices({ publishStatus: () => { throw new Error('x') } }, (e) => logs.push(e))
    expect(() => notices.changed('history', 'a')).not.toThrow()
    expect(logs[0]).toMatchObject({ event: 'publish_failed' })
  })
})

describe('startPages', () => {
  it('rings each screen\'s poller after its events and tells the stream when its rows change', () => {
    const timers = fakeTimers()
    const agents = new FakeAgents()
    const history = new FakePoller()
    const learn = new FakePoller()
    const sent: GameEvent[] = []
    const pages = startPages({}, { hub: { publishStatus: (e) => sent.push(e) }, agents, pollers: { history, learn }, log: () => undefined, timers })
    agents.emit(exec('list_offer', 'maker'))
    timers.run(250)
    timers.run(2_500)
    expect([history.pokes, learn.pokes]).toEqual([2, 0])
    agents.emit(exec('close_thread'))
    timers.run(1_500)
    expect(learn.pokes).toBe(1)
    history.change('2026-10-03T10:00:00.000Z')
    expect(sent.at(-1)?.payload).toEqual({ history: '2026-10-03T10:00:00.000Z' })
    pages.stop()
    expect(timers.pending.size).toBe(0)
    expect(agents.listeners.size).toBe(0)
    history.change('later')
    expect(sent).toHaveLength(1)
  })

  it('PAGES_WAKE=off keeps the notices but never reads early; no hub, no notices; no screen, nothing', () => {
    const agents = new FakeAgents()
    const history = new FakePoller()
    const sent: GameEvent[] = []
    startPages({ PAGES_WAKE: 'off' }, { hub: { publishStatus: (e) => sent.push(e) }, agents, pollers: { history }, log: () => undefined, timers: fakeTimers() })
    expect(agents.listeners.size).toBe(0)
    history.change('at')
    expect(sent).toHaveLength(1)
    const quiet = new FakePoller()
    startPages({}, { hub: null, agents, pollers: { history: quiet, learn: null }, log: () => undefined, timers: fakeTimers() })
    expect(quiet.listeners.size).toBe(0)
    expect(agents.listeners.size).toBe(1)
  })
})
