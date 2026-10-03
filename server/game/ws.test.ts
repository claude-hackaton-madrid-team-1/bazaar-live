import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createApp } from '../app.ts'
import { readProviderConfig } from '../providers.ts'
import { GameHub, type GameEvent } from './relay.ts'
import { sameOriginUpgrade, WS_PATH, wsFrame } from './routes.ts'

const servers: Server[] = []
const sockets: WebSocket[] = []
afterEach(() => {
  sockets.splice(0).forEach((s) => s.terminate())
  servers.splice(0).forEach((s) => {
    s.closeAllConnections()
    s.close()
  })
})

async function start(opts: { hub?: GameHub | null; enabled?: boolean; token?: string | null; maxPerAddress?: number; heartbeatMs?: number } = {}) {
  const hub = opts.hub === undefined ? new GameHub() : opts.hub
  const app = createApp({
    config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined,
    game: { hub, enabled: () => opts.enabled ?? true, target: 'simulator', token: opts.token ?? null, maxPerAddress: opts.maxPerAddress, heartbeatMs: opts.heartbeatMs },
  })
  const server = createServer(app)
  server.on('upgrade', app.upgrade)
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}`, hub }
}

/** Opens a socket and collects every frame; `opened` settles on open, or with the refused handshake's status. */
function connect(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers })
  sockets.push(ws)
  const frames: string[] = []
  const waiters: (() => void)[] = []
  ws.on('message', (data) => {
    frames.push(String(data))
    waiters.splice(0).forEach((w) => w())
  })
  const opened = new Promise<number>((resolve) => {
    ws.on('open', () => resolve(101))
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('error', () => resolve(0))
  })
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
  /** Resolves once `n` frames have arrived. */
  const until = async (n: number): Promise<string[]> => {
    while (frames.length < n) await new Promise<void>((r) => waiters.push(r))
    return frames
  }
  return { ws, frames, opened, closed, until }
}

const e = (id: number, type: string): GameEvent => ({ id, type, payload: {} })

/** The events of an `events` frame. */
const eventsOf = (frame: string | undefined): number[] => {
  expect(frame?.startsWith('events\n')).toBe(true)
  return (JSON.parse((frame ?? '').slice('events\n'.length)) as GameEvent[]).map((x) => x.id)
}

describe(`GET ${WS_PATH}`, () => {
  it('sends the replay (hello first, then the backlog), then each new batch, as `events\\n<json>` frames', async () => {
    const { ws, hub } = await start()
    hub?.publish([e(1, 'settlement'), e(-1, 'agent.hello'), e(-2, 'agent.me'), e(2, 'thread.message')])
    const c = connect(`${ws}${WS_PATH}`)
    expect(await c.opened).toBe(101)
    await c.until(1)
    hub?.publish([e(3, 'settlement')])
    const frames = await c.until(2)
    expect(eventsOf(frames[0])).toEqual([-1, -2, 1, 2])
    expect(eventsOf(frames[1])).toEqual([3])
  })

  it('beats with `hb\\n1` so the page knows a quiet stream is alive', async () => {
    const { ws } = await start({ heartbeatMs: 20 })
    const c = connect(`${ws}${WS_PATH}`)
    const frames = await c.until(2)
    expect(frames[1]).toBe(wsFrame('hb', '1'))
  })

  it('is refused 404 while the game is off', async () => {
    const { ws } = await start({ hub: null, enabled: false })
    expect(await connect(`${ws}${WS_PATH}`).opened).toBe(404)
  })

  it('asks for the view token when one is set, and opens with the right one', async () => {
    const { ws } = await start({ token: 'tok.' })
    expect(await connect(`${ws}${WS_PATH}`).opened).toBe(401)
    expect(await connect(`${ws}${WS_PATH}?token=wrong`).opened).toBe(401)
    expect(await connect(`${ws}${WS_PATH}?token=${encodeURIComponent('tok.')}`).opened).toBe(101)
  })

  it('refuses a page of another origin, accepts its own', async () => {
    const { ws } = await start()
    const host = new URL(ws).host
    expect(await connect(`${ws}${WS_PATH}`, { Origin: 'https://evil.example' }).opened).toBe(403)
    expect(await connect(`${ws}${WS_PATH}`, { Origin: `http://${host}` }).opened).toBe(101)
  })

  it('shares the per-address cap with the SSE stream, and gives the place back on close', async () => {
    const { http, ws } = await start({ maxPerAddress: 1 })
    const first = connect(`${ws}${WS_PATH}`)
    expect(await first.opened).toBe(101)
    expect(await connect(`${ws}${WS_PATH}`).opened).toBe(429)
    expect((await fetch(`${http}/api/game/stream`)).status).toBe(429)
    first.ws.close()
    await first.closed
    await new Promise((r) => setTimeout(r, 30))
    expect(await connect(`${ws}${WS_PATH}`).opened).toBe(101)
  })

  it('closes the socket (1003) when the page sends anything: the stream is server to page only', async () => {
    const { ws } = await start()
    const c = connect(`${ws}${WS_PATH}`)
    await c.opened
    c.ws.send('hello')
    expect(await c.closed).toBe(1003)
  })

  it('answers any other upgrade with 404', async () => {
    const { ws } = await start()
    expect(await connect(`${ws}/api/game/stream`).opened).toBe(404)
    expect(await connect(`${ws}/somewhere`).opened).toBe(404)
  })
})

describe('sameOriginUpgrade', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as Parameters<typeof sameOriginUpgrade>[0]
  it('accepts no Origin (not a page) and the same host; refuses another host or a broken Origin', () => {
    expect(sameOriginUpgrade(req({ host: 'live.example' }))).toBe(true)
    expect(sameOriginUpgrade(req({ host: 'live.example', origin: 'https://live.example' }))).toBe(true)
    expect(sameOriginUpgrade(req({ host: 'live.example', origin: 'https://other.example' }))).toBe(false)
    expect(sameOriginUpgrade(req({ host: 'live.example', origin: 'not a url' }))).toBe(false)
  })
})
