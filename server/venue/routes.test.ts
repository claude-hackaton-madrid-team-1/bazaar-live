import { describe, expect, it } from 'vitest'
import { EMPTY_VENUE } from '../../shared/venue.ts'
import { createApp } from '../app.ts'
import { readProviderConfig } from '../providers.ts'

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

const app = (venue?: Parameters<typeof createApp>[0]['venue']) => createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, venue })
const SNAPSHOT = { ...EMPTY_VENUE, at: '2026-10-03T10:00:00.000Z', venues: [{ venue: 'v19', name: null, mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open' as const, openedTick: 900, current: true, counted: true }] }

describe('GET /api/venue', () => {
  it('is not served without the token even when the token is wrong', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/venue?token=nope')).status).toBe(401)
  })

  it('answers enabled: false without a database', async () => {
    expect(await get(app(), '/api/venue')).toEqual({ status: 200, body: { enabled: false, tokenRequired: false } })
  })

  it('asks for the token when there is one, and serves the snapshot with it', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/venue')).status).toBe(401)
    const ok = await get(a, '/api/venue?token=secret')
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ enabled: true, venues: [{ venue: 'v19' }] })
  })
})
