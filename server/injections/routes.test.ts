import { describe, expect, it } from 'vitest'
import { EMPTY_INJECTIONS, type InjectionsSnapshot } from '../../shared/injections.ts'
import { createApp } from '../app.ts'
import { RateLimiter } from '../limits.ts'
import { readProviderConfig } from '../providers.ts'
import { INJECTIONS_OFF, startInjections } from './start.ts'

async function call(app: ReturnType<typeof createApp>, url: string, method = 'GET'): Promise<{ status: number; body: Record<string, unknown> }> {
  let status = 0
  let raw = ''
  const req = { url, method, headers: { host: 'local' }, socket: { remoteAddress: '127.0.0.1' }, on: () => undefined }
  const res = {
    headersSent: false,
    writeHead(s: number) {
      status = s
      this.headersSent = true
      return this
    },
    end(chunk?: string) {
      raw += chunk ?? ''
    },
    on: () => undefined,
  }
  await app(req as never, res as never)
  return { status, body: JSON.parse(raw) as Record<string, unknown> }
}

const SNAPSHOT: InjectionsSnapshot = {
  at: '2026-10-03T10:00:00.000Z', ready: true, counts: { attempt: 1, weak: 0 },
  rows: [{ id: 1, tick: 4, source: 'feed', from: 't03', toUs: false, tags: ['role_tag'], severity: 'attempt', raw: '</script><b>x</b>', ourResponse: 'ignored', proof: 'GET /api/feed event 1', seenAt: null }],
}

const app = (injections?: Parameters<typeof createApp>[0]['injections']) => createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, injections })

describe('GET /api/injections', () => {
  it('answers enabled: false without a database', async () => {
    expect(await call(app(), '/api/injections')).toEqual({ status: 200, body: { enabled: false } })
  })

  it('serves the snapshot as JSON, the hostile text as a JSON string (never markup)', async () => {
    const r = await call(app({ enabled: () => true, snapshot: () => SNAPSHOT }), '/api/injections')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ enabled: true, ...SNAPSHOT })
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
