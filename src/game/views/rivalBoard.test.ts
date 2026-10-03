import { describe, expect, it } from 'vitest'
import { MOVE_KINDS, STRENGTH_CODES, WEAKNESS_CODES, type BoardRow } from '../../../shared/rivalBoard.ts'
import { EMPTY_RIVALS } from '../../../shared/rivals.ts'
import { mockRivals, rivalsStateOf } from '../rivals.ts'
import { RIVAL_BOARD_STRINGS } from '../rivalBoardStrings.ts'
import { boardOfTeam, interestsOf, moveOf, moveTone, rankTrend } from './rivalBoard.ts'

const row = (over: Partial<BoardRow> & Pick<BoardRow, 'team' | 'rank'>): BoardRow => ({
  tick: 860, score: 20, negotiating: 12, market: 7.5, level: 4, pages: 1, deals: 30, venue: 'v05', rankChange: null, scoreChange: null, trendTicks: 60,
  trend: [], ourRank: 4, ourScore: 28.7, ourNegotiating: 21.2, ourMarket: 7.5, ourPages: 1, dealerDeals: 0, venueTrades: 0, topSet: null, setInterest: {},
  strengths: [], weaknesses: [], theyWant: [], theyHave: [], weHaveForThem: [], theyHaveForUs: [], matchCount: 0, guarded: false, guardReason: null,
  moveKind: 'watch', moveGive: null, moveGet: null, movePrice: null, ourGain: null, theirGain: null, suggestedMove: 'nothing to trade yet', whyClimbed: null,
  whyClimbedTick: null, ...over,
})

const { en, es } = RIVAL_BOARD_STRINGS

describe('moveOf and its words', () => {
  it('says a swap with both gains as estimates, in English and in Spanish (decimal comma)', () => {
    const m = moveOf(row({ team: 't13', rank: 11, moveKind: 'swap', moveGive: 'SAL-01', moveGet: 'LAT-04', ourGain: 8.5, theirGain: 10 }))
    expect(m).toEqual({ kind: 'swap', give: 'SAL-01', get: 'LAT-04', ourGain: 8.5, theirGain: 10, guard: null })
    expect(en.move(m)).toBe('Offer our spare SAL-01 for their LAT-04: +8.5 for us, +10 for them (estimated).')
    expect(es.move(m)).toBe('Ofrece nuestro SAL-01 repetido por su LAT-04: +8,5 para nosotros, +10 para ellos (estimado).')
  })

  it('says a sale and a buy with their live price; a loss for them reads with a true minus, a rounded zero without a sign', () => {
    const sell = moveOf(row({ team: 't08', rank: 7, guarded: true, guardReason: 'near', moveKind: 'sell', moveGive: 'SAL-01', movePrice: 12, ourGain: 10.3, theirGain: -0.04 }))
    expect(en.move(sell)).toBe('Sell our spare SAL-01 into their bid of 12 P: +10.3 for us, 0 for them (estimated).')
    expect(es.move(sell)).toBe('Vende nuestro SAL-01 repetido a su puja de 12 P: +10,3 para nosotros, 0 para ellos (estimado).')
    const buy = moveOf(row({ team: 't09', rank: 16, moveKind: 'buy', moveGet: 'LAT-04', movePrice: 10, ourGain: 21, theirGain: -2.5 }))
    expect(en.move(buy)).toBe('Buy their LAT-04 at their ask of 10 P: +21 for us, −2.5 for them (estimated).')
    expect(es.move(buy)).toBe('Compra su LAT-04 por 10 P, lo que piden: +21 para nosotros, −2,5 para ellos (estimado).')
  })

  it('a hold names the guard: top 5, ranks from us, level with us, or our rank unknown', () => {
    const rule = 'A deal only if our gain is at least twice theirs (theirs at book × their best set multiplier, page bonus not counted).'
    const top5 = moveOf(row({ team: 't14', rank: 4, guarded: true, guardReason: 'top5', moveKind: 'hold' }))
    expect(en.move(top5)).toBe(`Do not trade: a top-5 rival (rank 4). ${rule}`)
    expect(es.move(top5)).toBe('No negociar: rival del top 5 (puesto 4). Solo un trato si ganamos al menos el doble que ellos (lo suyo a valor de libro × su mejor multiplicador, sin contar el bonus de página).')
    const near = moveOf(row({ team: 't18', rank: 6, ourRank: 9, guarded: true, guardReason: 'near', moveKind: 'hold' }))
    expect(en.move(near)).toBe(`Do not trade: 3 ranks from us (rank 6, we are 9). ${rule}`)
    expect(es.move(near)).toBe('No negociar: a 3 puestos de nosotros (puesto 6, nosotros 9). Solo un trato si ganamos al menos el doble que ellos (lo suyo a valor de libro × su mejor multiplicador, sin contar el bonus de página).')
    const level = moveOf(row({ team: 't18', rank: 9, ourRank: 9, guarded: true, guardReason: 'near', moveKind: 'hold' }))
    expect(en.move(level)).toBe(`Do not trade: level with us (rank 9). ${rule}`)
    const unknown = moveOf(row({ team: 't18', rank: 9, ourRank: null, guarded: true, guardReason: 'near', moveKind: 'hold' }))
    expect(en.move(unknown)).toBe(`Do not trade: our own rank is unknown, so every team is guarded (theirs 9). ${rule}`)
    expect(es.move(unknown)).toContain('no sabemos nuestro puesto')
  })

  it('a trade row without its card reads as watch, never "offer — for —"', () => {
    expect(moveOf(row({ team: 't02', rank: 14, moveKind: 'swap', moveGive: 'SAL-01', moveGet: null }))).toEqual({ kind: 'watch' })
    expect(moveOf(row({ team: 't02', rank: 14, moveKind: 'sell', moveGive: null }))).toEqual({ kind: 'watch' })
    expect(moveOf(row({ team: 't02', rank: 14, moveKind: 'buy', moveGet: null }))).toEqual({ kind: 'watch' })
    expect(en.move({ kind: 'watch' })).toBe('Nothing to trade yet: watch their bids.')
  })

  it('never says the view\'s English sentence in Spanish', () => {
    const r = row({ team: 't13', rank: 11, moveKind: 'sell', moveGive: 'SAL-01', movePrice: 3, ourGain: 1.7, theirGain: 13, suggestedMove: 'sell our spare SAL-01 into their bid of 3 (+1.7 for us)' })
    expect(es.move(moveOf(r))).not.toContain(r.suggestedMove)
  })

  it('a guarded trade says why the team is guarded and why the rule lets it through, as an estimate', () => {
    expect(en.guardedTrade('top5', 2, 11)).toBe(
      "A top-5 rival, but by the board's estimate (theirs at book × their best set multiplier, page bonus not counted) we gain at least twice what they do.",
    )
    expect(en.guardedTrade('near', 9, 11)).toMatch(/^Close to us in the ranking, but/)
    expect(en.guardedTrade('near', 6, 14)).toMatch(/^Ranked above us, but/)
    expect(en.guardedTrade('near', 9, null)).toMatch(/^Guarded while our own rank is unknown, but/)
    expect(es.guardedTrade('near', 6, 14)).toMatch(/^Por encima de nosotros en la clasificación, pero/)
    expect(es.guardedTrade('near', 9, null)).toMatch(/^Protegido mientras no sabemos nuestro puesto, pero/)
    expect(es.guardedTrade('top5', 2, 11)).toContain('valor de libro × su mejor multiplicador')
  })

  it('the panel names the board\'s leaderboard tick, and the guard titles say who is guarded', () => {
    expect(en.sub(860)).toBe('private: our spares, the cards we miss and our estimates · leaderboard of tick 860')
    expect(es.sub(860)).toContain('clasificación del turno 860')
    expect(en.guardTitle.near).toContain('ranked above us')
    expect(es.guardTitle.near).toContain('por encima de nosotros')
    expect(en.guardTitle.top5).toMatch(/^a top-5 team/)
  })
})

