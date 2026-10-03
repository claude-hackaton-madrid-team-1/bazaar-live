import { describe, expect, it } from 'vitest'
import type { AgentHealth } from '../model/events'
import { modeOf, rememberTargets, worldOf } from './mode'

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
  const targets = (taker: 'real' | 'simulator' | null, maker: 'real' | 'simulator' | null) => ({ taker, maker })

  it('both agents on the real game, or both on the simulator', () => {
    expect(worldOf(targets('real', 'real'), false)).toBe('real')
    expect(worldOf(targets('simulator', 'simulator'), false)).toBe('simulator')
  })

  it('one on each is a mix, never quietly called real', () => {
    expect(worldOf(targets('real', 'simulator'), false)).toBe('mixed')
  })

  it('one agent known is enough; none known is unknown', () => {
    expect(worldOf(targets(null, 'simulator'), false)).toBe('simulator')
    expect(worldOf(targets(null, null), false)).toBe('unknown')
  })

  it('the recorded mock is always labelled as such', () => {
    expect(worldOf(targets('real', 'real'), true)).toBe('mock')
  })
})

describe('rememberTargets: a missed poll does not forget what an agent said', () => {
  const none = { taker: null, maker: null }

  it('takes the target of an agent that answered', () => {
    expect(rememberTargets(none, { taker: h(), maker: h({ agent: 'maker', target: 'simulator' }) })).toEqual({ taker: 'real', maker: 'simulator' })
  })

  it('keeps the last target through a failed poll, an offline agent and an answer without a target', () => {
    const known = { taker: 'simulator', maker: 'real' } as const
    expect(rememberTargets(known, { taker: null, maker: h({ agent: 'maker' }) })).toEqual(known)
    expect(rememberTargets(known, { taker: h({ ok: false }), maker: h({ target: null }) })).toEqual(known)
  })

  it('MIXED survives one missed /health instead of flipping to REAL', () => {
    const mixed = rememberTargets(none, { taker: h({ target: 'simulator' }), maker: h({ agent: 'maker' }) })
    expect(worldOf(mixed, false)).toBe('mixed')
    const afterMiss = rememberTargets(mixed, { taker: null, maker: h({ agent: 'maker' }) })
    expect(worldOf(afterMiss, false)).toBe('mixed')
  })

  it('returns the same object when nothing changed (no needless render)', () => {
    const known = { taker: 'real', maker: 'real' } as const
    expect(rememberTargets(known, { taker: h(), maker: h() })).toBe(known)
  })
})
