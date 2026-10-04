import { describe, expect, it } from 'vitest'
import type { ScoreMark, TeamScore } from '../../../shared/history.ts'
import { mockHistory } from '../history.ts'
import {
  boardDay,
  boardOf,
  boardTickAt,
  defaultPick,
  gapsAt,
  headline,
  rankAxis,
  rankChanges,
  readAt,
  rivalsAt,
  scoreAxis,
  secondsBefore,
  standingAt,
  stepBoardTick,
  stepPath,
  tickAtTime,
  timeAt,
  timeTicks,
} from './teams.ts'

const DAY = 'd2'
const at = (tick: number) => new Date(Date.UTC(2000, 0, 1, 10, 0, 0) + tick * 30_000).toISOString()

/** A read: score = negotiating + market, as on the board. */
const read = (tick: number, team: string, rank: number, negotiating: number, market: number, extra: Partial<TeamScore> = {}): TeamScore => ({
  day: DAY, tick, team, rank, score: negotiating + market, negotiating, market, level: 3, pages: 1, deals: 10, at: at(tick), venue: null, ...extra,
})

// four teams; t1 is us. At 20 t2 passes us (its market jumps); at 30 we pass t3 (our negotiating climbs).
const ROWS: TeamScore[] = [
  read(10, 'ta', 1, 20, 10, { pages: 3, deals: 40, level: 5 }),
  read(10, 't1', 2, 15, 5, { pages: 2, deals: 30, level: 4 }),
  read(10, 't3', 3, 16, 2, { pages: 0, deals: 5 }),
  read(10, 't2', 4, 10, 2, { pages: 1, deals: 20 }),
  read(20, 't2', 2, 10, 12, { pages: 1, deals: 35 }),
  read(20, 't1', 3, 15, 5, { pages: 2, deals: 30, level: 4 }),
  read(20, 't3', 4, 16, 2.5, { pages: 0, deals: 5 }),
  read(30, 't1', 3, 17, 5, { pages: 2, deals: 31, level: 4 }),
  read(30, 't3', 4, 16, 2.5, { pages: 0, deals: 5 }),
  // another, older day: never mixed in
  { ...read(900, 't1', 1, 99, 0), day: 'd1' },
]

const board = boardOf(ROWS)

describe('the board of the day', () => {
  it('keeps the latest day, every tick some team was read, and each team by its latest rank', () => {
    expect(boardDay(ROWS).every((r) => r.day === DAY)).toBe(true)
    expect(board.ticks).toEqual([10, 20, 30])
    expect(board.teams).toEqual(['ta', 't2', 't1', 't3'])
    expect(board.series.get('t2')?.map((r) => r.tick)).toEqual([10, 20])
  })

  it("holds a team's value until its next read (steps), and nothing before its first", () => {
    expect(readAt(board, 'ta', 30)?.score).toBe(30)
    expect(readAt(board, 't1', 25)?.negotiating).toBe(15)
    expect(readAt(board, 't1', 9)).toBeNull()
    expect(boardTickAt(board, 27)).toBe(20)
    expect(stepBoardTick(board, 27, -1)).toBe(20)
    expect(stepBoardTick(board, 20, -1)).toBe(10)
    expect(stepBoardTick(board, 30, 1)).toBe(30)
  })

  it('tells when a tick happened, between the reads around it, and back', () => {
    expect(timeAt(board, 15)).toBe(at(15))
    expect(tickAtTime(board, Date.parse(at(25)))).toBe(25)
    expect(secondsBefore(board, 10)).toBe(600)
    expect(secondsBefore(board, 30)).toBe(0)
  })

  it('stands every team at a tick: the board rank for the score, the place by value for a part (level teams share it)', () => {
    expect(standingAt(board, 20).map((s) => [s.team, s.value, s.rank])).toEqual([['ta', 30, 1], ['t2', 22, 2], ['t1', 20, 3], ['t3', 18.5, 4]])
    expect(standingAt(board, 20, 'negotiating').map((s) => [s.team, s.rank])).toEqual([['ta', 1], ['t3', 2], ['t1', 3], ['t2', 4]])
    expect(standingAt(board, 20, 'level').map((s) => s.rank)).toEqual([1, 2, 3, 3])
  })
})

