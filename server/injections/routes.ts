/**
 * GET /api/injections   JSON: the prompt-injection attempts our agents recorded (db/injections.sql), as the poller
 *                       last read them, or `{enabled: false}` without a database.
 *
 * Public like /api/transcript: the show (which carries no token) shows the panel too. The view holds no value,
 * limit or key of ours: the counterparty's words, which channel, the tags, how to verify it and what our agent did;
 * a duel's row stays behind show.gate (closed duels with no live sibling). A per-address limit on reads.
 *
 * The body is serialised once per snapshot (the poller keeps the same object while the rows do not change) and
 * carries an ETag: a page that already holds it gets a 304 with no body.
 */
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { InjectionsSnapshot } from '../../shared/injections.ts'
import { json } from '../json.ts'
import { RateLimiter } from '../limits.ts'

export interface InjectionsRouteDeps {
  readonly enabled: () => boolean
  readonly snapshot: () => InjectionsSnapshot
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  readonly limiter?: RateLimiter
}

interface Encoded {
  readonly body: string
  readonly etag: string
}

/** The tags an If-None-Match header names (weak or strong), or none. */
function tagsOf(header: string | string[] | undefined): string[] {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '')
  return value.split(',').map((t) => t.trim().replace(/^W\//, '')).filter(Boolean)
}

export function createInjectionsRoutes(deps: InjectionsRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  // the page reads every 10 s; a venue's shared address holds dozens of tabs, and a 304 costs next to nothing
  const limiter = deps.limiter ?? new RateLimiter({ capacity: 60, refillPerSecond: 5 })
  const encoded = new WeakMap<InjectionsSnapshot, Encoded>()
  const encode = (snapshot: InjectionsSnapshot): Encoded => {
    let e = encoded.get(snapshot)
    if (!e) {
      const body = JSON.stringify({ enabled: true, ...snapshot })
      e = { body, etag: `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"` }
      encoded.set(snapshot, e)
    }
    return e
  }
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
    const { body, etag } = encode(deps.snapshot())
    // stored, but always revalidated: the page fetches with `cache: 'no-cache'` and sends the tag back
    const head = { ...deps.headers, 'Cache-Control': 'no-cache', ETag: etag }
    if (tagsOf(req.headers['if-none-match']).includes(etag)) {
      res.writeHead(304, head)
      res.end()
      return true
    }
    res.writeHead(200, { ...head, 'Content-Type': 'application/json; charset=utf-8' })
    res.end(body)
    return true
  }
}
