import { describe, expect, it } from 'vitest'
import { EMPTY_INJECTIONS, type InjectionsSnapshot } from '../../shared/injections.ts'
import { createApp } from '../app.ts'
import { RateLimiter } from '../limits.ts'
import { readProviderConfig } from '../providers.ts'
import { INJECTIONS_OFF, startInjections } from './start.ts'

async function call(app: ReturnType<typeof createApp>, url: string, method = 'GET', extra: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }> {
  let status = 0
  let raw = ''
  let headers: Record<string, string> = {}
  const req = { url, method, headers: { host: 'local', ...extra }, socket: { remoteAddress: '127.0.0.1' }, on: () => undefined }
  const res = {
    headersSent: false,
    writeHead(s: number, h: Record<string, string> = {}) {
      status = s
      headers = h
      this.headersSent = true
      return this
    },
    end(chunk?: string) {
      raw += chunk ?? ''
    },
    on: () => undefined,
  }
  await app(req as never, res as never)
  return { status, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}, headers }
}

const SNAPSHOT: InjectionsSnapshot = {
  at: '2026-10-03T10:00:00.000Z', ready: true, counts: { attempt: 1, weak: 0 },
  rows: [{ id: 1, tick: 4, source: 'feed', from: 't03', toUs: false, tags: ['role_tag'], severity: 'attempt', raw: '</script><b>x</b>', ourResponse: 'ignored', proof: 'GET /api/feed event 1', seenAt: null }],
}

const app = (injections?: Parameters<typeof createApp>[0]['injections']) => createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, injections })

describe('GET /api/injections', () => {
  it('answers enabled: false without a database', async () => {
    expect(await call(app(), '/api/injections')).toMatchObject({ status: 200, body: { enabled: false } })
  })

  it('serves the snapshot as JSON, the hostile text as a JSON string (never markup)', async () => {
    const r = await call(app({ enabled: () => true, snapshot: () => SNAPSHOT }), '/api/injections')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ enabled: true, ...SNAPSHOT })
  })

  it('answers 304 with no body when the page already holds this snapshot (ETag), and a new body once it changes', async () => {
    let snapshot = SNAPSHOT
    const a = app({ enabled: () => true, snapshot: () => snapshot })
    const first = await call(a, '/api/injections')
    const etag = first.headers.ETag ?? ''
    expect(etag).toMatch(/^"[\w-]{27}"$/)
    expect(first.headers['Cache-Control']).toBe('no-cache')
    expect(await call(a, '/api/injections', 'GET', { 'if-none-match': etag })).toMatchObject({ status: 304, body: {} })
    expect((await call(a, '/api/injections', 'GET', { 'if-none-match': `W/${etag}, "other"` })).status).toBe(304)
    expect((await call(a, '/api/injections', 'GET', { 'if-none-match': '"stale"' })).status).toBe(200)
    snapshot = { ...SNAPSHOT, counts: { attempt: 2, weak: 0 } }
    const next = await call(a, '/api/injections', 'GET', { 'if-none-match': etag })
    expect(next.status).toBe(200)
    expect(next.headers.ETag).not.toBe(etag)
  })

  it('serves the empty state when the view is missing', async () => {
    const r = await call(app({ enabled: () => true, snapshot: () => EMPTY_INJECTIONS }), '/api/injections')
    expect(r.body).toEqual({ enabled: true, at: null, ready: false, counts: { attempt: 0, weak: 0 }, rows: [] })
  })

  it('refuses anything but GET, and limits reads per address', async () => {
    expect((await call(app({ enabled: () => true, snapshot: () => SNAPSHOT }), '/api/injections', 'POST')).status).toBe(405)
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, limiter: new RateLimiter({ capacity: 1, refillPerSecond: 0.001 }) })
    expect((await call(a, '/api/injections')).status).toBe(200)
    expect((await call(a, '/api/injections')).status).toBe(429)
  })
})

describe('startInjections', () => {
  it('is off without the shared pool', () => {
    const logs: Record<string, unknown>[] = []
    expect(startInjections((e) => logs.push(e), null)).toBe(INJECTIONS_OFF)
    expect(logs).toEqual([{ route: 'injections', event: 'off', reason: 'no SHOW_DATABASE_URL' }])
  })

  it('polls the shared pool and serves what it read', async () => {
    const pool = { query: () => Promise.resolve({ rows: [] }), end: () => Promise.resolve() }
    const on = startInjections(() => undefined, { pool, secrets: [] })
    await new Promise((r) => setTimeout(r, 0))
    expect(on.enabled()).toBe(true)
    expect(on.snapshot()).toMatchObject({ ready: true, rows: [] })
    on.stop()
  })
})
