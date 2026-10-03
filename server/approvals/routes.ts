/**
 * The Approvals screen's API (HA2): a human approves or denies the big trades our own agents refused, through
 * bazaar-mcp's human tools, called from here. The browser never sees a token: it holds a session cookie (HttpOnly,
 * Secure, SameSite=Strict, Path=/api/approver) and a CSRF token kept in memory.
 *
 *   GET  /api/approver/session    {authenticated, csrf?}
 *   POST /api/approver/login      {password} → {csrf} + the cookie; 401 wrong, 429 locked out
 *   POST /api/approver/logout     drops the session and the cookie
 *   GET  /api/approver/approvals  the `approvals` tool's answer, checked field by field
 *   POST /api/approver/approve    {card, side, price, ttl_ticks, reason?} → the `approve` tool's answer
 *   POST /api/approver/revoke     {card, side, reason?} → the `revoke` tool's answer (a Deny is a revoke)
 *
 * Off (any of the four variables unset) this module is never mounted, and every one of these paths answers exactly
 * like an unknown /api path. Writes need the cookie, the `x-csrf-token` header and a same-origin request, are checked
 * against the contract's ranges, and are rate limited (the whole server and each session). Logs carry only
 * {event, ok, status, tool}: never a token, the password, a cookie, a CSRF value or a body.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  approvalsOf, approveInputOf, approveResultOf, revokeInputOf, revokeResultOf, VIA,
  type ApproveInput, type RevokeInput,
} from '../../shared/approvals.ts'
import { RateLimiter } from '../limits.ts'
import type { ApprovalsConfig } from './config.ts'
import { createMcpClient, McpToolError, type HumanTool } from './mcp.ts'
import { clearedCookie, cookieOf, LoginGuard, secretEquals, sessionCookie, SessionStore, type Session } from './session.ts'

export const PREFIX = '/api/approver/'
const MAX_BODY = 1024
const MAX_PASSWORD = 512
const UNAVAILABLE = { error: 'approvals unavailable' }

type Route = 'session' | 'login' | 'logout' | 'approvals' | 'approve' | 'revoke'
const METHOD: Readonly<Record<Route, 'GET' | 'POST'>> = {
  session: 'GET', login: 'POST', logout: 'POST', approvals: 'GET', approve: 'POST', revoke: 'POST',
}
const isRoute = (s: string): s is Route => Object.hasOwn(METHOD, s)

export interface ApprovalsRouteDeps {
  readonly config: ApprovalsConfig
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  /** app.ts's Origin check, the same the TTS proxy uses. */
  readonly sameOrigin: (req: IncomingMessage) => boolean
  /** app.ts's body reader: the text, or null past `limit` bytes. */
  readonly readBody: (req: IncomingMessage, limit: number) => Promise<string | null>
  readonly fetchImpl?: typeof fetch
  readonly log?: (entry: Record<string, unknown>) => void
  readonly timeoutMs?: number
  readonly sessions?: SessionStore
  readonly guard?: LoginGuard
  /** Writes, the whole server: 10 a minute. */
  readonly writeLimiter?: RateLimiter
  /** Writes, per session: 6 a minute. */
  readonly sessionWriteLimiter?: RateLimiter
  /** Reads (session, approvals), per address: the page polls every 10 s. */
  readonly readLimiter?: RateLimiter
}

type Reply = (status: number, body: unknown, extra?: Record<string, string>) => void

