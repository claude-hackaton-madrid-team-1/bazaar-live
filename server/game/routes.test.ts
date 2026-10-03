import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { RateLimiter } from '../limits.ts'
import { readProviderConfig } from '../providers.ts'
import { GameHub, type GameEvent } from './relay.ts'
import { tokenMatches } from './routes.ts'
import { startGame } from './start.ts'

const servers: Server[] = []
afterEach(() => servers.splice(0).forEach((s) => { s.closeAllConnections(); s.close() }))

async function start(opts: { hub?: GameHub | null; enabled?: boolean; token?: string | null; maxPerAddress?: number; openLimiter?: RateLimiter } = {}) {
  const hub = opts.hub === undefined ? new GameHub() : opts.hub
  const app = createApp({
    config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined,
    game: { hub, enabled: () => opts.enabled ?? true, target: 'simulator', token: opts.token ?? null, maxPerAddress: opts.maxPerAddress, openLimiter: opts.openLimiter },
  })
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hub }
}

/** Reads SSE `events` messages until `count` arrived (or the stream ends). */
async function readBatches(res: Response, count: number): Promise<GameEvent[][]> {
  const reader = res.body?.getReader()
  const out: GameEvent[][] = []
  let buffer = ''
  const decoder = new TextDecoder()
  while (reader && out.length < count) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let at = buffer.indexOf('\n\n')
    while (at >= 0) {
      const lines = buffer.slice(0, at).split('\n')
      buffer = buffer.slice(at + 2)
      const data = lines.find((l) => l.startsWith('data: '))
      if (lines.includes('event: events') && data) out.push(JSON.parse(data.slice(6)) as GameEvent[])
      at = buffer.indexOf('\n\n')
    }
  }
  void reader?.cancel()
  return out
}

const e = (id: number, type: string): GameEvent => ({ id, type, payload: {} })

describe('GET /api/game', () => {
  it('reports off, without a target, when there is no relay', async () => {
    const { base } = await start({ hub: null, enabled: false })
    const res = await fetch(`${base}/api/game`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false, target: null, source: null, tokenRequired: false })
  })

  it('reports the target and whether a token is needed, never the key or url', async () => {
    const { base } = await start({ token: 'tok' })
    const text = await (await fetch(`${base}/api/game`)).text()
    expect(JSON.parse(text)).toEqual({ enabled: true, target: 'simulator', source: 'api', tokenRequired: true })
    expect(text).not.toContain('http')
  })

  it('refuses other methods', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/api/game`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${base}/api/game/stream`, { method: 'POST' })).status).toBe(405)
  })
})

describe('GET /api/game/stream', () => {
  it('is 404 while the game is off', async () => {
    const { base } = await start({ hub: null, enabled: false })
    const res = await fetch(`${base}/api/game/stream`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'game_off' })
  })

  it('asks for the view token when one is set', async () => {
    const { base } = await start({ token: 's3cret' })
    expect((await fetch(`${base}/api/game/stream`)).status).toBe(401)
    expect((await fetch(`${base}/api/game/stream?token=wrong`)).status).toBe(401)
    expect((await fetch(`${base}/api/game/stream?token=s3cre`)).status).toBe(401)
    const ok = await fetch(`${base}/api/game/stream?token=s3cret`)
    expect(ok.status).toBe(200)
    void ok.body?.cancel()
  })

  it('gives a late client hello first, then the backlog, then each new batch', async () => {
    const { base, hub } = await start()
    hub?.publish([e(1, 'settlement'), e(-1, 'agent.hello'), e(-2, 'agent.me'), e(2, 'thread.message')])
    const res = await fetch(`${base}/api/game/stream`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    const pending = readBatches(res, 2)
    await new Promise((r) => setTimeout(r, 30))
    hub?.publish([e(3, 'settlement')])
    const batches = await pending
    expect(batches[0]?.map((x) => x.id)).toEqual([-1, -2, 1, 2])
    expect(batches[1]?.map((x) => x.id)).toEqual([3])
  })

  it('caps open streams per address', async () => {
    const { base } = await start({ maxPerAddress: 1 })
    const first = await fetch(`${base}/api/game/stream`)
    const second = await fetch(`${base}/api/game/stream`)
    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
    void first.body?.cancel()
  })
})

describe('tokenMatches', () => {
  it('needs the same bytes and length', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true)
    expect(tokenMatches('abd', 'abc')).toBe(false)
    expect(tokenMatches('ab', 'abc')).toBe(false)
    expect(tokenMatches(null, 'abc')).toBe(false)
  })
})

describe('startGame', () => {
  it('is off without a key and never calls the game', () => {
    const logs: Record<string, unknown>[] = []
    const game = startGame({}, (l) => logs.push(l), (() => { throw new Error('no fetch') }) as typeof fetch)
    expect(game.enabled()).toBe(false)
    expect(game.hub).toBeNull()
    expect(logs[0]).toMatchObject({ route: 'game', event: 'off' })
    game.stop()
  })

  it('starts a relay with a key, without logging it', () => {
    const logs: Record<string, unknown>[] = []
    const game = startGame({ BAZAAR_KEY: 'real-key-123' }, (l) => logs.push(l), (async () => new Response('{}')) as typeof fetch)
    expect(game.enabled()).toBe(true)
    expect(game.target).toBe('real')
    game.stop()
    expect(JSON.stringify(logs)).not.toContain('real-key-123')
  })
})
