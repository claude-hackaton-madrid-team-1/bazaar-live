import { describe, expect, it } from 'vitest'
import type { SocketLike, Timers } from '../../src/net/feed.ts'
import { AgentsWs, startAgentsWs, wsUrls, type LiveEvent, type ReadReason } from './agentsws.ts'
import { GameHub } from './relay.ts'

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
    this.onclose?.({})
  }
}

/** A manual clock: timers fire only when the test advances time. */
class FakeTimers implements Timers {
  time = 1_000_000
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
}

type Agent = 'taker' | 'maker'
const ids = { taker: 0, maker: 0 }
const envelope = (agent: Agent, type: string, tick: number, payload: Record<string, unknown> = {}) => {
  ids[agent] -= 1
  return { id: ids[agent], tick, t: tick / 100, type, scope: 'team', actor: 't01', agent, payload: { ...payload, agent } }
}
const tick = (agent: Agent, n: number) => envelope(agent, 'agent.tick', n, { mode: 'live' })
const decision = (agent: Agent, n: number, id: number) => envelope(agent, 'agent.decision', n, {
  decision_id: id, tick: n, kind: 'accept_ask', status: 'approved', chosen: true, dry_run: false, inputs: { ref: 'LAV-08' },
})
const execution = (agent: Agent, n: number, id: number) => envelope(agent, 'agent.execution', n, { decision_id: id, tick: n, method: 'accept', request: { offer: 7 }, ok: true })

function setup(opts: { hub?: GameHub } = {}) {
  const timers = new FakeTimers()
  const sockets: Record<Agent, FakeSocket[]> = { taker: [], maker: [] }
  const logs: Record<string, unknown>[] = []
  const ws = new AgentsWs({
    urls: { taker: 'wss://taker/events', maker: 'wss://maker/events' },
    log: (e) => logs.push(e),
    hub: opts.hub ?? null,
    timers,
    random: () => 0.5,
    createSocket: (url) => {
      const s = new FakeSocket(url)
      sockets[url.includes('taker') ? 'taker' : 'maker'].push(s)
      return s
    },
  })
  const reads: ReadReason[] = []
  ws.onRead((r) => reads.push(r))
  const last = (a: Agent): FakeSocket => sockets[a].at(-1) as FakeSocket
  return { ws, timers, sockets, last, logs, reads }
}

describe('AgentsWs: replay never rings', () => {
  it('reads nothing for the 200-event replay on connect, then once for a live event', () => {
    const { ws, timers, last, reads } = setup()
    ws.start()
    last('taker').open()
    last('maker').open()
    // The agents' ring: their last 200 events, all at once on connect.
    for (let i = 0; i < 200; i += 1) {
      last('taker').send(i % 10 === 0 ? decision('taker', 600 + i, 9000 + i) : tick('taker', 600 + i))
      last('maker').send(tick('maker', 600 + i))
      timers.advance(2)
    }
    timers.advance(3000)
    expect(reads).toEqual([])
    expect(ws.reads).toBe(0)
    expect(ws.sockets().taker.lastEventAt).toBeNull()

    last('taker').send(tick('taker', 900))
    timers.advance(249)
    expect(reads).toEqual([])
    timers.advance(1)
    expect(reads).toEqual(['event'])
  })

  it('reads nothing for the replay after a reconnect either, even with events it had not seen', () => {
    const { ws, timers, last, reads, sockets } = setup()
    ws.start()
    last('taker').open()
    last('maker').open()
    const history = Array.from({ length: 200 }, (_, i) => tick('taker', 100 + i))
    for (const e of history) last('taker').send(e)
    timers.advance(5000)
    expect(reads).toEqual([])

    last('taker').drop()
    expect(ws.sockets().taker.state).toBe('reconnecting')
    timers.advance(1000) // the backoff
    expect(sockets.taker).toHaveLength(2)
    last('taker').open()
    // The ring again: 195 already seen, 5 new ones that happened while we were away.
    for (const e of [...history.slice(5), ...Array.from({ length: 5 }, (_, i) => decision('taker', 300 + i, 50 + i))]) last('taker').send(e)
    timers.advance(5000)
    expect(reads).toEqual([])
    expect(ws.sockets().taker.state).toBe('open')
  })
})

