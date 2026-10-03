/**
 * GET /api/learn   JSON: what our agents learned (db/learn.sql), as the poller last read it, or `{enabled: false}`
 *                  without a database.
 *
 * This is the team's private memory (lessons, learned ladders, rivals' profiles): GAME_VIEW_TOKEN, when set,
 * is required as `?token=`, exactly like the game stream. A per-address limit on reads.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LearnSnapshot } from '../../shared/learn.ts'
import { tokenMatches } from '../game/routes.ts'
import { RateLimiter } from '../limits.ts'

export interface LearnRouteDeps {
  readonly enabled: () => boolean
  readonly snapshot: () => LearnSnapshot
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

export function createLearnRoutes(deps: LearnRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  // the page reads every 10 s; a few tabs and a reload fit
  const limiter = deps.limiter ?? new RateLimiter({ capacity: 20, refillPerSecond: 0.5 })
  return (req, res, path) => {
    if (path !== '/api/learn') return false
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