export function createApprovalsRoutes(deps: ApprovalsRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean> {
  const log = deps.log ?? (() => undefined)
  const sessions = deps.sessions ?? new SessionStore()
  const guard = deps.guard ?? new LoginGuard()
  const writes = deps.writeLimiter ?? new RateLimiter({ capacity: 10, refillPerSecond: 10 / 60 })
  const sessionWrites = deps.sessionWriteLimiter ?? new RateLimiter({ capacity: 6, refillPerSecond: 6 / 60 })
  const reads = deps.readLimiter ?? new RateLimiter({ capacity: 30, refillPerSecond: 0.5 })
  const call = createMcpClient({ config: deps.config, fetchImpl: deps.fetchImpl ?? fetch, timeoutMs: deps.timeoutMs })

  const sessionOf = (req: IncomingMessage): Session | null => sessions.get(cookieOf(req.headers.cookie))

  /** The tool's answer through `check`, or the reply that says why not. */
  async function tool<T>(reply: Reply, name: HumanTool, args: Record<string, unknown>, check: (body: unknown) => T | null): Promise<void> {
    let status = 200
    try {
      const checked = check(await call(name, args))
      if (checked === null) {
        status = 502
        return reply(502, UNAVAILABLE)
      }
      return reply(200, checked)
    } catch (error: unknown) {
      if (error instanceof McpToolError) {
        status = error.rateLimited ? 429 : 502
        return error.rateLimited ? reply(429, { error: 'rate_limited' }, { 'Retry-After': '60' }) : reply(502, { error: 'tool_error' })
      }
      status = 502
      return reply(502, UNAVAILABLE)
    } finally {
      log({ event: 'approvals.mcp', ok: status === 200, status, tool: name })
    }
  }

  /** A JSON body of at most MAX_BODY bytes, parsed; or the reply already sent. */
  async function body(req: IncomingMessage, res: ServerResponse, reply: Reply): Promise<{ ok: true; value: unknown } | { ok: false }> {
    const mediaType = String(req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') {
      reply(415, { error: 'json_only' })
      return { ok: false }
    }
    const raw = await deps.readBody(req, MAX_BODY)
    if (raw === null) {
      res.on('finish', () => req.socket.destroy())
      reply(413, { error: 'too_large' }, { Connection: 'close' })
      return { ok: false }
    }
    try {
      return { ok: true, value: JSON.parse(raw) as unknown }
    } catch {
      reply(400, { error: 'bad_request', message: 'body is not JSON' })
      return { ok: false }
    }
  }

  function readAllowed(req: IncomingMessage, reply: Reply): boolean {
    const taken = reads.take(deps.address(req))
    if (!taken.ok) reply(429, { error: 'rate_limited' }, { 'Retry-After': String(taken.retryAfterSeconds) })
    return taken.ok
  }

  async function login(req: IncomingMessage, res: ServerResponse, reply: Reply): Promise<void> {
    if (!deps.sameOrigin(req)) return reply(403, { error: 'cross_origin' })
    const address = deps.address(req)
    const locked = guard.lockedFor(address)
    if (locked > 0) {
      log({ event: 'approvals.login', ok: false, status: 429 })
      return reply(429, { error: 'locked' }, { 'Retry-After': String(locked) })
    }
    const parsed = await body(req, res, reply)
    if (!parsed.ok) return
    const password = typeof parsed.value === 'object' && parsed.value !== null ? (parsed.value as Record<string, unknown>).password : undefined
    if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD) {
      return reply(400, { error: 'bad_request', message: 'password must be text' })
    }
    // wrong and right take the same path: two hashes and one constant-time compare
    if (!secretEquals(password, deps.config.password)) {
      guard.fail(address)
      log({ event: 'approvals.login', ok: false, status: 401 })
      return reply(401, { error: 'unauthorized' })
    }
    guard.succeed(address)
    const session = sessions.create()
    log({ event: 'approvals.login', ok: true, status: 200 })
    return reply(200, { csrf: session.csrf }, { 'Set-Cookie': sessionCookie(session.id) })
  }

  /** The checks every write passes before its body is even read: origin, session, CSRF. */
  function writer(req: IncomingMessage, reply: Reply): Session | null {
    if (!deps.sameOrigin(req)) {
      reply(403, { error: 'cross_origin' })
      return null
    }
    const session = sessionOf(req)
    if (!session) {
      reply(401, { error: 'unauthorized' })
      return null
    }
    const header = req.headers['x-csrf-token']
    const csrf = Array.isArray(header) ? header[0] : header
    if (typeof csrf !== 'string' || !secretEquals(csrf, session.csrf)) {
      reply(403, { error: 'csrf' })
      return null
    }
    return session
  }

  /** Both write buckets, spent only when both allow it. */
  function writeAllowed(session: Session, reply: Reply): boolean {
    const limited = [sessionWrites.peek(session.id), writes.peek('*')].find((r) => !r.ok)
    if (limited && !limited.ok) {
      reply(429, { error: 'rate_limited' }, { 'Retry-After': String(limited.retryAfterSeconds) })
      return false
    }
    sessionWrites.take(session.id)
    writes.take('*')
    return true
  }

  async function write(req: IncomingMessage, res: ServerResponse, reply: Reply, route: 'approve' | 'revoke'): Promise<void> {
    const session = writer(req, reply)
    if (!session) return
    const parsed = await body(req, res, reply)
    if (!parsed.ok) return
    const input: ApproveInput | RevokeInput | string = route === 'approve' ? approveInputOf(parsed.value) : revokeInputOf(parsed.value)
    if (typeof input === 'string') return reply(400, { error: 'bad_request', message: input })
    if (!writeAllowed(session, reply)) return
    const args = { ...input, via: VIA }
    return route === 'approve' ? tool(reply, 'approve', args, approveResultOf) : tool(reply, 'revoke', args, revokeResultOf)
  }

  return async (req, res, path) => {
    if (!path.startsWith(PREFIX)) return false
    const route = path.slice(PREFIX.length)
    if (!isRoute(route)) return false
    const reply: Reply = (status, payload, extra = {}) => {
      res.writeHead(status, { ...deps.headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
      res.end(JSON.stringify(payload))
    }
    const method = METHOD[route]
    if (req.method !== method) {
      reply(405, { error: 'method_not_allowed' }, { Allow: method })
      return true
    }
    switch (route) {
      case 'session': {
        if (!readAllowed(req, reply)) return true
        const session = sessionOf(req)
        // a cookie that names no live session (expired, or the server restarted) is cleared
        const stale = !session && cookieOf(req.headers.cookie) !== null ? { 'Set-Cookie': clearedCookie() } : undefined
        reply(200, session ? { authenticated: true, csrf: session.csrf } : { authenticated: false }, stale)
        return true
      }
      case 'login':
        await login(req, res, reply)
        return true
      case 'logout': {
        if (!deps.sameOrigin(req)) {
          reply(403, { error: 'cross_origin' })
          return true
        }
        const session = sessionOf(req)
        if (session) sessions.drop(session.id)
        reply(200, { ok: true }, { 'Set-Cookie': clearedCookie() })
        return true
      }
      case 'approvals': {
        const session = sessionOf(req)
        if (!session) {
          reply(401, { error: 'unauthorized' })
          return true
        }
        if (!readAllowed(req, reply)) return true
        await tool(reply, 'approvals', {}, approvalsOf)
        return true
      }
      case 'approve':
      case 'revoke':
        await write(req, res, reply, route)
        return true
    }
  }
}
