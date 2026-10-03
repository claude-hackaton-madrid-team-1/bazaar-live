import { describe, expect, it } from 'vitest'
import { EMPTY_RIVALS } from '../../shared/rivals.ts'
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

const app = (rivals?: Parameters<typeof createApp>[0]['rivals']) => createApp({ config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined, rivals })
const SNAPSHOT = { ...EMPTY_RIVALS, at: '2026-10-03T10:00:00.000Z', tick: 856 }

describe('GET /api/rivals', () => {
  it('is not served without the token even when the token is wrong', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/rivals?token=nope')).status).toBe(401)
  })

  it('answers enabled: false without a database', async () => {
    expect(await get(app(), '/api/rivals')).toEqual({ status: 200, body: { enabled: false, tokenRequired: false } })
  })

  it('asks for the token when there is one, and serves the snapshot with it', async () => {
    const a = app({ enabled: () => true, snapshot: () => SNAPSHOT, token: 'secret' })
    expect((await get(a, '/api/rivals')).status).toBe(401)
    const ok = await get(a, '/api/rivals?token=secret')
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ enabled: true, tick: 856 })
  })
})
