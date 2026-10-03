import { describe, expect, it } from 'vitest'
import { mcpBaseOf, readApprovalsConfig } from './config.ts'
import { cookieOf, deviceIdOf, newDevice, secretEquals, SessionStore } from './session.ts'

describe('secretEquals', () => {
  it('compares in constant time and never throws on unequal lengths', () => {
    expect(secretEquals('a', 'a')).toBe(true)
    expect(secretEquals('a', 'b')).toBe(false)
    expect(() => secretEquals('', 'a much longer secret than the input')).not.toThrow()
    expect(secretEquals('', 'a much longer secret than the input')).toBe(false)
    expect(secretEquals('ñ'.repeat(40), 'n')).toBe(false)
  })
})

describe('SessionStore', () => {
  it('expires a session after its lifetime', () => {
    let now = 0
    const store = new SessionStore({ now: () => now, ttlMs: 1000 })
    const s = store.create()
    expect(store.get(s.id)).toEqual(s)
    now = 1000
    expect(store.get(s.id)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('keeps at most `max` sessions, dropping the oldest', () => {
    const store = new SessionStore({ max: 2 })
    const [a, b, c] = [store.create(), store.create(), store.create()]
    expect(store.get(a.id)).toBeNull()
    expect(store.get(b.id)).not.toBeNull()
    expect(store.get(c.id)).not.toBeNull()
    expect(a.csrf).not.toBe(a.id)
  })

  it('ignores a cookie value that is not a session id', () => {
    const store = new SessionStore()
    expect(store.get(null)).toBeNull()
    expect(store.get('../../etc')).toBeNull()
  })
})

describe('device cookies', () => {
  const secrets = { password: 'the-approver-password-1', approverToken: 'server-only-secret-1' }

  it('prove their id only under the password and the server secret that made them', () => {
    const value = newDevice(secrets)
    expect(deviceIdOf(value, secrets)).toBe(value.split('.')[0])
    expect(deviceIdOf(value, { ...secrets, password: 'another-password-entirely' })).toBeNull()
    expect(deviceIdOf(`${value}.x`, secrets)).toBeNull()
    expect(deviceIdOf('nonsense', secrets)).toBeNull()
    expect(deviceIdOf(null, secrets)).toBeNull()
  })

  it('refuse a cookie minted with the right password but another server secret (no offline password test)', () => {
    const minted = newDevice({ ...secrets, approverToken: 'a-guessed-or-other-secret' })
    expect(deviceIdOf(minted, secrets)).toBeNull()
  })
})

describe('cookieOf', () => {
  it('finds our cookie among others', () => {
    expect(cookieOf('a=1; bz_approver=abc; b=2')).toBe('abc')
    expect(cookieOf('bz_approverx=1')).toBeNull()
    expect(cookieOf(undefined)).toBeNull()
  })
})

describe('readApprovalsConfig', () => {
  const env = {
    APPROVER_PASSWORD: 'Gx7-mQ2pL9vZ4kR8tW1yB',
    BAZAAR_MCP_URL: 'https://bazaar-mcp-production.up.railway.app/',
    BAZAAR_MCP_TOKEN: 'bearer-value-123',
    BAZAAR_APPROVER_TOKEN: 'approver-value-456',
  }

  it('is on with all four, and logs no value', () => {
    const logs: unknown[] = []
    expect(readApprovalsConfig(env, (e) => logs.push(e))).toEqual({
      password: env.APPROVER_PASSWORD, mcpUrl: 'https://bazaar-mcp-production.up.railway.app', mcpToken: env.BAZAAR_MCP_TOKEN, approverToken: env.BAZAAR_APPROVER_TOKEN,
    })
    expect(logs).toEqual([{ event: 'approvals', enabled: true }])
  })

  it('is off when one is missing, naming it without any value', () => {
    const logs: unknown[] = []
    expect(readApprovalsConfig({ ...env, BAZAAR_APPROVER_TOKEN: ' ' }, (e) => logs.push(e))).toBeNull()
    expect(logs).toEqual([{ event: 'approvals', enabled: false, reason: 'missing', missing: ['BAZAAR_APPROVER_TOKEN'] }])
    expect(readApprovalsConfig({})).toBeNull()
  })

  it('treats a password shorter than 20 characters, or with fewer than 12 different ones, as unset', () => {
    const logs: unknown[] = []
    expect(readApprovalsConfig({ ...env, APPROVER_PASSWORD: 'nineteen-characters' }, (e) => logs.push(e))).toBeNull()
    expect(readApprovalsConfig({ ...env, APPROVER_PASSWORD: 'abababababababababababab' }, (e) => logs.push(e))).toBeNull()
    expect(JSON.stringify(logs)).not.toMatch(/nineteen|abab/)
    expect(logs).toEqual([
      { event: 'approvals', enabled: false, reason: 'password_too_short', min: 20 },
      { event: 'approvals', enabled: false, reason: 'password_too_weak', min_distinct: 12 },
    ])
  })

  it('sends the tokens only over https, or http that never leaves the machine or Railway\'s private network', () => {
    expect(mcpBaseOf('https://x.example/mcp')).toBe('https://x.example')
    expect(mcpBaseOf('https://x.example/base/')).toBe('https://x.example/base')
    expect(mcpBaseOf('http://bazaar-mcp.railway.internal:8080')).toBe('http://bazaar-mcp.railway.internal:8080')
    expect(mcpBaseOf('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000')
    expect(mcpBaseOf('http://x.example')).toBeNull()
    expect(mcpBaseOf('https://user:pass@x.example')).toBeNull()
    expect(mcpBaseOf('https://x.example/?token=1')).toBeNull()
    expect(mcpBaseOf('not a url')).toBeNull()
    expect(readApprovalsConfig({ ...env, BAZAAR_MCP_URL: 'http://x.example' })).toBeNull()
  })
})
