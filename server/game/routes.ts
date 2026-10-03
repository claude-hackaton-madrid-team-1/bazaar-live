/**
 * GET /api/game          JSON: {enabled, target, source, tokenRequired, sockets}: whether the game screens have a feed, and
 *                        where it comes from ('db': our database's views, 'api': the game's API with the team key);
 *                        `sockets`: each agent's /events socket (state, last live event) while ./agentsws.ts runs, else null
 * GET /api/game/stream   SSE: `events` with the replay (sticky first, then the backlog), then one `events`
 *                        per batch the relay publishes; `hb` every few seconds
 * GET /api/game/ws       The same stream over a WebSocket (upgrade): one text frame per message, `<event>\n<data>`
 *                        (`events\n[...]`, `hb\n1`), so the page's GameFeed reads both the same way. Server to page only:
 *                        a frame from the page closes the socket (1003).
 *
 * These carry the team's private state (cash, assets and their values, the album), read with the team
 * key: GAME_VIEW_TOKEN, when set, is required on the stream as `?token=`. A cap on open streams (per
 * address and in all, SSE and WebSocket counted together), a per-address limit on opening them, and a drop for
 * any client that stops reading. A WebSocket from a page of another origin is refused (403).
 */
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { STATUS_CODES, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { RateLimiter } from '../limits.ts'
import type { AgentSockets } from './agentsws.ts'
import type { GameTarget } from './config.ts'
import type { GameEvent, GameHub } from './relay.ts'

export interface GameRouteDeps {
  /** Absent while the game is off (no key): the stream answers 404. */
  readonly hub: GameHub | null
  readonly enabled: () => boolean
  readonly target: GameTarget | null
  /** Where the feed comes from now ('db' or 'api'); absent → 'api' (the relay). */
  readonly source?: () => 'db' | 'api' | null
  /** Our agents' sockets (./agentsws.ts): instant liveness, no secret in it. Absent or null → `sockets: null`. */
  readonly sockets?: () => AgentSockets | null
  /** GAME_VIEW_TOKEN, or null: the stream is open to anyone with the URL. */
  readonly token: string | null
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  readonly maxStreams?: number
  readonly maxPerAddress?: number
  readonly heartbeatMs?: number
  /** A stream ends after this long; the page reconnects and gets the replay again. */
  readonly maxLifetimeMs?: number
  readonly openLimiter?: RateLimiter
  /** A client that has this many bytes waiting is not reading: drop it. */
  readonly maxQueuedBytes?: number
}

/** The HTTP routes, plus the WebSocket upgrade of GET /api/game/ws (true when the path is ours, answered or refused). */
export type GameRoutes = ((req: IncomingMessage, res: ServerResponse, path: string) => boolean) & {
  readonly upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer, path: string) => boolean
}

/** Why a stream was not opened: the status, the JSON body and any extra header. */
interface Refusal {
  readonly status: number
  readonly body: unknown
  readonly extra?: Readonly<Record<string, string>>
}

/** An opened stream's place: the hub to read, and `release` (idempotent) to give the place back. */
interface Admitted {
  readonly hub: GameHub
  readonly release: () => void
}

export const WS_PATH = '/api/game/ws'

function json(res: ServerResponse, headers: Readonly<Record<string, string>>, status: number, body: unknown, extra: Readonly<Record<string, string>> = {}): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

