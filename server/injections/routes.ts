/**
 * GET /api/injections   JSON: the prompt-injection attempts our agents recorded (db/injections.sql), as the poller
 *                       last read them, or `{enabled: false}` without a database.
 *
 * Public like /api/transcript: the show (which carries no token) shows the panel too. The view holds no value,
 * limit or key of ours: the counterparty's words, which channel, the tags, how to verify it and what our agent did;
 * a duel's row stays behind show.gate until the last session. A per-address limit on reads.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { InjectionsSnapshot } from '../../shared/injections.ts'
import { RateLimiter } from '../limits.ts'

export interface InjectionsRouteDeps {
  readonly enabled: () => boolean
  readonly snapshot: () => InjectionsSnapshot
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  readonly limiter?: RateLimiter
}

function json(res: ServerResponse, headers: Readonly<Record<string, string>>, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

export function createInjectionsRoutes(deps: InjectionsRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  // the page reads every 10 s; a few tabs and a reload fit
  const limiter = deps.limiter ?? new RateLimiter({ capacity: 20, refillPerSecond: 0.5 })
  return (req, res, path) => {
    if (path !== '/api/injections') return false
    if (req.method !== 'GET') {
      json(res, deps.headers, 405, { error: 'method_not_allowed' }, { Allow: 'GET' })
      return true
    }
    if (!deps.enabled()) {
      json(res, deps.headers, 200, { enabled: false })
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