describe('where they beat us', () => {
  it('compares us with the leader, the team just above and the mean of the others, per part', () => {
    expect(rivalsAt(board, 't1', 30)).toEqual({ leader: 'ta', above: 't2', rank: 3 })
    const rows = gapsAt(board, 't1', 30)
    const score = rows[0]
    expect(score).toMatchObject({ part: 'score', scored: true, ours: 22, place: 3, of: 4, leader: { team: 'ta', value: 30, gap: -8 }, above: { team: 't2', value: 22, gap: 0 } })
    // the others' mean: (30 + 22 + 18.5) / 3
    expect(score?.mean?.gap).toBeCloseTo(22 - 70.5 / 3, 3)
  })

  it('sorts the score first, its parts where we trail the mean most first, then the context parts by our worst place', () => {
    const rows = gapsAt(board, 't1', 30)
    // negotiating: 17 vs mean (20+10+16)/3 = 15.33 → +1.67; market: 5 vs (10+12+2.5)/3 = 8.17 → −3.17
    expect(rows.map((r) => r.part)).toEqual(['score', 'market', 'negotiating', 'deals', 'pages', 'level'])
    expect(rows.find((r) => r.part === 'deals')).toMatchObject({ scored: false, place: 3 })
    expect(rows.find((r) => r.part === 'level')).toMatchObject({ scored: false, place: 2, ours: 4 })
  })

  it('says where they beat us most and where we beat them, in points', () => {
    const h = headline(gapsAt(board, 't1', 30))
    expect(h.worst?.part).toBe('market')
    expect(h.worst?.gap).toBeCloseTo(5 - 24.5 / 3, 3)
    expect(h.best).toMatchObject({ part: 'negotiating', scored: true })
    // the leader's lead: negotiating 20 vs 17, market 10 vs 5 → market, −5
    expect(h.leader).toEqual({ team: 'ta', part: 'market', gap: -5 })
  })

  it('falls back to a context part in the top half when we lead in no part in points, and says nobody beats us when we lead', () => {
    const behind = boardOf([read(1, 'tx', 1, 20, 10, { pages: 0 }), read(1, 'ty', 2, 18, 9, { pages: 0 }), read(1, 'us', 3, 10, 5, { pages: 4 })])
    expect(headline(gapsAt(behind, 'us', 1))).toMatchObject({ worst: { part: 'negotiating' }, best: { part: 'pages', scored: false, gap: 4 } })
    const ahead = boardOf([read(1, 'us', 1, 30, 10), read(1, 'ty', 2, 18, 9)])
    expect(headline(gapsAt(ahead, 'us', 1))).toMatchObject({ worst: null, leader: null })
    // leading the board: the leader column is the team after us, nobody is above
    expect(rivalsAt(ahead, 'us', 1)).toEqual({ leader: 'ty', above: null, rank: 1 })
  })

  it('has nothing to compare before our first read', () => {
    expect(gapsAt(board, 'nobody', 30)).toEqual([])
  })
})

describe('the teams to follow and our rank', () => {
  it('picks the top three and the teams around us, never us, at most five', () => {
    expect(defaultPick(board, 't1', 30)).toEqual(['ta', 't2', 't3'])
    const many = boardOf(Array.from({ length: 12 }, (_, i) => read(1, `t${i + 1}`, i + 1, 30 - i, 0)))
    expect(defaultPick(many, 't8', 1)).toEqual(['t1', 't2', 't3', 't7', 't9'])
    expect(defaultPick(many, 't2', 1)).toEqual(['t1', 't3', 't4'])
  })

  it('explains each change of our rank: who passed us with which part, or our own move', () => {
    const marks: ScoreMark[] = [{ kind: 'start', id: 1, day: DAY, tick: 25, agent: 'taker', action: null, note: null, at: null }]
    const changes = rankChanges(board, 't1', marks)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      tick: 20, from: 10, before: 2, after: 3, cause: 'theirs',
      ours: { score: 0, negotiating: 0, market: 0 },
      passedUs: [{ team: 't2', score: 10, part: 'market', partDelta: 10 }],
      wePassed: [],
      marks: [],
    })
    // our negotiating climbs at 30 but the rank holds: no change listed; a rise of ours is listed with its marks
    const up = boardOf([read(1, 'us', 2, 10, 0), read(1, 'tz', 1, 12, 0), read(5, 'us', 1, 14, 0), read(5, 'tz', 2, 12, 0)])
    const [mine] = rankChanges(up, 'us', [{ ...(marks[0] as ScoreMark), tick: 3 }])
    expect(mine).toMatchObject({ before: 2, after: 1, cause: 'ours', ours: { score: 4, negotiating: 4 }, wePassed: [{ team: 'tz', score: 0, part: null }] })
    expect(mine?.marks.map((m) => m.tick)).toEqual([3])
    // we drift down a little and still go up: the team that fell further explains it
    const drift = boardOf([read(1, 'us', 2, 10, 0), read(1, 'tz', 1, 12, 0), read(5, 'us', 1, 9.95, 0), read(5, 'tz', 2, 9, 0)])
    expect(rankChanges(drift, 'us')[0]).toMatchObject({ cause: 'theirs', ours: { score: -0.05 }, wePassed: [{ team: 'tz', score: -3 }] })
  })
})

describe('geometry', () => {
  it('draws a step line that holds to the last read', () => {
    const x = (t: number) => t
    const y = (v: number) => 100 - v
    expect(stepPath(board, 't2', (r) => r.score, x, y)).toBe('M10.0,88.0 H20.0 V78.0 H30.0')
    expect(stepPath(board, 't2', (r) => r.rank, x, y)).toBe('M10.0,96.0 H20.0 V98.0 H30.0')
  })

  it('puts the score axis on round numbers from zero and rank 1 on top', () => {
    expect(scoreAxis(board, 132).ticks).toEqual([0, 10, 20, 30])
    const r = rankAxis(board, 132)
    expect(r.y(1)).toBeLessThan(r.y(4))
    expect(r.ticks).toEqual([1, 2, 3, 4])
  })

  it('labels the time axis on round clock times', () => {
    const long = boardOf([read(0, 'a', 1, 1, 0), read(240, 'a', 1, 2, 0)])
    expect(timeTicks(long, 600).map((t) => t.at.slice(11, 16))).toEqual(['10:00', '10:30', '11:00', '11:30', '12:00'])
  })

  it("the mock's day has eighteen teams with us among them", () => {
    const b = boardOf(mockHistory(400).board)
    expect(b.teams).toHaveLength(18)
    expect(b.teams).toContain('t01')
    expect(gapsAt(b, 't01', b.ticks.at(-1) as number).length).toBe(6)
  })
})
