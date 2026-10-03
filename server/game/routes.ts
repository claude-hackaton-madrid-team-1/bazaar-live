/**
 * GET /api/game          JSON: {enabled, target, source, tokenRequired, sockets}: whether the game screens have a feed, and
 *                        where it comes from ('db': our database's views, 'api': the game's API with the team key);
 *                        `sockets`: each agent's /events socket (state, last live event) while ./agentsws.ts runs, else null
 * GET /api/game/stream   SSE: `events` with the replay (sticky first, then the backlog), then one `events`
 *                        per batch the relay publishes; `hb` every few seconds
 *
 * These carry the team's private state (cash, assets and their values, the album), read with the team
 * key: GAME_VIEW_TOKEN, when set, is required on the stream as `?token=`. A cap on open streams (per
 * address and in all), a per-address limit on opening them, and a drop for any client that stops reading.
 */
import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

function json(res: ServerResponse, headers: Readonly<Record<string, string>>, status: number, body: unknown, extra: Record<string, string> = {}): void {
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

export function createGameRoutes(deps: GameRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  const maxStreams = deps.maxStreams ?? 100
  const maxPerAddress = deps.maxPerAddress ?? 6
  const heartbeatMs = deps.heartbeatMs ?? 15_000
  const maxLifetimeMs = deps.maxLifetimeMs ?? 30 * 60_000
  const openLimiter = deps.openLimiter ?? new RateLimiter({ capacity: 12, refillPerSecond: 0.2 })
  // The replay alone can be a few MB (5000 events): the cap is above it.
  const maxQueued = deps.maxQueuedBytes ?? 8 * 1024 * 1024
  const perAddress = new Map<string, number>()
  let open = 0

  function info(res: ServerResponse): void {
    const enabled = deps.enabled() && deps.hub !== null
    const source = enabled ? (deps.source?.() ?? 'api') : null
    json(res, deps.headers, 200, { enabled, target: enabled ? deps.target : null, source, tokenRequired: deps.token !== null, sockets: deps.sockets?.() ?? null })
  }

  function stream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const hub = deps.hub
    if (!deps.enabled() || hub === null) return json(res, deps.headers, 404, { error: 'game_off' })
    if (deps.token !== null && !tokenMatches(url.searchParams.get('token'), deps.token)) return json(res, deps.headers, 401, { error: 'token_required' })
    const address = deps.address(req)
    const opened = openLimiter.take(address)
    if (!opened.ok) return json(res, deps.headers, 429, { error: 'rate_limited' }, { 'Retry-After': String(opened.retryAfterSeconds) })
    if (open >= maxStreams || (perAddress.get(address) ?? 0) >= maxPerAddress) {
      return json(res, deps.headers, 429, { error: 'too_many_streams' }, { 'Retry-After': '10' })
    }
    open += 1
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1)
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
      open -= 1
      const left = (perAddress.get(address) ?? 1) - 1
      if (left <= 0) perAddress.delete(address)
      else perAddress.set(address, left)
      res.end()
    }
    req.on('close', end)
    res.on('close', end)
    res.on('error', end)
  }

  return (req, res, path) => {
    if (path !== '/api/game' && path !== '/api/game/stream') return false
    if (req.method !== 'GET') {
      json(res, deps.headers, 405, { error: 'method_not_allowed' }, { Allow: 'GET' })
      return true
    }
    if (path === '/api/game') info(res)
    else stream(req, res, new URL(req.url ?? '/', 'http://local'))
    return true
  }
}