/** Same length and same bytes, compared in constant time. */
export function tokenMatches(given: string | null, expected: string): boolean {
  if (given === null) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * A WebSocket handshake from a page of this origin. Browsers always send `Origin` on a WebSocket; a client
 * without one (a script, a test) is not a page another site can turn against us, and the token still applies.
 */
export function sameOriginUpgrade(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** One message of the stream as a WebSocket text frame: the event's name, a newline, then its data. */
export const wsFrame = (event: 'events' | 'hb', data: string): string => `${event}\n${data}`

export function createGameRoutes(deps: GameRouteDeps): GameRoutes {
  const maxStreams = deps.maxStreams ?? 100
  const maxPerAddress = deps.maxPerAddress ?? 6
  const heartbeatMs = deps.heartbeatMs ?? 15_000
  const maxLifetimeMs = deps.maxLifetimeMs ?? 30 * 60_000
  const openLimiter = deps.openLimiter ?? new RateLimiter({ capacity: 12, refillPerSecond: 0.2 })
  // The replay alone can be a few MB (5000 events): the cap is above it.
  const maxQueued = deps.maxQueuedBytes ?? 8 * 1024 * 1024
  const perAddress = new Map<string, number>()
  let open = 0
  // The page never speaks on the socket: a tiny payload cap, no compression, no tracking (we count the places ourselves).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false, clientTracking: false })

  function info(res: ServerResponse): void {
    const enabled = deps.enabled() && deps.hub !== null
    const source = enabled ? (deps.source?.() ?? 'api') : null
    json(res, deps.headers, 200, { enabled, target: enabled ? deps.target : null, source, tokenRequired: deps.token !== null, sockets: deps.sockets?.() ?? null })
  }

  /** The checks every stream passes, SSE or WebSocket, in this order; on success one place is taken. */
  function admit(req: IncomingMessage, url: URL): Admitted | Refusal {
    const hub = deps.hub
    if (!deps.enabled() || hub === null) return { status: 404, body: { error: 'game_off' } }
    if (deps.token !== null && !tokenMatches(url.searchParams.get('token'), deps.token)) return { status: 401, body: { error: 'token_required' } }
    const address = deps.address(req)
    const opened = openLimiter.take(address)
    if (!opened.ok) return { status: 429, body: { error: 'rate_limited' }, extra: { 'Retry-After': String(opened.retryAfterSeconds) } }
    if (open >= maxStreams || (perAddress.get(address) ?? 0) >= maxPerAddress) {
      return { status: 429, body: { error: 'too_many_streams' }, extra: { 'Retry-After': '10' } }
    }
    open += 1
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1)
    let released = false
    return {
      hub,
      release: () => {
        if (released) return
        released = true
        open -= 1
        const left = (perAddress.get(address) ?? 1) - 1
        if (left <= 0) perAddress.delete(address)
        else perAddress.set(address, left)
      },
    }
  }

  function stream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const admitted = admit(req, url)
    if ('status' in admitted) return json(res, deps.headers, admitted.status, admitted.body, admitted.extra)
    const { hub, release } = admitted
    res.writeHead(200, {
      ...deps.headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')

    const send = (events: readonly GameEvent[]): void => {
      if (res.writableLength > maxQueued) return end()
      res.write(`event: events\ndata: ${JSON.stringify(events)}\n\n`)
    }
    send(hub.replay())
    const off = hub.subscribe(send)
    // A real event, not a comment: EventSource never shows comments to the page, and its watchdog needs a beat.
    const beat = setInterval(() => res.write('event: hb\ndata: 1\n\n'), heartbeatMs)
    const lifetime = setTimeout(() => end(), maxLifetimeMs)
    let ended = false
    function end(): void {
      if (ended) return
      ended = true
      clearInterval(beat)
      clearTimeout(lifetime)
      off()
      release()
      res.end()
    }
    req.on('close', end)
    res.on('close', end)
    res.on('error', end)
  }

  /** A refused handshake: a plain HTTP answer on the raw socket, then the socket is closed. */
  function refuse(socket: Duplex, refusal: Refusal): void {
    const body = JSON.stringify(refusal.body)
    const headers: Record<string, string> = {
      ...deps.headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(Buffer.byteLength(body)),
      Connection: 'close',
      ...refusal.extra,
    }
    const head = [`HTTP/1.1 ${refusal.status} ${STATUS_CODES[refusal.status] ?? ''}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)]
    socket.end(`${head.join('\r\n')}\r\n\r\n${body}`)
  }

  /** The stream on an open WebSocket: the replay, every batch the hub publishes, a beat, a lifetime, a drop when it lags. */
  function serve(ws: WebSocket, { hub, release }: Admitted): void {
    let ended = false
    const send = (event: 'events' | 'hb', data: string): void => {
      if (ended || ws.readyState !== ws.OPEN) return
      if (ws.bufferedAmount > maxQueued) {
        ws.terminate()
        return
      }
      ws.send(wsFrame(event, data))
    }
    const sendEvents = (events: readonly GameEvent[]): void => send('events', JSON.stringify(events))
    sendEvents(hub.replay())
    const off = hub.subscribe(sendEvents)
    const beat = setInterval(() => send('hb', '1'), heartbeatMs)
    const lifetime = setTimeout(() => ws.close(1000, 'lifetime'), maxLifetimeMs)
    function end(): void {
      if (ended) return
      ended = true
      clearInterval(beat)
      clearTimeout(lifetime)
      off()
      release()
    }
    ws.on('close', end)
    ws.on('error', end)
    ws.on('message', () => ws.close(1003, 'read_only'))
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, path: string): boolean {
    if (path !== WS_PATH) return false
    socket.on('error', () => socket.destroy())
    if (req.method !== 'GET') {
      refuse(socket, { status: 405, body: { error: 'method_not_allowed' }, extra: { Allow: 'GET' } })
      return true
    }
    if (!sameOriginUpgrade(req)) {
      refuse(socket, { status: 403, body: { error: 'cross_origin' } })
      return true
    }
    const admitted = admit(req, new URL(req.url ?? '/', 'http://local'))
    if ('status' in admitted) {
      refuse(socket, admitted)
      return true
    }
    // A handshake `ws` rejects (bad key or version) never reaches the callback: the socket's close gives the place back.
    socket.once('close', admitted.release)
    wss.handleUpgrade(req, socket, head, (ws) => serve(ws, admitted))
    return true
  }

  const routes = (req: IncomingMessage, res: ServerResponse, path: string): boolean => {
    if (path !== '/api/game' && path !== '/api/game/stream') return false
    if (req.method !== 'GET') {
      json(res, deps.headers, 405, { error: 'method_not_allowed' }, { Allow: 'GET' })
      return true
    }
    if (path === '/api/game') info(res)
    else stream(req, res, new URL(req.url ?? '/', 'http://local'))
    return true
  }
  return Object.assign(routes, { upgrade })
}
