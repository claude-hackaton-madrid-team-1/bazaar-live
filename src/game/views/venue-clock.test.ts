import { describe, expect, it } from 'vitest'
import { benchClock, cadenceOf, DEFAULT_CADENCE, startsOf, type BenchStart } from './venue-clock.ts'

const s = (session: number | null, startTick: number, ticks = 16): BenchStart => ({ session, startTick, ticks })
const PROD = [s(1, 201), s(2, 441), s(3, 681), s(4, 921), s(5, 1161), s(6, 1401)]

describe('startsOf', () => {
  it('merges the database and the stream by session and start, oldest first, and drops a start above now', () => {
    expect(startsOf([[s(6, 1401), s(5, 1161)], [s(6, 1401), s(null, 1401), s(7, 1641)]], 1500)).toEqual([s(5, 1161), s(6, 1401)])
  })
})

describe('cadenceOf', () => {
  it('reads the gap the game keeps, and two hours without two starts', () => {
    expect(cadenceOf(PROD)).toBe(240)
    expect(cadenceOf([s(1, 12), s(2, 52), s(3, 92)])).toBe(40)
    expect(cadenceOf([s(1, 201)])).toBe(DEFAULT_CADENCE)
    expect(cadenceOf([])).toBe(DEFAULT_CADENCE)
  })
})

describe('benchClock', () => {
  it('counts down to the next session between two', () => {
    expect(benchClock(PROD, 1500)).toMatchObject({ running: null, next: { session: 7, tick: 1641, inTicks: 141 }, cadence: 240 })
  })

  it('says a session is running for its 16 ticks, then counts to the next', () => {
    expect(benchClock(PROD, 1401)).toMatchObject({ running: { session: 6, left: 16, elapsed: 0, endTick: 1417 }, next: { tick: 1641 } })
    expect(benchClock(PROD, 1416)?.running).toMatchObject({ left: 1, elapsed: 15 })
    expect(benchClock(PROD, 1417).running).toBeNull()
  })

  it('moves on by whole steps past a start that never came, without guessing its number', () => {
    expect(benchClock(PROD, 1700).next).toEqual({ session: null, tick: 1881, inTicks: 181 })
  })

  it('knows nothing before a first start', () => {
    expect(benchClock([], 50)).toEqual({ running: null, next: null, last: null, cadence: DEFAULT_CADENCE })
  })
})
