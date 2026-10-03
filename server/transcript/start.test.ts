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