describe('the board helpers', () => {
  it('finds a team, tones a move, sorts set interest and reads the rank trend', () => {
    const rows = [row({ team: 't05', rank: 2 }), row({ team: 't09', rank: 16 })]
    expect(boardOfTeam(rows, 't09')?.rank).toBe(16)
    expect(boardOfTeam(rows, 't01')).toBeNull()
    expect(boardOfTeam(rows, null)).toBeNull()
    expect(MOVE_KINDS.map(moveTone)).toEqual(['good', 'good', 'good', 'warn', 'neutral'])
    expect(interestsOf(row({ team: 't05', rank: 2, setInterest: { MAL: -3, LAV: 9, RET: 9 } })).map((i) => i.set)).toEqual(['LAV', 'RET', 'MAL'])
    expect(rankTrend(row({ team: 't05', rank: 2, trend: [{ tick: 800, rank: 5, score: 20 }, { tick: 860, rank: 2, score: 25 }] }))).toEqual({ from: 5, to: 2 })
    expect(rankTrend(row({ team: 't05', rank: 2, trend: [{ tick: 860, rank: 2, score: 25 }] }))).toBeNull()
  })

  it('has words for every strength, weakness and move in both languages', () => {
    for (const s of [en, es]) {
      for (const c of STRENGTH_CODES) expect(s.strength[c].label).not.toBe('')
      for (const c of WEAKNESS_CODES) expect(s.weakness[c].label).not.toBe('')
      for (const k of MOVE_KINDS) expect(s.moveKind[k]).not.toBe('')
    }
  })
})

describe('the board on the wire and in the mock', () => {
  it('reads the board part of /api/rivals, and is empty without it', () => {
    const b = row({ team: 't07', rank: 17 })
    const s = rivalsStateOf(200, { enabled: true, at: null, parts: { board: true }, board: [b] }, EMPTY_RIVALS)
    expect(s.snapshot.parts.board).toBe(true)
    expect(s.snapshot.board).toEqual([b])
    expect(rivalsStateOf(200, { enabled: true }, EMPTY_RIVALS).snapshot).toMatchObject({ board: [], parts: { board: false } })
  })

  it('the mock holds off a top-5 rival, sells to a team near us, proposes a swap, and never lists us', () => {
    const board = mockRivals(900).board
    expect(board.some((r) => r.team === 't01')).toBe(false)
    expect(board.find((r) => r.rank === 1)).toMatchObject({ moveKind: 'hold', guardReason: 'top5' })
    expect(board.some((r) => r.moveKind === 'sell' && r.guardReason === 'near')).toBe(true)
    expect(board.some((r) => r.moveKind === 'swap')).toBe(true)
  })
})
