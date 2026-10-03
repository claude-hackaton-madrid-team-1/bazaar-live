import { describe, expect, it } from 'vitest'
import { freshness, pagePush, pollEvery, POLL_MS } from './fresh.ts'
import { apply, createState } from './state.ts'

describe('pagePush', () => {
  it('slows the timer only while the stream is live and the server sends notices', () => {
    const s = createState()
    expect(pagePush('live', s, 'history')).toEqual({ at: null, live: false })
    apply(s, { id: -(2 ** 52), type: 'pages.changed', scope: 'team', actor: '', payload: { history: '2026-10-03T10:00:00.000Z', bad: 3 } })
    expect(s.changes).toEqual({ history: '2026-10-03T10:00:00.000Z' })
    // a status, like agent.health: never in the event lists
    expect(s.events).toHaveLength(0)
    expect(pagePush('live', s, 'history')).toEqual({ at: '2026-10-03T10:00:00.000Z', live: true })
    expect(pagePush('reconnecting', s, 'learn')).toEqual({ at: null, live: false })
    expect(pollEvery('history', pagePush('live', s, 'history'))).toBe(POLL_MS.history.pushed)
    expect(pollEvery('history', pagePush('reconnecting', s, 'history'))).toBe(POLL_MS.history.timer)
    expect(pollEvery('learn', null)).toBe(POLL_MS.learn.timer)
    expect(pollEvery('strategy', pagePush('live', s, 'strategy'))).toBe(POLL_MS.strategy.pushed)
  })
})

describe('freshness', () => {
  const at = '2026-10-03T10:00:00.000Z'
  const t0 = Date.parse(at)
  const pushed = { at, live: true }

  it('is live while the copy is as old as the timer allows, then stale with its age', () => {
    expect(freshness('history', 'live', at, null, t0 + 4_000)).toEqual({ tone: 'live', ageS: 4 })
    expect(freshness('history', 'live', at, null, t0 + 25_000)).toEqual({ tone: 'stale', ageS: 25 })
    // with notices the copy is refetched only on a change or every 30 s: older and still current
    expect(freshness('history', 'live', at, pushed, t0 + 40_000)).toEqual({ tone: 'live', ageS: 40 })
    expect(freshness('history', 'live', at, pushed, t0 + 50_000)?.tone).toBe('stale')
  })

  it('a failed read is stale; nothing to say without a copy, for the mock or behind a notice', () => {
    expect(freshness('learn', 'error', at, null, t0 + 1_000)).toEqual({ tone: 'stale', ageS: 1 })
    expect(freshness('learn', 'live', null, null, t0)).toBeNull()
    expect(freshness('learn', 'mock', at, null, t0)).toBeNull()
    expect(freshness('learn', 'locked', at, null, t0)).toBeNull()
    expect(freshness('learn', 'live', 'not a time', null, t0)).toBeNull()
    expect(freshness('learn', 'live', at, null, t0 - 5_000)).toEqual({ tone: 'live', ageS: 0 })
  })
})
