import { afterEach, describe, expect, it, vi } from 'vitest'
import { startGame } from './start.ts'

afterEach(() => vi.unstubAllGlobals())

describe('startGame', () => {
  it('is off without a key', () => {
    const game = startGame({}, () => {})
    expect(game.enabled()).toBe(false)
    expect(game.relay).toBeNull()
  })

  it('falls back to the global fetch when none is given (an undefined option must not erase the default)', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url))
      return Promise.resolve(new Response(JSON.stringify({ tick: 1, t_hours: 0, tick_seconds: 10, events: [] }), { status: 200 }))
    })
    const game = startGame({ BAZAAR_SIM: '1' }, () => {})
    expect(game.enabled()).toBe(true)
    await game.relay?.pollOnce()
    game.stop()
    expect(calls.some((u) => u.endsWith('/api/clock'))).toBe(true)
  })
})
