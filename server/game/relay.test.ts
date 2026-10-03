import { describe, expect, it } from 'vitest'
import { GameHub, GameRelay, type GameEvent } from './relay.ts'

interface World {
  clock: Record<string, unknown>
  feed: Record<string, unknown>[]
  me: Record<string, unknown>
  duels: Record<string, unknown>[]
  /** Status per path prefix, to make a route fail. */
  fail: Record<string, number>
  calls: string[]
  auth: string[]
}

const world = (): World => ({
  clock: { tick: 7, t_hours: 0.12, tick_seconds: 60, next_tick_in: 41, round_name: 'Friday · El Rastro' },
  feed: [],
  me: { id: 't01', name: 'Team 1', cash: 400 },
  duels: [],
  fail: {},
  calls: [],
  auth: [],
})

const ev = (id: number, type = 'thread.message', payload: Record<string, unknown> = {}) => ({ id, tick: 7, t: 0.1, type, scope: 'public', actor: 't05', payload })

function fakeFetch(w: World): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    w.calls.push(url.pathname + url.search)
    w.auth.push(String((init?.headers as Record<string, string> | undefined)?.['X-Team-Key']))
    const status = Object.entries(w.fail).find(([p]) => url.pathname.startsWith(p))?.[1]
    if (status) return new Response('{}', { status, headers: status === 429 ? { 'Retry-After': '30' } : {} })
    const body = url.pathname === '/api/clock' ? w.clock : url.pathname === '/api/feed' ? { events: w.feed } : url.pathname === '/api/duels' ? { duels: w.duels } : w.me
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

function setup(w = world()) {
  const hub = new GameHub()
  const batches: GameEvent[][] = []
  hub.subscribe((b) => batches.push([...b]))
  const logs: Record<string, unknown>[] = []
  const time = { ms: 0 }
  const relay = new GameRelay({ url: 'https://game.test', key: 'secret-key', hub, log: (e) => logs.push(e), fetchImpl: fakeFetch(w), random: () => 0.5, pollMs: 5000, now: () => time.ms })
  return { w, hub, batches, logs, relay, time }
}

