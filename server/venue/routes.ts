/**
 * GET /api/venue  JSON: our venue, the Market Test sessions, the books our broker saw and what it matched, and other
 *                 teams on our venue (db/venue.sql), as the poller last read it, or `{enabled: false}` without a database.
 *
 * Our broker's moves and our private score parts: GAME_VIEW_TOKEN, when set, is required as `?token=`, exactly like the
 * game stream, /api/strategy and /api/history. A per-address limit on reads.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { VenueSnapshot } from '../../shared/venue.ts'
import { tokenMatches } from '../game/routes.ts'
import { RateLimiter } from '../limits.ts'

export interface VenueRouteDeps {
  readonly enabled: () => boolean
  readonly snapshot: () => VenueSnapshot
  /** GAME_VIEW_TOKEN, or null: open to anyone with the URL. */
  readonly token: string | null
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  readonly limiter?: RateLimiter
}

function json(res: ServerResponse, headers: Readonly<Record<string, string>>, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

export function createVenueRoutes(deps: VenueRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  // the page reads every 5 s (3 s while a session runs); a few tabs and a reload fit
  const limiter = deps.limiter ?? new RateLimiter({ capacity: 40, refillPerSecond: 1 })
  return (req, res, path) => {
    if (path !== '/api/venue') return false
    if (req.method !== 'GET') {
      json(res, deps.headers, 405, { error: 'method_not_allowed' }, { Allow: 'GET' })
      return true
    }
    if (!deps.enabled()) {
      json(res, deps.headers, 200, { enabled: false, tokenRequired: deps.token !== null })
      return true
    }
    const url = new URL(req.url ?? '/', 'http://local')
    if (deps.token !== null && !tokenMatches(url.searchParams.get('token'), deps.token)) {
      json(res, deps.headers, 401, { error: 'token_required' })
      return true
    }
    const taken = limiter.take(deps.address(req))
    if (!taken.ok) {
      json(res, deps.headers, 429, { error: 'rate_limited' }, { 'Retry-After': String(taken.retryAfterSeconds) })
      return true
    }
    json(res, deps.headers, 200, { enabled: true, ...deps.snapshot() })
    return true
  }
}
