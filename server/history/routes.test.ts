import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY } from '../../shared/history.ts'
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

const app = (history?: Parameters<typeof createApp>[0]['history']) => createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, history })
const SNAPSHOT = { ...EMPTY_HISTORY, at: '2026-10-03T10:00:00.000Z', points: [{ day: '2026-10-03', tick: 1, cash: 400, score: null, rank: null }] }

describe('GET /api/history', () => {
  it('answers enabled: false without a database', async () => {
    expect(await get(app(), '/api/history')).toEqual({ status: 200, body: { enabled: false, tokenRequired: false } })
  })

  it('asks for the token when there is one, and serves the snapshot with it', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/history')).status).toBe(401)
    const ok = await get(a, '/api/history?token=secret')
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ enabled: true, points: [{ cash: 400 }] })
  })
})