describe('AgentsWs: live events', () => {
  function live() {
    const s = setup()
    s.ws.start()
    s.last('taker').open()
    s.last('maker').open()
    s.timers.advance(5000) // past the replay window
    return s
  }

  it('gives both agents\' ticks of one turn a single read', () => {
    const { timers, last, reads } = live()
    last('taker').send(tick('taker', 700))
    timers.advance(150)
    last('maker').send(tick('maker', 700))
    timers.advance(1000)
    expect(reads).toEqual(['event'])
  })

  it('does not let a stream of events push the read back: 250 ms after the first one', () => {
    const { timers, last, reads } = live()
    for (let i = 0; i < 10; i += 1) {
      last('taker').send(tick('taker', 700 + i))
      timers.advance(100)
    }
    // 1000 ms of events every 100 ms: a read at 250, 500 (well: 250 after the first of each burst), never starved.
    expect(reads.length).toBeGreaterThanOrEqual(3)
    expect(reads.every((r) => r === 'event')).toBe(true)
  })

  it('follows a decision or an execution with one more read ~750 ms later (its settle, the feed)', () => {
    const { timers, last, reads } = live()
    last('taker').send(decision('taker', 701, 77))
    timers.advance(100)
    last('taker').send(execution('taker', 701, 77))
    timers.advance(249)
    expect(reads).toEqual(['event'])
    timers.advance(400)
    expect(reads).toEqual(['event'])
    timers.advance(1)
    expect(reads).toEqual(['event', 'follow_up'])
    timers.advance(5000)
    expect(reads).toEqual(['event', 'follow_up'])
  })

  it('a tick alone gets no follow-up', () => {
    const { timers, last, reads } = live()
    last('maker').send(tick('maker', 702))
    timers.advance(5000)
    expect(reads).toEqual(['event'])
  })

  it('tells onEvent listeners each live event (agent, kind, tick, decision id), never a replayed one', () => {
    const s = setup()
    const seen: LiveEvent[] = []
    const off = s.ws.onEvent((e) => seen.push(e))
    s.ws.onEvent(() => {
      throw new Error('a broken listener')
    })
    s.ws.start()
    s.last('maker').open()
    s.last('maker').send(tick('maker', 1)) // replay
    s.timers.advance(5000)
    s.last('maker').send(decision('maker', 710, 88))
    s.last('maker').send(execution('maker', 710, 88))
    s.last('maker').send(tick('maker', 711))
    expect(seen.map((e) => e.event.type)).toEqual(['agent.decision', 'agent.execution', 'agent.tick'])
    expect(seen.map(({ agent, kind, tick: t, decision: d }) => ({ agent, kind, tick: t, decision: d }))).toEqual([
      { agent: 'maker', kind: 'decision', tick: 710, decision: 88 },
      { agent: 'maker', kind: 'execution', tick: 710, decision: 88 },
      { agent: 'maker', kind: 'tick', tick: 711, decision: null },
    ])
    expect(s.logs.filter((l) => l.event === 'listener_failed')).toHaveLength(3)
    off()
    s.last('maker').send(tick('maker', 712))
    expect(seen).toHaveLength(3)
  })

  it('says each socket\'s state and its last live event', () => {
    const { ws, timers, last } = live()
    expect(ws.sockets()).toEqual({ taker: { state: 'open', lastEventAt: null }, maker: { state: 'open', lastEventAt: null } })
    last('maker').send(tick('maker', 720))
    const at = new Date(timers.now()).toISOString()
    last('taker').drop()
    expect(ws.sockets()).toEqual({ taker: { state: 'reconnecting', lastEventAt: null }, maker: { state: 'open', lastEventAt: at } })
    ws.stop()
    expect(ws.sockets().taker.state).toBe('stopped')
  })

  it('stops cleanly: no read after stop, sockets closed', () => {
    const { ws, timers, last, reads, sockets } = live()
    last('taker').send(decision('taker', 730, 90))
    ws.stop()
    timers.advance(5000)
    expect(reads).toEqual([])
    expect(sockets.taker.every((s) => s.closed)).toBe(true)
  })
})

