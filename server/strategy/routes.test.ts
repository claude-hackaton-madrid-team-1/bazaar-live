import { describe, expect, it } from 'vitest'
import { EMPTY_STRATEGY } from '../../shared/strategy.ts'
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

const app = (strategy?: Parameters<typeof createApp>[0]["strategy"]) => createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, strategy })
const SNAPSHOT = { ...EMPTY_STRATEGY, at: '2026-10-03T10:00:00.000Z', spend: { ledgerTick: 629, tHours: 6.57, spent: 0, buys: 0 } }

describe('GET /api/strategy', () => {
  it('is not served without the token even when the token is wrong', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/strategy?token=nope')).status).toBe(401)
  })

  it('answers enabled: false without a database', async () => {
    expect(await get(app(), '/api/strategy')).toEqual({ status: 200, body: { enabled: false, tokenRequired: false } })
  })

  it('asks for the token when there is one, and serves the snapshot with it', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/strategy')).status).toBe(401)
    const ok = await get(a, '/api/strategy?token=secret')
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ enabled: true, spend: { spent: 0 } })
  })
})
