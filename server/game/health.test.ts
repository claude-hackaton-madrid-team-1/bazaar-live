import { describe, expect, it } from 'vitest'
import { healthVerdict, reasons, type HealthReport } from '../../shared/health.ts'
import { HealthPoller, healthUrls, readHealth } from './health.ts'
import { GameHub, type GameEvent } from './relay.ts'

const NOW = Date.parse('2026-10-03T10:40:00Z')

/** /health as the agents answer it today (bazaar status.py), plus whatever a test adds. */
const body = (extra: Record<string, unknown> = {}) => ({
  ok: true, agent: 'taker', mode: 'live', target: { mode: 'real', url: 'https://bazaar.causaprima.ai' }, ledger: 'shared',
  tick: 535, last_tick_at: '2026-10-03T10:39:50+00:00', doors: 'open', paused: false, next_opens: '2026-10-04T09:00:00+02:00',
  tick_seconds: 30.0, server_tick: 535, ...extra,
})

const report = (extra: Record<string, unknown> = {}): HealthReport => ({ ...(readHealth('taker', body(extra), NOW) as Omit<HealthReport, 'since'>), since: {} })

describe('readHealth', () => {
  it('keeps the allow-listed facts and never the target url or an unknown field', () => {
    const r = readHealth('taker', body({ api_key: 'sk-secret', note: 'x' }), NOW)
    expect(r).toMatchObject({ mode: 'live', target: 'real', ledger: 'shared', tick: 535, serverTick: 535, tickAgeS: 10, doors: 'open', tickSeconds: 30 })
    const text = JSON.stringify(r)
    expect(text).not.toContain('causaprima')
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('note')
  })

  it('reads "local file" as local, and drops a body that is not ok or a time that is not a time', () => {
    expect(readHealth('maker', body({ ledger: 'local file' }), NOW)?.ledger).toBe('local')
    expect(readHealth('maker', { ...body(), ok: false }, NOW)).toBeNull()
    expect(readHealth('maker', body({ last_tick_at: 'yesterday <script>' }), NOW)?.lastTickAt).toBeNull()
  })
})

describe('reasons', () => {
  it('a healthy agent has none', () => {
    expect(healthVerdict(report())).toMatchObject({ tone: 'good', reason: null })
  })

  it('names the worst one first: ledger down over dry run over the simulator', () => {
    const v = healthVerdict(report({ ledger: 'down', mode: 'dry', target: { mode: 'simulator' } }))
    expect(v.tone).toBe('bad')
    expect(v.all.map((r) => r.kind)).toEqual(['ledger_down', 'dry', 'simulator'])
  })

  it('no tick for more than 2 min (or 4 game ticks) is red, but not while the doors are closed or the game paused', () => {
    const old = { last_tick_at: '2026-10-03T10:37:30+00:00' }
    expect(reasons(report(old))).toEqual([{ kind: 'no_tick', ageS: 150 }])
    expect(reasons(report({ ...old, tick_seconds: 60 }))).toEqual([])
    expect(reasons(report({ ...old, doors: 'closed' })).map((r) => r.kind)).toEqual(['closed'])
    expect(healthVerdict(report({ ...old, doors: 'closed' })).tone).toBe('neutral')
    expect(reasons(report({ ...old, paused: true })).map((r) => r.kind)).toEqual(['paused'])
  })

  it('the tick against its 15 s budget: amber past 80 %, red past it', () => {
    expect(reasons(report({ tick_ms: 14_200 }))).toEqual([{ kind: 'tick_slow', usedS: 14.2, budgetS: 15 }])
    expect(reasons(report({ tick_ms: 16_000 }))).toEqual([{ kind: 'tick_over', usedS: 16, budgetS: 15 }])
    expect(reasons(report({ tick_ms: 9_000 }))).toEqual([])
  })

  it('behind the game clock, 429s, and a slow or undecided Jev are amber', () => {
    const kinds = reasons(report({ tick: 530, rate_limited: 3, jev_ms: 9_000, jev_undecided: 0.6 })).map((r) => r.kind)
    expect(kinds).toEqual(['behind', 'rate_limited', 'jev_slow', 'jev_undecided'])
    expect(healthVerdict(report({ rate_limited: 3 })).tone).toBe('warn')
  })
})

function fetchOf(answer: (url: string) => Response | Error | 'hang'): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const out = answer(String(input))
    if (out === 'hang') {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    if (out instanceof Error) throw out
    return out
  }) as typeof fetch
}

const URLS = { taker: 'https://taker.test', maker: 'https://maker.test' }

