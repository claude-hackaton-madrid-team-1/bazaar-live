import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { RateLimiter } from '../limits.ts'
import { readProviderConfig } from '../providers.ts'
import type { ApprovalsConfig } from './config.ts'
import { LoginGuard } from './session.ts'

const servers: Server[] = []
afterEach(() => servers.splice(0).forEach((s) => s.close()))

const PASSWORD = 'correct horse battery staple'
const CONFIG: ApprovalsConfig = {
  password: PASSWORD,
  mcpUrl: 'https://bazaar-mcp.test',
  mcpToken: 'mcp-bearer-SECRET-0001',
  approverToken: 'approver-SECRET-0002',
}
const SECRETS = [PASSWORD, CONFIG.mcpToken, CONFIG.approverToken]

interface McpCall {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: { jsonrpc: string; id: number; method: string; params: { name: string; arguments: Record<string, unknown> } }
}

type McpReply = (call: McpCall, init: RequestInit) => Response | Promise<Response>

/** A JSON-RPC answer carrying the tool's text, for the id the call used. */
function toolReply(call: McpCall, payload: unknown, isError = false): Response {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: call.body.id, result: { content: [{ type: 'text', text }], isError } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeMcp(reply: McpReply): { fetchImpl: typeof fetch; calls: McpCall[] } {
  const calls: McpCall[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call: McpCall = { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }
    calls.push(call)
    return reply(call, init)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

function dist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bazaar-live-approvals-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bazaar Live</title>')
  return dir
}

async function start(approvals?: Parameters<typeof createApp>[0]['approvals']): Promise<{ base: string; logs: Record<string, unknown>[] }> {
  const logs: Record<string, unknown>[] = []
  const server = createServer(createApp({ config: readProviderConfig({}), distDir: dist(), log: (e) => logs.push(e), approvals }))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, logs }
}

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

async function login(base: string, address = '203.0.113.7'): Promise<{ cookie: string; csrf: string }> {
  const res = await post(base, '/api/approver/login', { password: PASSWORD }, { 'X-Real-IP': address })
  expect(res.status).toBe(200)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  const { csrf } = (await res.json()) as { csrf: string }
  return { cookie, csrf }
}

const APPROVED = {
  status: 'approved', card: 'SAL-09', side: 'buy', max_price: 260, min_price: null, until_tick: 1150, tick: 910, by: 'human:bazaar-live', notes: ['ok'],
  internal: 'never passed on',
}

const REVOKED = { status: 'revoked', card: 'SAL-09', side: 'buy', tick: 913, by: 'human:bazaar-live' }

const SNAPSHOT = {
  tick: 912,
  threshold: 250,
  pending: [
    {
      card: 'SAL-09', side: 'buy', price: 260, asked_tick: 905, stale_after_tick: 1145, state: 'waiting', counterparty: 'chato', asked_by: 'accept_buy',
      why: 'price 260 ≥ human_approval_above 250', official_value: 177.1, our_value: 150, score_impact: -4.3,
      album: { set: 'SAL', held: 1, page_card: true, last_copy: true }, cap: { max_price: 95, rule: 'max_price_rare' }, secret_field: 'x',
    },
    { card: 'not a card', side: 'buy', price: 1, state: 'waiting' },
  ],
  active: [{ card: 'LAV-10', side: 'sell', max_price: null, min_price: 300, until_tick: 1100, by: 'human:bazaar-live', reason: 'r', created_at: '2026-10-03T20:00:00Z' }],
  limits: { price_min: 1, price_max: 1000, ttl_min: 1, ttl_max: 480, ttl_default: 240, writes_per_minute: 10 },
  notes: ['one note'],
  debug_internal: { token: 'nope' },
}

describe('/api/approver/* with the feature off', () => {
  it('answers every approver path exactly like an unknown /api path', async () => {
    const { base } = await start()
    const unknown = await fetch(`${base}/api/no-such-route`)
    const unknownBody = await unknown.text()
    for (const [method, path] of [['GET', 'session'], ['POST', 'login'], ['POST', 'logout'], ['GET', 'approvals'], ['POST', 'approve'], ['POST', 'revoke']] as const) {
      const res = await fetch(`${base}/api/approver/${path}`, { method, headers: { Origin: base, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ password: PASSWORD }) : undefined })
      expect(res.status).toBe(unknown.status)
      expect(await res.text()).toBe(unknownBody)
      for (const h of ['content-type', 'cache-control', 'content-security-policy', 'set-cookie', 'allow']) expect(res.headers.get(h)).toBe(unknown.headers.get(h))
    }
    expect(unknown.status).toBe(404)
    expect(unknownBody).toBe('{"error":"not_found"}')
  })
})

