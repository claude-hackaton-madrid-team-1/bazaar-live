import { describe, expect, it } from 'vitest'
import { POLL_MS, readGameConfig, REAL_URL, SIM_URL } from './config.ts'

describe('readGameConfig', () => {
  it('is off without a key for the real game', () => {
    expect(readGameConfig({})).toEqual({ enabled: false, reason: 'BAZAAR_KEY is not set' })
    expect(readGameConfig({ BAZAAR_KEY: '  ' }).enabled).toBe(false)
  })

  it('reads the real game with BAZAAR_KEY, at the hardcoded URL', () => {
    expect(readGameConfig({ BAZAAR_KEY: 'k-real', BAZAAR_SIM: '0' })).toEqual({
      enabled: true, target: 'real', url: REAL_URL, key: 'k-real', token: null, pollMs: POLL_MS.default,
    })
  })

  it('never sends a sim key to the real game', () => {
    const c = readGameConfig({ BAZAAR_KEY: 'sim-team3' })
    expect(c.enabled).toBe(false)
  })

  it('reads the simulator with BAZAAR_SIM=1, a sim key only, and never reads BAZAAR_KEY', () => {
    expect(readGameConfig({ BAZAAR_SIM: '1', BAZAAR_KEY: 'k-real' })).toMatchObject({ enabled: true, target: 'simulator', url: SIM_URL, key: 'sim-team1' })
    expect(readGameConfig({ BAZAAR_SIM: '1', BAZAAR_SIM_KEY: 'sim-team4' })).toMatchObject({ key: 'sim-team4' })
    expect(readGameConfig({ BAZAAR_SIM: '1', BAZAAR_SIM_KEY: 'k-real' }).enabled).toBe(false)
  })

  it('refuses an unknown BAZAAR_SIM instead of guessing a target', () => {
    expect(readGameConfig({ BAZAAR_SIM: 'local', BAZAAR_KEY: 'k' }).enabled).toBe(false)
  })

  it('reads the view token and clamps the poll interval', () => {
    expect(readGameConfig({ BAZAAR_KEY: 'k', GAME_VIEW_TOKEN: ' t0k ' })).toMatchObject({ token: 't0k' })
    expect(readGameConfig({ BAZAAR_KEY: 'k', GAME_POLL_MS: '10' })).toMatchObject({ pollMs: POLL_MS.min })
    expect(readGameConfig({ BAZAAR_KEY: 'k', GAME_POLL_MS: '999999' })).toMatchObject({ pollMs: POLL_MS.max })
    expect(readGameConfig({ BAZAAR_KEY: 'k', GAME_POLL_MS: 'soon' })).toMatchObject({ pollMs: POLL_MS.default })
    expect(readGameConfig({ BAZAAR_KEY: 'k', GAME_POLL_MS: '7000' })).toMatchObject({ pollMs: 7000 })
  })
})
