import { describe, expect, it } from 'vitest'
import { startTranscript } from './start.ts'

describe('startTranscript', () => {
  it('is off, and says why, without SHOW_DATABASE_URL', async () => {
    const logs: Record<string, unknown>[] = []
    const t = startTranscript({}, (e) => logs.push(e))
    expect(t.enabled()).toBe(false)
    expect(logs).toEqual([{ route: 'transcript', event: 'off', reason: 'absent' }])
    await t.stop()
  })

  it('is off for a value that is not a postgres url, and never logs the value', () => {
    const logs: Record<string, unknown>[] = []
    const t = startTranscript({ SHOW_DATABASE_URL: 'https://user:topsecret@host/db' }, (e) => logs.push(e))
    expect(t.enabled()).toBe(false)
    expect(JSON.stringify(logs)).not.toContain('topsecret')
  })

  it('refuses a public host (a url with a password is never sent across the internet) and says so without the url', () => {
    const logs: Record<string, unknown>[] = []
    const t = startTranscript({ SHOW_DATABASE_URL: 'postgresql://reader:topsecret@viaduct.proxy.rlwy.net:5432/railway' }, (e) => logs.push(e))
    expect(t.enabled()).toBe(false)
    expect(logs).toEqual([{ route: 'transcript', event: 'off', reason: 'host_not_allowed' }])
  })

  it('keeps duels off unless SHOW_DUELS is set', async () => {
    const logs: Record<string, unknown>[] = []
    const url = 'postgresql://reader:topsecret@127.0.0.1:1/none'
    await startTranscript({ SHOW_DATABASE_URL: url }, (e) => logs.push(e)).stop()
    await startTranscript({ SHOW_DATABASE_URL: url, SHOW_DUELS: 'on' }, (e) => logs.push(e)).stop()
    expect(logs.filter((l) => l.event === 'on').map((l) => l.duels)).toEqual([false, true])
  })

  it('turns on with a postgres url and survives an unreachable host without throwing', async () => {
    const logs: Record<string, unknown>[] = []
    const t = startTranscript({ SHOW_DATABASE_URL: 'postgresql://reader:topsecret@127.0.0.1:1/none' }, (e) => logs.push(e))
    expect(t.enabled()).toBe(true)
    await new Promise((r) => setTimeout(r, 400)) // the first poll fails against a closed port
    await t.stop()
    expect(logs.some((l) => l.event === 'poll_failed')).toBe(true)
    expect(JSON.stringify(logs)).not.toMatch(/topsecret|postgresql:\/\//)
  })
})
