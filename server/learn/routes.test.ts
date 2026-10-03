import { describe, expect, it } from 'vitest'
import { EMPTY_LEARN } from '../../shared/learn.ts'
import { createApp } from '../app.ts'
import { readProviderConfig } from '../providers.ts'
import { RateLimiter } from '../limits.ts'

/** A tiny request/response pair, enough for the app's router. */
async function get(app: ReturnType<typeof createApp>, url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let status = 0
  let raw = ''
  const req = { url, method: 'GET', headers: { host: 'local' }, socket: { remoteAddress: '127.0.0.1' }, on: () => undefined }
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

const SNAPSHOT = { ...EMPTY_LEARN, at: '2026-10-03T10:00:00.000Z', learnings: [{ id: 1, subjectKind: 'dealer', subject: 'abuela', kind: 'lesson', claim: 'x', source: 'outcome', confidence: 0.5, support: 2, createdTick: 1, untilTick: null, team: null, stats: null }] }

function app(learn?: Parameters<typeof createApp>[0]['learn']) {
  return createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, learn })
}

describe('GET /api/learn', () => {
  it('answers enabled: false without a database', async () => {
    expect(await get(app(), '/api/learn')).toEqual({ status: 200, body: { enabled: false, tokenRequired: false } })
  })

  it('serves the snapshot when there is no token to ask for', async () => {
    const r = await get(app({ enabled: () => true, snapshot: () => SNAPSHOT, token: null }), '/api/learn')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ enabled: true, at: SNAPSHOT.at })
    expect((r.body.learnings as unknown[]).length).toBe(1)
  })

  it('asks for GAME_VIEW_TOKEN when it is set', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'tok-123' })
    expect((await get(a, '/api/learn')).status).toBe(401)
    expect((await get(a, '/api/learn?token=nope')).status).toBe(401)
    expect((await get(a, '/api/learn?token=tok-123')).status).toBe(200)
  })

  it('limits reads per address', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: null, limiter: new RateLimiter({ capacity: 1, refillPerSecond: 0.001 }) })
    expect((await get(a, '/api/learn')).status).toBe(200)
    expect((await get(a, '/api/learn')).status).toBe(429)
  })
})