describe('the approver login', () => {
  it('answers 401 to a wrong password, and sets a strict session cookie on the right one', async () => {
    const { base } = await start({ config: CONFIG, fetchImpl: fakeMcp(() => new Response('', { status: 500 })).fetchImpl })
    const wrong = await post(base, '/api/approver/login', { password: 'not the password at all' })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'unauthorized' })
    expect(wrong.headers.get('set-cookie')).toBeNull()

    const res = await post(base, '/api/approver/login', { password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^bz_approver=[A-Za-z0-9_-]{43}; /)
    const flags = cookie.split(';').slice(1).map((s) => s.trim())
    expect(flags).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/approver', 'Max-Age=7200']))
    const { csrf } = (await res.json()) as { csrf: string }
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookie).not.toContain(csrf)

    const session = await fetch(`${base}/api/approver/session`, { headers: { Cookie: cookie.split(';')[0]! } })
    expect(await session.json()).toEqual({ authenticated: true, csrf })
    const anon = await fetch(`${base}/api/approver/session`)
    expect(await anon.json()).toEqual({ authenticated: false })
  })

  it('locks an address out after 5 failures, even with the right password', async () => {
    const { base } = await start({ config: CONFIG })
    const from = { 'X-Real-IP': '198.51.100.9' }
    for (let i = 0; i < 5; i++) expect((await post(base, '/api/approver/login', { password: `guess-${i}` }, from)).status).toBe(401)
    const locked = await post(base, '/api/approver/login', { password: PASSWORD }, from)
    expect(locked.status).toBe(429)
    expect(await locked.json()).toEqual({ error: 'locked' })
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(14 * 60)
    // another address is not locked by this one
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, { 'X-Real-IP': '198.51.100.10' })).status).toBe(200)
  })

  it('locks everyone out after 20 failures spread over many addresses', async () => {
    const { base } = await start({ config: CONFIG })
    for (let i = 0; i < 20; i++) expect((await post(base, '/api/approver/login', { password: 'nope-nope' }, { 'X-Real-IP': `192.0.2.${i + 1}` })).status).toBe(401)
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, { 'X-Real-IP': '192.0.2.200' })).status).toBe(429)
  })

  it('compares at most 5 guesses even when their headers all arrive before any body (no race past the lock)', async () => {
    const { base } = await start({ config: CONFIG })
    const { hostname, port } = new URL(base)
    // each login on its own socket, headers sent at once, the body held back
    const open = (password: string) => {
      const body = JSON.stringify({ password })
      let status = 0
      const req = request({ hostname, port, path: '/api/approver/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Origin: base, 'X-Real-IP': '198.51.100.77' } })
      const done = new Promise<number>((resolve, reject) => {
        req.on('response', (res) => {
          status = res.statusCode ?? 0
          res.resume()
          res.on('end', () => resolve(status))
        })
        req.on('error', reject)
      })
      req.flushHeaders()
      return { send: () => req.end(body), done }
    }
    const wrong = Array.from({ length: 12 }, (_, i) => open(`guess-number-${i}`))
    const right = open(PASSWORD)
    await new Promise((r) => setTimeout(r, 100))
    wrong.forEach((w) => w.send())
    const wrongStatuses = await Promise.all(wrong.map((w) => w.done))
    right.send()
    expect(await right.done).toBe(429)
    expect(wrongStatuses.filter((s) => s === 401)).toHaveLength(5)
    expect(wrongStatuses.filter((s) => s === 429)).toHaveLength(7)
  })

  it('lets an address that logged in recently past the global lock, never past its own', async () => {
    const { base } = await start({ config: CONFIG })
    const approver = { 'X-Real-IP': '203.0.113.50' }
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, approver)).status).toBe(200)
    for (let i = 0; i < 20; i++) expect((await post(base, '/api/approver/login', { password: 'nope-nope' }, { 'X-Real-IP': `192.0.2.${i + 1}` })).status).toBe(401)
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, { 'X-Real-IP': '192.0.2.200' })).status).toBe(429)
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, approver)).status).toBe(200)
    for (let i = 0; i < 5; i++) expect((await post(base, '/api/approver/login', { password: `bad-${i}` }, approver)).status).toBe(401)
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, approver)).status).toBe(429)
  })

  it('unlocks after the lock time', () => {
    let now = 0
    const guard = new LoginGuard({ now: () => now })
    for (let i = 0; i < 5; i++) guard.fail('a')
    expect(guard.lockedFor('a')).toBe(15 * 60)
    now += 15 * 60 * 1000
    expect(guard.lockedFor('a')).toBe(0)
  })

  it('refuses a cross-origin login, a body that is not JSON, and an oversized body', async () => {
    const { base } = await start({ config: CONFIG })
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await fetch(`${base}/api/approver/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).status).toBe(403)
    expect((await post(base, '/api/approver/login', { password: PASSWORD }, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await post(base, '/api/approver/login', 'password=x')).status).toBe(400)
    expect((await post(base, '/api/approver/login', { password: 'x'.repeat(2000) })).status).toBe(413)
    expect((await fetch(`${base}/api/approver/login`)).status).toBe(405)
  })

  it('logs out: the session ends and the cookie is cleared', async () => {
    const { base } = await start({ config: CONFIG })
    const { cookie } = await login(base)
    const out = await post(base, '/api/approver/logout', {}, { Cookie: cookie })
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await fetch(`${base}/api/approver/approvals`, { headers: { Cookie: cookie } })).status).toBe(401)
  })
})

describe('the approver writes', () => {
  it('needs a session (401), a CSRF token (403) and the same origin (403)', async () => {
    const mcp = fakeMcp((call) => toolReply(call, APPROVED))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const good = { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240 }
    expect((await post(base, '/api/approver/approve', good)).status).toBe(401)
    const { cookie, csrf } = await login(base)
    expect((await post(base, '/api/approver/approve', good, { Cookie: cookie })).status).toBe(403)
    expect((await post(base, '/api/approver/approve', good, { Cookie: cookie, 'x-csrf-token': `${csrf}x` })).status).toBe(403)
    expect((await post(base, '/api/approver/approve', good, { Cookie: cookie, 'x-csrf-token': 'short' })).status).toBe(403)
    expect((await post(base, '/api/approver/approve', good, { Cookie: cookie, 'x-csrf-token': csrf, Origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(base, '/api/approver/revoke', { card: 'SAL-09', side: 'buy' }, { Cookie: cookie })).status).toBe(403)
    expect(mcp.calls).toHaveLength(0)
  })

  it('refuses every input outside the contract with 400 and never calls bazaar-mcp', async () => {
    const mcp = fakeMcp((call) => toolReply(call, APPROVED))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie, csrf } = await login(base)
    const good = { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240 }
    const bad: Record<string, unknown>[] = [
      { ...good, card: 'sal-09' }, { ...good, card: 'SAL-9' }, { ...good, card: 'SAL-09 ' }, { ...good, card: undefined },
      { ...good, side: 'hold' }, { ...good, side: 'BUY' },
      { ...good, price: 0 }, { ...good, price: 1001 }, { ...good, price: 1.5 }, { ...good, price: '260' }, { ...good, price: -5 },
      { ...good, ttl_ticks: 0 }, { ...good, ttl_ticks: 481 }, { ...good, ttl_ticks: 2.5 }, { ...good, ttl_ticks: '240' },
      { ...good, reason: 'x'.repeat(301) }, { ...good, reason: 42 },
    ]
    for (const body of bad) {
      const res = await post(base, '/api/approver/approve', body, { Cookie: cookie, 'x-csrf-token': csrf })
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('bad_request')
    }
    for (const body of [{ card: 'SAL-09', side: 'both' }, { card: 'SAL-09', side: 'buy', reason: 'y'.repeat(301) }]) {
      expect((await post(base, '/api/approver/revoke', body, { Cookie: cookie, 'x-csrf-token': csrf })).status).toBe(400)
    }
    expect((await post(base, '/api/approver/approve', '{not json', { Cookie: cookie, 'x-csrf-token': csrf })).status).toBe(400)
    expect(mcp.calls).toHaveLength(0)
  })

  it('approves through exactly one call to bazaar-mcp, with both tokens server-side and via bazaar-live', async () => {
    const mcp = fakeMcp((call) => toolReply(call, APPROVED))
    const { base, logs } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie, csrf } = await login(base)
    const res = await post(base, '/api/approver/approve', { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 120, reason: ' worth it\u0007 for the page ', extra: 1 }, { Cookie: cookie, 'x-csrf-token': csrf })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ status: 'approved', card: 'SAL-09', side: 'buy', max_price: 260, min_price: null, until_tick: 1150, tick: 910, by: 'human:bazaar-live', notes: ['ok'] })
    expect(mcp.calls).toHaveLength(1)
    const [call] = mcp.calls
    expect(call!.url).toBe('https://bazaar-mcp.test/mcp')
    expect(call!.headers).toMatchObject({
      authorization: `Bearer ${CONFIG.mcpToken}`,
      'x-approver-token': CONFIG.approverToken,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-06-18',
    })
    expect(call!.body).toEqual({
      jsonrpc: '2.0', id: call!.body.id, method: 'tools/call',
      params: { name: 'approve', arguments: { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 120, reason: 'worth it for the page', via: 'bazaar-live' } },
    })
    const logged = JSON.stringify(logs)
    for (const secret of [...SECRETS, csrf, cookie.split('=')[1]!]) {
      expect(text).not.toContain(secret)
      expect(logged).not.toContain(secret)
    }
    expect(logs.filter((l) => l.event === 'approvals.mcp')).toEqual([{ event: 'approvals.mcp', ok: true, status: 200, tool: 'approve' }])
  })

  it('passes a refusal on with its reasons', async () => {
    const refused = { status: 'refused', card: 'SAL-09', side: 'sell', price: 40, reasons: ['the page\u0000s last copy'] }
    const mcp = fakeMcp((call) => toolReply(call, refused))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie, csrf } = await login(base)
    const res = await post(base, '/api/approver/approve', { card: 'SAL-09', side: 'sell', price: 40, ttl_ticks: 240 }, { Cookie: cookie, 'x-csrf-token': csrf })
    expect(await res.json()).toEqual({ status: 'refused', card: 'SAL-09', side: 'sell', price: 40, reasons: ['the page s last copy'] })
  })

  it('revokes (a Deny included) with via bazaar-live', async () => {
    const mcp = fakeMcp((call) => toolReply(call, { status: 'denied', card: 'SAL-09', side: 'buy', tick: 913, by: 'human:bazaar-live' }))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie, csrf } = await login(base)
    const res = await post(base, '/api/approver/revoke', { card: 'SAL-09', side: 'buy', reason: 'denied from Bazaar Live' }, { Cookie: cookie, 'x-csrf-token': csrf })
    expect(await res.json()).toEqual({ status: 'denied', card: 'SAL-09', side: 'buy', tick: 913, by: 'human:bazaar-live' })
    expect(mcp.calls[0]!.body.params).toEqual({ name: 'revoke', arguments: { card: 'SAL-09', side: 'buy', reason: 'denied from Bazaar Live', via: 'bazaar-live' } })
  })

  it('rate limits writes: the session first, then the whole server', async () => {
    const mcp = fakeMcp((call) => toolReply(call, REVOKED))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl, writeLimiter: new RateLimiter({ capacity: 3, refillPerSecond: 0.0001 }) })
    const a = await login(base, '203.0.113.1')
    const b = await login(base, '203.0.113.2')
    const send = (s: { cookie: string; csrf: string }) => post(base, '/api/approver/revoke', { card: 'SAL-09', side: 'buy' }, { Cookie: s.cookie, 'x-csrf-token': s.csrf })
    expect([(await send(a)).status, (await send(a)).status, (await send(b)).status]).toEqual([200, 200, 200])
    const limited = await send(b)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    expect(mcp.calls).toHaveLength(3)
  })

  it('allows 10 writes a minute per session by default, whatever the server-wide room', async () => {
    const mcp = fakeMcp((call) => toolReply(call, REVOKED))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl, writeLimiter: new RateLimiter({ capacity: 100, refillPerSecond: 1 }) })
    const s = await login(base)
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await post(base, '/api/approver/revoke', { card: 'SAL-09', side: 'buy' }, { Cookie: s.cookie, 'x-csrf-token': s.csrf })).status)
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429])
    expect(mcp.calls).toHaveLength(10)
  })
})

describe('reading approvals through bazaar-mcp', () => {
  it('needs a session, then passes on only the contract fields', async () => {
    const mcp = fakeMcp((call) => toolReply(call, SNAPSHOT))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    expect((await fetch(`${base}/api/approver/approvals`)).status).toBe(401)
    const { cookie } = await login(base)
    const res = await fetch(`${base}/api/approver/approvals`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('debug_internal')
    expect(body).toMatchObject({ tick: 912, threshold: 250, skipped: 1, notes: ['one note'] })
    expect((body.pending as unknown[])[0]).not.toHaveProperty('secret_field')
    expect((body.pending as unknown[])[0]).toMatchObject({ card: 'SAL-09', album: { last_copy: true }, cap: { max_price: 95, rule: 'max_price_rare' } })
    expect(mcp.calls[0]!.body.params).toEqual({ name: 'approvals', arguments: {} })
  })

  it('keeps the approver\'s polls apart from anyone asking /session at the same address', async () => {
    const mcp = fakeMcp((call) => toolReply(call, SNAPSHOT))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl, readLimiter: new RateLimiter({ capacity: 1, refillPerSecond: 0.0001 }) })
    const { cookie } = await login(base)
    const shared = { 'X-Real-IP': '203.0.113.7' }
    expect((await fetch(`${base}/api/approver/session`, { headers: shared })).status).toBe(200)
    expect((await fetch(`${base}/api/approver/session`, { headers: shared })).status).toBe(429)
    expect((await fetch(`${base}/api/approver/approvals`, { headers: { ...shared, Cookie: cookie } })).status).toBe(200)
  })

  it('refuses a reply larger than 512 KB, declared or streamed', async () => {
    const big = 'x'.repeat(600 * 1024)
    const declared = fakeMcp(() => new Response(big, { status: 200, headers: { 'content-length': String(big.length), 'content-type': 'application/json' } }))
    const streamed = fakeMcp(() => new Response(new Blob([big]).stream(), { status: 200, headers: { 'content-type': 'application/json' } }))
    for (const mcp of [declared, streamed]) {
      const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
      const { cookie } = await login(base)
      const res = await fetch(`${base}/api/approver/approvals`, { headers: { Cookie: cookie } })
      expect(res.status).toBe(502)
    }
  })

  it('reads the Streamable HTTP SSE form of a reply too', async () => {
    const mcp = fakeMcp((call) => {
      const message = JSON.stringify({ jsonrpc: '2.0', id: call.body.id, result: { content: [{ type: 'text', text: JSON.stringify(SNAPSHOT) }], isError: false } })
      return new Response(`event: message\ndata: ${message}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie } = await login(base)
    expect((await fetch(`${base}/api/approver/approvals`, { headers: { Cookie: cookie } })).status).toBe(200)
  })

  const failures: [string, McpReply][] = [
    ['HTTP 401', () => new Response('{"error":"bad bearer"}', { status: 401 })],
    ['HTTP 403', () => new Response('{"error":"locked approver token"}', { status: 403 })],
    ['HTTP 429', () => new Response('', { status: 429, headers: { 'Retry-After': '30' } })],
    ['HTTP 500', () => new Response('boom', { status: 500 })],
    ['a network error', () => Promise.reject(new TypeError(`fetch failed to ${CONFIG.mcpUrl} with ${CONFIG.mcpToken}`))],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    ['another id', (call) => toolReply({ ...call, body: { ...call.body, id: call.body.id + 1 } }, SNAPSHOT)],
    ['no result', (call) => new Response(JSON.stringify({ jsonrpc: '2.0', id: call.body.id, error: { code: -32601, message: 'x' } }), { status: 200 })],
    ['a tool text that is not JSON', (call) => toolReply(call, 'not json')],
    ['a snapshot of the wrong shape', (call) => toolReply(call, { tick: 'soon', pending: [], active: [] })],
  ]
  for (const [name, reply] of failures) {
    it(`answers 502 "approvals unavailable" on ${name}, echoing nothing`, async () => {
      const mcp = fakeMcp(reply)
      const { base, logs } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
      const { cookie } = await login(base)
      const res = await fetch(`${base}/api/approver/approvals`, { headers: { Cookie: cookie } })
      expect(res.status).toBe(502)
      expect(await res.text()).toBe('{"error":"approvals unavailable"}')
      expect(mcp.calls).toHaveLength(1)
      const logged = JSON.stringify(logs)
      for (const secret of SECRETS) expect(logged).not.toContain(secret)
      expect(logs.find((l) => l.event === 'approvals.mcp')).toEqual({ event: 'approvals.mcp', ok: false, status: 502, tool: 'approvals' })
    })
  }

  it('answers 502 when bazaar-mcp does not answer in time', async () => {
    const mcp = fakeMcp((_call, init) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl, timeoutMs: 30 })
    const { cookie } = await login(base)
    const res = await fetch(`${base}/api/approver/approvals`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'approvals unavailable' })
  })

  it('keeps a tool error\'s own words out of the answer', async () => {
    const mcp = fakeMcp((call) => toolReply(call, 'invalid arguments: <script>alert(1)</script>', true))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie, csrf } = await login(base)
    const res = await post(base, '/api/approver/revoke', { card: 'SAL-09', side: 'buy' }, { Cookie: cookie, 'x-csrf-token': csrf })
    expect(res.status).toBe(502)
    expect(await res.text()).toBe('{"error":"tool_error"}')
  })

  it('turns the tool\'s own rate limit into a 429', async () => {
    const mcp = fakeMcp((call) => toolReply(call, 'rate limited: 10 writes per minute', true))
    const { base } = await start({ config: CONFIG, fetchImpl: mcp.fetchImpl })
    const { cookie, csrf } = await login(base)
    const res = await post(base, '/api/approver/approve', { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240 }, { Cookie: cookie, 'x-csrf-token': csrf })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
  })
})