describe('HealthPoller', () => {
  it('asks both agents and publishes one sticky agent.health with what each said', async () => {
    const published: GameEvent[] = []
    const asked: string[] = []
    const poller = new HealthPoller({
      hub: { publishStatus: (e) => published.push(e) }, log: () => undefined, urls: URLS, now: () => NOW,
      fetchImpl: fetchOf((url) => {
        asked.push(url)
        return Response.json(body(url.includes('maker') ? { agent: 'maker', mode: 'dry' } : {}))
      }),
    })
    const out = await poller.pollOnce()
    expect(asked.sort()).toEqual(['https://maker.test/health', 'https://taker.test/health'])
    expect(published).toHaveLength(1)
    expect(published[0]?.type).toBe('agent.health')
    expect(published[0]!.id).toBeLessThan(0)
    expect(out.agents.map((a) => [a.agent, a.mode, a.error])).toEqual([['taker', 'live', null], ['maker', 'dry', null]])
    expect(out.agents[1]?.since).toEqual({ dry: new Date(NOW).toISOString() })
  })

  it('a timeout, an error status and a body that is not /health each say so; it never throws', async () => {
    const poller = new HealthPoller({
      hub: { publishStatus: () => undefined }, log: () => undefined, urls: URLS, timeoutMs: 20, now: () => NOW,
      fetchImpl: fetchOf((url) => (url.includes('taker') ? 'hang' : new Response('<html>', { status: 502 }))),
    })
    expect((await poller.pollOnce()).agents.map((a) => a.error)).toEqual(['timeout', 'http'])
    const bad = new HealthPoller({ hub: { publishStatus: () => undefined }, log: () => undefined, urls: URLS, fetchImpl: fetchOf((url) => (url.includes('taker') ? new Response('not json') : new Error('ECONNREFUSED'))) })
    expect((await bad.pollOnce()).agents.map((a) => a.error)).toEqual(['bad_body', 'unreachable'])
  })

  it('remembers since when a reason holds, and forgets it once it clears', async () => {
    let now = NOW
    let ledger = 'down'
    const poller = new HealthPoller({
      hub: { publishStatus: () => undefined }, log: () => undefined, urls: URLS, now: () => now,
      fetchImpl: fetchOf(() => Response.json(body({ ledger, last_tick_at: new Date(now - 5000).toISOString() }))),
    })
    const first = (await poller.pollOnce()).agents[0]?.since.ledger_down
    now += 60_000
    expect((await poller.pollOnce()).agents[0]?.since.ledger_down).toBe(first)
    ledger = 'shared'
    now += 10_000
    expect((await poller.pollOnce()).agents[0]?.since).toEqual({})
    ledger = 'down'
    expect((await poller.pollOnce()).agents[0]?.since.ledger_down).toBe(new Date(now).toISOString())
  })

  it('logs a failure once, and the recovery once', async () => {
    const logs: Record<string, unknown>[] = []
    let up = false
    const poller = new HealthPoller({
      hub: { publishStatus: () => undefined }, log: (e) => logs.push(e), urls: { taker: URLS.taker, maker: URLS.maker }, now: () => NOW,
      fetchImpl: fetchOf((url) => (url.includes('maker') || up ? Response.json(body()) : new Error('down'))),
    })
    await poller.pollOnce()
    await poller.pollOnce()
    up = true
    await poller.pollOnce()
    expect(logs.filter((l) => l.agent === 'taker').map((l) => l.event)).toEqual(['failed', 'ok'])
  })
})

describe('healthUrls', () => {
  it('reads Railway\'s bare domains, else the known endpoints', () => {
    expect(healthUrls({ RAILWAY_SERVICE_BAZAAR_TAKER_URL: 'taker.up.railway.app' }).taker).toBe('https://taker.up.railway.app')
    expect(healthUrls({}).maker).toBe('https://bazaar-maker-production.up.railway.app')
    expect(healthUrls({ RAILWAY_SERVICE_BAZAAR_MAKER_URL: 'ftp://x' }).maker).toBe('https://bazaar-maker-production.up.railway.app')
  })
})

describe('GameHub.publishStatus', () => {
  it('reaches every viewer and leads the replay, but never enters the backlog', () => {
    const hub = new GameHub(3)
    const seen: string[] = []
    hub.subscribe((batch) => seen.push(...batch.map((e) => e.type)))
    hub.publish([{ id: 1, type: 'thread.message', payload: {} }])
    for (let i = 0; i < 10; i++) hub.publishStatus({ id: -10 - i, type: 'agent.health', payload: { n: i } })
    expect(hub.size).toBe(1)
    expect(seen.filter((t) => t === 'agent.health')).toHaveLength(10)
    const replay = hub.replay()
    expect(replay.map((e) => e.type)).toEqual(['agent.health', 'thread.message'])
    expect(replay[0]?.payload).toEqual({ n: 9 })
  })
})
