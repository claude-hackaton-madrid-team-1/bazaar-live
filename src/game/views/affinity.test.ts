import { describe, expect, it } from 'vitest'
import type { TeamAffinity } from '../../../shared/affinity.ts'
import { apply, createState } from '../state.ts'
import { GAME_STRINGS } from '../strings.ts'
import { affinityBoard, fmtMultiplier, fmtProbability } from './affinity.ts'

const row = (team: string, set: string, fields: Partial<TeamAffinity> = {}): TeamAffinity => ({
  team, set, said: null, saidConfidence: null, saidTick: null, quote: null, inferred: 1.1, inferredConfidence: 0.6, inferredTick: 10, ...fields,
})

describe('agent.affinity in the page state', () => {
  it('keeps the latest copy as a status, validated again, never in the event lists', () => {
    const s = createState()
    expect(s.teamAffinity).toBeNull()
    apply(s, { id: -7, type: 'agent.affinity', scope: 'team', actor: '', payload: { rows: [
      { team: 't05', set: 'LAV', said: 1.6, saidConfidence: null, saidTick: 3, quote: '<b>x1.6</b> [laughs]', inferred: null },
      { team: 'not-a-team', set: 'LAV', inferred: 1.1 },
    ] } })
    expect(s.teamAffinity).toEqual([{ team: 't05', set: 'LAV', said: 1.6, saidConfidence: null, saidTick: 3, quote: 'x1.6', inferred: null, inferredConfidence: null, inferredTick: null }])
    expect(s.events).toHaveLength(0)
    apply(s, { id: -8, type: 'agent.affinity', scope: 'team', actor: '', payload: { rows: 'odd' } })
    expect(s.teamAffinity).toEqual([])
  })
})

describe('affinityBoard', () => {
  it('is null with no data yet', () => {
    expect(affinityBoard(null)).toBeNull()
    expect(affinityBoard([])).toBeNull()
  })

  it('lays the rows out as teams × sets, the album order first, teams by number', () => {
    const board = affinityBoard([
      row('t10', 'LAV'), row('t02', 'CHA', { said: 1.3, quote: 'x1.3' }), row('t02', 'LAV', { said: 0.5, inferred: null }), row('t02', 'ZZZ'),
    ])
    expect(board?.sets).toEqual(['LAV', 'CHA', 'ZZZ'])
    expect(board?.teams.map((t) => t.team)).toEqual(['t02', 't10'])
    expect(board?.teams[0]?.cells.CHA?.quote).toBe('x1.3')
    expect(board?.teams[1]?.cells.CHA).toBeUndefined()
    expect([board?.said, board?.inferred]).toEqual([2, 3])
  })
})

describe('formats', () => {
  it('writes a multiplier and a probability', () => {
    expect([fmtMultiplier(1.3), fmtMultiplier(0.5), fmtMultiplier(1), fmtMultiplier(1.2549)]).toEqual(['×1.3', '×0.5', '×1', '×1.25'])
    expect([fmtProbability(0.72), fmtProbability(1), fmtProbability(0.005)]).toEqual(['72 %', '100 %', '1 %'])
  })
})

describe('words', () => {
  it('labels a said value as unverified words in both languages, with the quote on hover', () => {
    expect(GAME_STRINGS.en.market.saidLabel).toBe('said (unverified)')
    expect(GAME_STRINGS.es.market.saidLabel).toBe('dicho (sin verificar)')
    expect(GAME_STRINGS.en.market.saidTitle('we pay x1.6', 212)).toBe('They said: “we pay x1.6” · tick 212. Their words, not a fact.')
    expect(GAME_STRINGS.es.market.saidTitle(null, null)).toBe('Lo dijeron en un trato (sin sus palabras). Son sus palabras, no un hecho.')
    expect(GAME_STRINGS.en.market.inferredLabel('72 %')).toBe('inferred 72 %')
    expect(GAME_STRINGS.es.market.teamSetsSub(1, 2, 3)).toBe('1 equipo · 2 dichos · 3 deducidos')
  })
})