describe('GameRelay', () => {
  it('first poll: clock, hello, me, then the feed events oldest first, with the key as a bearer', async () => {
    const { w, batches, relay } = setup()
    w.feed = [ev(12), ev(10), ev(11)]
    await relay.pollOnce()
    expect(batches).toHaveLength(1)
    const types = batches[0]!.map((e) => e.type)
    expect(types).toEqual(['clock', 'agent.hello', 'agent.me', 'thread.message', 'thread.message', 'thread.message'])
    expect(batches[0]!.slice(3).map((e) => e.id)).toEqual([10, 11, 12])
    expect(batches[0]![0]).toMatchObject({ tick: 7, t: 0.12, scope: 'team', actor: '', payload: { day: 'Friday · El Rastro', tick_seconds: 60, next_tick_in: 41 } })
    expect(batches[0]![1]?.payload).toEqual({ team: 't01', name: 'Team 1' })
    expect(batches[0]![2]?.payload).toEqual(w.me)
    expect(new Set(w.auth)).toEqual(new Set(['secret-key']))
  })

  it('a second poll in the same tick with nothing new publishes nothing and skips /me', async () => {
    const { w, batches, relay } = setup()
    w.feed = [ev(10)]
    await relay.pollOnce()
    expect(w.calls).toEqual(['/api/clock', '/api/feed?limit=150', '/api/me', '/api/duels?done=true'])
    w.calls = []
    await relay.pollOnce()
    expect(batches).toHaveLength(1)
    expect(w.calls).toEqual(['/api/clock', '/api/feed?limit=150'])
  })

  it('a new tick brings a clock and a fresh /me, and no second hello for the same team', async () => {
    const { w, batches, relay } = setup()
    await relay.pollOnce()
    w.clock = { ...w.clock, tick: 8 }
    w.feed = [ev(20)]
    await relay.pollOnce()
    expect(batches[1]!.map((e) => e.type)).toEqual(['clock', 'agent.me', 'thread.message'])
    expect(batches[1]![0]?.tick).toBe(8)
  })

  it('drops duplicates and ids far below the newest one', async () => {
    const { w, batches, relay } = setup()
    w.feed = [ev(5000), ev(5001)]
    await relay.pollOnce()
    w.feed = [ev(5001), ev(5002), ev(5002), ev(10)]
    await relay.pollOnce()
    expect(batches[1]!.map((e) => e.id)).toEqual([5002])
  })

  it('reads /me again after a settlement of ours, inside the same tick', async () => {
    const { w, batches, relay } = setup()
    await relay.pollOnce()
    w.feed = [ev(30, 'settlement', { parties: ['t09', 't01'] })]
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).toContain('/api/me')
    expect(batches[1]!.map((e) => e.type)).toEqual(['agent.me', 'settlement'])
  })

  it('made-up ids are negative and never repeat, even with two /me in one tick', async () => {
    const { w, batches, relay } = setup()
    await relay.pollOnce()
    w.feed = [ev(31, 'settlement', { parties: ['t01'] })]
    await relay.pollOnce()
    w.clock = { ...w.clock, tick: 9 }
    await relay.pollOnce()
    const ids = batches.flat().filter((e) => e.id < 0).map((e) => e.id)
    expect(ids.length).toBe(6)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('skips malformed feed entries', async () => {
    const { w, batches, relay } = setup()
    w.feed = [ev(1), { id: 'x', type: 'a' }, { id: 2 }, { id: 3, type: 'b', payload: [1] }, { id: 4, type: 'c' }]
    await relay.pollOnce()
    expect(batches[0]!.slice(3).map((e) => [e.id, e.payload])).toEqual([[1, {}], [4, {}]])
  })

  it('a refused key (401) stops the relay and is logged once, without the key', async () => {
    const { w, logs, relay } = setup()
    w.fail['/api/feed'] = 401
    relay.start()
    await relay.pollOnce()
    expect(relay.keyRefused).toBe(true)
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).toEqual([])
    expect(logs.filter((l) => l.event === 'key_refused')).toHaveLength(1)
    expect(JSON.stringify(logs)).not.toContain('secret-key')
    relay.stop()
  })

  it('a key refused on /me keeps the public clock and feed, and stops asking for /me', async () => {
    const { w, batches, logs, relay } = setup()
    w.fail['/api/me'] = 401
    w.feed = [ev(1)]
    await relay.pollOnce()
    expect(relay.keyRefused).toBe(false)
    expect(batches[0]!.map((e) => e.type)).toEqual(['clock', 'thread.message'])
    w.clock = { ...w.clock, tick: 8 }
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).toEqual(['/api/clock', '/api/feed?limit=150'])
    expect(relay.nextDelayMs()).toBe(5000)
    expect(logs.filter((l) => l.event === 'me_refused')).toHaveLength(1)
  })

  it('backs off after failures, honours a 429 Retry-After, and recovers', async () => {
    const { w, logs, relay } = setup()
    w.fail['/api/clock'] = 502
    await relay.pollOnce()
    const one = relay.nextDelayMs()
    await relay.pollOnce()
    const two = relay.nextDelayMs()
    expect(one).toBe(10_000)
    expect(two).toBe(20_000)
    for (let i = 0; i < 10; i++) await relay.pollOnce()
    expect(relay.nextDelayMs()).toBe(60_000)
    w.fail = { '/api/feed': 429 }
    await relay.pollOnce()
    expect(relay.nextDelayMs()).toBe(30_000)
    w.fail = {}
    await relay.pollOnce()
    expect(relay.nextDelayMs()).toBe(5000)
    expect(logs.some((l) => l.event === 'poll_recovered')).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('secret-key')
  })

  it('relays the allow-listed /me (affinity included), never its keys or collection value, live and on replay', async () => {
    const { w, hub, batches, relay } = setup()
    w.me = { ...w.me, affinity: { LAV: 1.6 }, starter_broker_key: 'bk-secret', collection_value: 240, assets: [{ id: 1, kind: 'card', ref: 'LAV-01', serial: 2, your_value: 9, print_run: 300 }] }
    await relay.pollOnce()
    const expected = { id: 't01', name: 'Team 1', cash: 400, affinity: { LAV: 1.6 }, assets: [{ id: 1, kind: 'card', ref: 'LAV-01', serial: 2, your_value: 9 }] }
    expect(batches[0]![2]?.payload).toEqual(expected)
    expect(hub.replay().find((e) => e.type === 'agent.me')?.payload).toEqual(expected)
    expect(JSON.stringify(hub.replay())).not.toMatch(/bk-secret|collection_value/)
  })

  it('a 429 on /me waits for the next tick (and its Retry-After) without backing off the loop', async () => {
    const { w, batches, logs, relay, time } = setup()
    await relay.pollOnce()
    w.fail['/api/me'] = 429
    w.clock = { ...w.clock, tick: 8 }
    w.feed = [ev(1)]
    await relay.pollOnce()
    expect(batches[1]!.map((e) => e.type)).toEqual(['clock', 'thread.message'])
    expect(relay.nextDelayMs()).toBe(5000)
    expect(logs.some((l) => l.event === 'poll_failed')).toBe(false)
    w.fail = {}
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).toEqual(['/api/clock', '/api/feed?limit=150'])
    w.clock = { ...w.clock, tick: 9 }
    time.ms = 29_000
    await relay.pollOnce()
    expect(w.calls).not.toContain('/api/me')
    expect(w.calls).not.toContain('/api/duels?done=true')
    time.ms = 30_000
    await relay.pollOnce()
    expect(w.calls).toContain('/api/me')
    expect(w.calls).toContain('/api/duels?done=true')
    expect(batches.at(-1)!.map((e) => e.type)).toEqual(['agent.me'])
  })

  it('duels: read after /me on a new tick, published before the feed, each message and result once', async () => {
    const { w, batches, relay } = setup()
    const duel = { duel: 563, status: 'live', role: 'seller', rival: 'Rival Oro', your_limit: 100, deadline_tick: 20, messages: [{ tick: 7, from: 'Rival Oro', text: 'hi', price: 106, days: 0 }] }
    w.duels = [duel]
    w.feed = [ev(1, 'duels.scheduled')]
    await relay.pollOnce()
    expect(batches[0]!.map((e) => e.type)).toEqual(['clock', 'agent.hello', 'agent.me', 'duel.started', 'duel.message', 'duels.scheduled'])
    expect(batches[0]![3]).toMatchObject({ scope: 'team', payload: { duel: 563, role: 'seller', rival: 'Rival Oro' } })
    expect(batches[0]![4]).toMatchObject({ tick: 7, scope: 'team', actor: '', payload: { duel: 563, role: 'seller', rival: 'Rival Oro', sender: 'Rival Oro', price: 106, days: 0 } })
    // Same tick: no second read.
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).not.toContain('/api/duels?done=true')
    // New tick: our answer and the rival's acceptance arrive, the old message is not sent again.
    w.clock = { ...w.clock, tick: 8 }
    duel.messages.push({ tick: 8, from: 'you', text: 'no', price: 120, days: 2 })
    w.duels = [{ ...duel, status: 'deal', price: 120, result: { status: 'deal', price: 120, points: 3.1, your_gain: 20 } }]
    w.feed = [ev(2, 'duel.closed', { duel: 563, status: 'deal' })]
    await relay.pollOnce()
    const fresh = batches.at(-1)!
    expect(fresh.map((e) => e.type)).toEqual(['clock', 'agent.me', 'duel.message', 'duel.result', 'duel.closed'])
    expect(fresh[2]?.payload).toEqual({ duel: 563, role: 'seller', rival: 'Rival Oro', sender: 't01', price: 120, days: 2 })
    expect(fresh[3]?.payload).toEqual({ duel: 563, rival: 'Rival Oro', deal: true, price: 120, points: 3.1, gain: 20, rounds: null, limit: 100 })
    expect(new Set(batches.flat().filter((e) => e.type.startsWith('duel.m')).map((e) => e.id)).size).toBe(2)
    expect(JSON.stringify(batches)).not.toMatch(/your_limit|your_gain/)
  })

  it('duels: a 429 waits for the next tick and its Retry-After; a refusal turns them off; neither slows the loop', async () => {
    const { w, logs, relay, time } = setup()
    w.fail['/api/duels'] = 429
    await relay.pollOnce()
    expect(relay.nextDelayMs()).toBe(5000)
    w.fail = {}
    w.clock = { ...w.clock, tick: 8 }
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).not.toContain('/api/duels?done=true')
    time.ms = 30_000
    await relay.pollOnce()
    expect(w.calls).toContain('/api/duels?done=true')
    w.fail['/api/duels'] = 404
    w.clock = { ...w.clock, tick: 9 }
    await relay.pollOnce()
    w.fail = {}
    w.clock = { ...w.clock, tick: 10 }
    w.calls = []
    await relay.pollOnce()
    expect(w.calls).toEqual(['/api/clock', '/api/feed?limit=150', '/api/me'])
    expect(relay.nextDelayMs()).toBe(5000)
    expect(logs.filter((l) => l.event === 'duels_refused')).toHaveLength(1)
    expect(logs.some((l) => l.event === 'poll_failed')).toBe(false)
  })

  it('no duels without a team (/me refused), and none in a poll where /me was held by a 429', async () => {
    const { w, relay } = setup()
    w.fail['/api/me'] = 429
    await relay.pollOnce()
    expect(w.calls).not.toContain('/api/duels?done=true')
    const other = setup()
    other.w.fail['/api/me'] = 403
    await other.relay.pollOnce()
    other.w.clock = { ...other.w.clock, tick: 8 }
    await other.relay.pollOnce()
    expect(other.w.calls).not.toContain('/api/duels?done=true')
  })

  it('a failed /me still publishes the clock and the feed, and /me is retried next poll', async () => {
    const { w, batches, relay } = setup()
    w.fail['/api/me'] = 500
    w.feed = [ev(1)]
    await relay.pollOnce()
    expect(batches[0]!.map((e) => e.type)).toEqual(['clock', 'thread.message'])
    w.fail = {}
    await relay.pollOnce()
    expect(batches[1]!.map((e) => e.type)).toEqual(['agent.hello', 'agent.me'])
  })
})

describe('GameHub', () => {
  it('replays the sticky events first, then the backlog without them, bounded', () => {
    const hub = new GameHub(3)
    const hello = { id: -1, type: 'agent.hello', payload: { team: 't01' } }
    hub.publish([{ id: 1, type: 'settlement', payload: {} }, hello, { id: 2, type: 'thread.message', payload: {} }])
    hub.publish([{ id: -2, type: 'clock', payload: {} }, { id: 3, type: 'settlement', payload: {} }])
    expect(hub.size).toBe(3)
    expect(hub.replay().map((e) => e.id)).toEqual([-1, -2, 2, 3])
  })
})
