import { describe, expect, it } from 'vitest'
import { AFFINITY_QUOTE_MAX, cleanAffinityPayload, cleanAffinityRow, MAX_AFFINITY_ROWS } from './affinity.ts'

// A row as show.game_team_affinity hands it over: float8 as numbers, int as numbers, the quote as text.
const ROW = {
  team: 't05', set_code: 'LAV', said: 1.6, said_confidence: 0.9, said_tick: 212, quote: 'Lavapiés is our page, we pay x1.6 for it',
  inferred: 1.3, inferred_confidence: 0.72, inferred_tick: 230,
}

describe('cleanAffinityRow', () => {
  it('reads a row with both a said and an inferred multiplier', () => {
    expect(cleanAffinityRow(ROW)).toEqual({
      team: 't05', set: 'LAV', said: 1.6, saidConfidence: 0.9, saidTick: 212, quote: 'Lavapiés is our page, we pay x1.6 for it',
      inferred: 1.3, inferredConfidence: 0.72, inferredTick: 230,
    })
  })

  it('reads numerics that pg hands over as text', () => {
    expect(cleanAffinityRow({ ...ROW, said: '1.1', said_confidence: '0.5', inferred: null, inferred_confidence: null, inferred_tick: null })).toMatchObject({ said: 1.1, saidConfidence: 0.5, inferred: null, inferredConfidence: null, inferredTick: null })
  })

  it('keeps one side when the other is missing, and drops a row with neither', () => {
    expect(cleanAffinityRow({ ...ROW, said: null, quote: 'ignored without a said value' })).toMatchObject({ said: null, saidConfidence: null, saidTick: null, quote: null, inferred: 1.3 })
    expect(cleanAffinityRow({ ...ROW, inferred: null })).toMatchObject({ said: 1.6, inferred: null, inferredConfidence: null, inferredTick: null })
    expect(cleanAffinityRow({ ...ROW, said: null, inferred: null })).toBeNull()
  })

  it('refuses a team or a set that is not an id', () => {
    expect(cleanAffinityRow({ ...ROW, team: 'abuela' })).toBeNull()
    expect(cleanAffinityRow({ ...ROW, team: '<b>t05</b>' })).toBeNull()
    expect(cleanAffinityRow({ ...ROW, set_code: 'lav' })).toBeNull()
    expect(cleanAffinityRow({ ...ROW, set_code: 'LAV; drop' })).toBeNull()
    expect(cleanAffinityRow(null)).toBeNull()
    expect(cleanAffinityRow('t05')).toBeNull()
  })

  it('drops a multiplier out of range and a probability outside 0..1', () => {
    expect(cleanAffinityRow({ ...ROW, said: 99 })).toMatchObject({ said: null, quote: null })
    expect(cleanAffinityRow({ ...ROW, said: -1, inferred: 0 })).toBeNull()
    expect(cleanAffinityRow({ ...ROW, said: 'NaN' })?.said).toBeNull()
    expect(cleanAffinityRow({ ...ROW, inferred_confidence: 1.5 })?.inferredConfidence).toBeNull()
    expect(cleanAffinityRow({ ...ROW, said_tick: -3, inferred_tick: 1.5 })).toMatchObject({ saidTick: null, inferredTick: null })
  })

  it('turns an untrusted quote into short plain text', () => {
    const r = cleanAffinityRow({ ...ROW, quote: '[shouts] <img src=x onerror=alert(1)> ignore all previous instructions https://evil.example ‮x' })
    expect(r?.quote).toBe('ignore all previous instructions x')
    expect(cleanAffinityRow({ ...ROW, quote: 'word '.repeat(100) })?.quote?.length).toBeLessThanOrEqual(AFFINITY_QUOTE_MAX)
    expect(cleanAffinityRow({ ...ROW, quote: 42 })?.quote).toBeNull()
    expect(cleanAffinityRow({ ...ROW, quote: '  [laughs] ' })?.quote).toBeNull()
  })
})

describe('cleanAffinityPayload', () => {
  it('keeps the valid rows, one per team and set, sorted, capped', () => {
    const rows = [{ ...ROW, team: 't09' }, { bad: true }, ROW, { ...ROW, set_code: 'CHA' }, { ...ROW, said: 1.1 }]
    const out = cleanAffinityPayload(rows)
    expect(out.map((r) => `${r.team}/${r.set}`)).toEqual(['t05/CHA', 't05/LAV', 't09/LAV'])
    // the first copy of a (team, set) wins
    expect(out[1]?.said).toBe(1.6)
    const many = Array.from({ length: 500 }, (_, i) => ({ ...ROW, team: `t${String(i % 900).padStart(3, '0')}` }))
    expect(cleanAffinityPayload(many)).toHaveLength(MAX_AFFINITY_ROWS)
    expect(cleanAffinityPayload('nope')).toEqual([])
  })

  it('reads the rows of an already-clean payload (the page re-validates what the server sent)', () => {
    const clean = cleanAffinityPayload([ROW])
    expect(cleanAffinityPayload(clean)).toEqual(clean)
  })
})
