import { describe, expect, it } from 'vitest'
import type { TeamScore } from '../../../shared/history.ts'
import { MARKET_TEST_STRINGS } from '../marketTestStrings.ts'
import { marketTest } from './market-test.ts'

const read = (tick: number, team: string, market: number | null): TeamScore => ({
  day: '2026-10-03', tick, team, rank: 1, score: 20, negotiating: 10, market, level: 4, pages: 2, deals: 10, at: null, venue: team === 't10' ? 'v07' : team === 't01' ? 'v19' : null,
})

/** The board at 19:09 on Saturday, cut down: t10 leads, we sit level with two others. */
const BOARD = [
  read(1200, 't10', 11), read(1210, 't10', 12.5),
  read(1210, 't06', 11.82),
  read(1210, 't15', 7.5), read(1210, 't01', 7.5), read(1210, 't02', 7.5),
  read(1210, 't03', 5.86),
]
const SCORE = { market: 7.5, mm_points: 0, bench_points: 0.5, bench_efficiency: 0.886, bench_venue: 'v19' }

describe('marketTest', () => {
  it('ranks every team by its latest market, teams level on one row (us first), and shows how far the leader is', () => {
    const m = marketTest(BOARD, 't01', SCORE)
    expect(m).toMatchObject({ ours: 7.5, place: 3, teams: 6, leader: { team: 't10', venue: 'v07', value: 12.5, gap: 5 } })
    const at = (team: string) => ({ team, venue: team === 't10' ? 'v07' : team === 't01' ? 'v19' : null })
    expect(m?.levels).toEqual([
      { value: 12.5, teams: [at('t10')], us: false },
      { value: 11.82, teams: [at('t06')], us: false },
      { value: 7.5, teams: [at('t01'), at('t02'), at('t15')], us: true },
      { value: 5.86, teams: [at('t03')], us: false },
    ])
    expect(m?.bench).toEqual({ points: 0.5, efficiency: 0.886, venue: 'v19', mm: 0 })
  })

  it('takes our venue from the board when /me has no bench run yet', () => {
    expect(marketTest(BOARD, 't01', { market: 7.5 })?.bench).toEqual({ points: null, efficiency: null, venue: 'v19', mm: null })
  })

  it('without a board, still shows our bench run and /me market; with neither, nothing', () => {
    expect(marketTest([], 't01', SCORE)).toMatchObject({ ours: 7.5, place: null, teams: 0, leader: null, levels: [] })
    expect(marketTest([], 't01', {})).toBeNull()
    expect(marketTest([], 't01', { bench_points: null, bench_venue: '' })).toBeNull()
  })

  it('says it in one line, in both languages', () => {
    const m = marketTest(BOARD, 't01', SCORE)
    const leader = m?.leader ? { name: 'Team 10', venue: m.leader.venue, value: m.leader.value, gap: m.leader.gap } : null
    expect(MARKET_TEST_STRINGS.en.headline(m?.ours ?? null, m?.place ?? null, m?.teams ?? 0, leader)).toBe('Our market 7.5 · #3 of 6 · Team 10 leads with 12.5 on v07 (+5)')
    expect(MARKET_TEST_STRINGS.es.headline(m?.ours ?? null, m?.place ?? null, m?.teams ?? 0, leader)).toBe('Nuestro mercado 7,5 · #3 de 6 · Team 10 va primero con 12,5 en v07 (+5)')
    expect(MARKET_TEST_STRINGS.en.efficiency(0.886)).toBe('efficiency 88.6%')
    expect(MARKET_TEST_STRINGS.en.note('v19')).toContain('our venue v19 showing 0 trades')
  })
})
