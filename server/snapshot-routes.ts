/**
 * GET <path>  JSON: a poller's last snapshot as `{enabled: true, ...snapshot}`, or `{enabled: false, tokenRequired}`
 *             without a database. Behind /api/history, /api/learn, /api/rivals, /api/strategy and /api/venue.
 *
 * GAME_VIEW_TOKEN, when set, is required as `?token=`, exactly like the game stream. A per-address limit on reads.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tokenMatches } from './game/routes.ts'
import { json } from './json.ts'
import { RateLimiter, type BucketOptions } from './limits.ts'

export interface SnapshotRouteDeps<S extends object> {
  readonly enabled: () => boolean
  readonly snapshot: () => S
  /** GAME_VIEW_TOKEN, or null: open to anyone with the URL. */
  readonly token: string | null
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  readonly limiter?: RateLimiter
}

/** `reads`: the per-address limit when `deps.limiter` is not given, sized to how often the page reads. */
export function createSnapshotRoutes<S extends object>(
  path: string,
  reads: BucketOptions,
  deps: SnapshotRouteDeps<S>,
): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  const limiter = deps.limiter ?? new RateLimiter(reads)
  return (req, res, reqPath) => {
    if (reqPath !== path) return false
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