describe('AgentsWs: latency log', () => {
  it('logs socket → SSE push for the decision row and for the row that carries its request', () => {
    const hub = new GameHub()
    const { ws, timers, last, logs } = setup({ hub })
    ws.start()
    last('taker').open()
    timers.advance(5000)
    last('taker').send(decision('taker', 740, 501))
    timers.advance(300)
    last('taker').send(execution('taker', 740, 501))
    timers.advance(80)
    hub.publish([{ id: -1, tick: 740, type: 'agent.decision', scope: 'team', actor: 'taker', payload: { decision: 501, method: null } }])
    timers.advance(500)
    hub.publish([{ id: -2, tick: 740, type: 'agent.decision', scope: 'team', actor: 'taker', payload: { decision: 501, method: 'accept' } }])
    hub.publish([{ id: -3, tick: 740, type: 'agent.decision', scope: 'team', actor: 'taker', payload: { decision: 501, method: 'accept' } }])
    expect(logs.filter((l) => l.event === 'latency')).toEqual([
      { route: 'agent_ws', event: 'latency', agent: 'taker', kind: 'decision', decision: 501, ms: 380 },
      { route: 'agent_ws', event: 'latency', agent: 'taker', kind: 'execution', decision: 501, ms: 580 },
    ])
    ws.stop()
  })
})

describe('startAgentsWs', () => {
  const game = (pokes: string[], db = true) => ({
    db: db ? { poke: () => (pokes.push('db'), true) } : null,
    hub: new GameHub(),
  })

  it('is off with AGENTS_WS=off, without the database, and under a test runner with no socket of its own', () => {
    const logs: Record<string, unknown>[] = []
    const log = (e: Record<string, unknown>) => logs.push(e)
    const decisions = { poke: () => true }
    expect(startAgentsWs({ AGENTS_WS: 'off' }, { database: true, game: game([]), decisions, log, createSocket: (u) => new FakeSocket(u) }).sockets()).toBeNull()
    expect(startAgentsWs({}, { database: false, game: game([]), decisions, log, createSocket: (u) => new FakeSocket(u) }).sockets()).toBeNull()
    const off = startAgentsWs({ VITEST: 'true' }, { database: true, game: game([]), decisions, log })
    expect(off.sockets()).toBeNull()
    expect(off.onEvent(() => undefined)).toBeTypeOf('function')
    expect(logs.map((l) => l.reason)).toEqual(['disabled', 'no_database', 'test'])
  })

  it('pokes the game views (when they are the source) and the decisions on a live event; in watch mode, never', () => {
    for (const [mode, viewsSource, expected] of [['', true, ['db', 'decisions']], ['', false, ['decisions']], ['watch', true, []]] as const) {
      const pokes: string[] = []
      const timers = new FakeTimers()
      const sockets: FakeSocket[] = []
      const handle = startAgentsWs({ AGENTS_WS: mode }, {
        database: true, game: game(pokes, viewsSource), decisions: { poke: () => (pokes.push('decisions'), true) }, log: () => undefined, timers,
        createSocket: (u) => {
          const s = new FakeSocket(u)
          sockets.push(s)
          return s
        },
      })
      for (const s of sockets) s.open()
      timers.advance(5000)
      sockets[0]?.send(tick('taker', 800))
      timers.advance(300)
      expect(pokes).toEqual(expected)
      expect(handle.sockets()?.taker.state).toBe('open')
      handle.stop()
    }
  })

  it('takes ws(s):// URLs from the environment, else the agents\' public ones', () => {
    expect(wsUrls({})).toEqual({ taker: 'wss://bazaar-taker-production.up.railway.app/events', maker: 'wss://bazaar-maker-production.up.railway.app/events' })
    expect(wsUrls({ AGENT_TAKER_WS_URL: 'ws://127.0.0.1:8770/events', AGENT_MAKER_WS_URL: 'https://not-a-socket' })).toEqual({
      taker: 'ws://127.0.0.1:8770/events', maker: 'wss://bazaar-maker-production.up.railway.app/events',
    })
  })
})
