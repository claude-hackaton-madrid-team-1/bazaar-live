import { describe, expect, it } from 'vitest'
import type { AgentHealth } from '../model/events'
import { modeOf, worldOf } from './mode'

const h = (patch: Partial<AgentHealth> = {}): AgentHealth => ({
  ok: true, agent: 'taker', mode: 'live', tick: 1, doors: 'open', paused: false, nextOpens: null, tickSeconds: 30, serverTick: 1, target: 'real', ...patch,
})

describe('modeOf: LIVE, DRY RUN or OFFLINE from /health', () => {
  it('reads the mode the agent reports, and OFFLINE when it cannot be reached', () => {
    expect(modeOf(h(), 'open')).toBe('live')
    expect(modeOf(h({ mode: 'dry' }), 'open')).toBe('dry')
    expect(modeOf(null, 'open')).toBe('offline')
    expect(modeOf(h({ ok: false }), 'open')).toBe('offline')
  })
})

describe('worldOf: REAL GAME or SIMULATOR from /health target.mode', () => {
  it('both agents on the real game', () => {
    expect(worldOf({ taker: h(), maker: h({ agent: 'maker' }) }, false)).toBe('real')
  })

  it('both agents on the simulator', () => {
    expect(worldOf({ taker: h({ target: 'simulator' }), maker: h({ agent: 'maker', target: 'simulator' }) }, false)).toBe('simulator')
  })

  it('one on each is a mix, never quietly called real', () => {
    expect(worldOf({ taker: h(), maker: h({ agent: 'maker', target: 'simulator' }) }, false)).toBe('mixed')
  })

  it('one agent known is enough; none known (not loaded, offline, no target field) is unknown', () => {
    expect(worldOf({ taker: null, maker: h({ agent: 'maker', target: 'simulator' }) }, false)).toBe('simulator')
    expect(worldOf({ taker: null, maker: null }, false)).toBe('unknown')
    expect(worldOf({ taker: h({ ok: false }), maker: h({ target: null }) }, false)).toBe('unknown')
  })

  it('the recorded mock is always labelled as such, whatever its health says', () => {
    expect(worldOf({ taker: h(), maker: h() }, true)).toBe('mock')
  })
})
