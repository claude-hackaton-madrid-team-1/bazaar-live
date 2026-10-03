import { describe, expect, it } from 'vitest'
import { projectMe } from './me.ts'

// The simulator's /me for team 1 (2026-10-03), trimmed, plus the real game's documented starter_broker_key.
const ME = {
  affinity: { LAV: 1.1, MAL: 0.5 },
  album: { filled: 14, slots: 40, pages: [{ complete: false, have: 5, master: false, name: 'Lavapiés', of: 10, set: 'LAV' }] },
  assets: [
    { id: 1, kind: 'card', ref: 'MAL-05', serial: 1, rarity: 'common', set: 'MAL', print_run: 300, name: 'Café de Madrugada', your_value: 11 },
    { id: 9, kind: 'pack', ref: 'sobre_barrio', name: 'Sobre de barrio', your_value: 24 },
  ],
  badges: [], cash: 392, collection_value: 211.8, frozen: false, id: 't01', level: 2, name: 'Team 1',
  open_threads: [{ id: 61, with: 'abuela', kind: 'persona', topic: 'LAV-01', status: 'open' }],
  score: {
    score: 18.4, rank: 9, deals: 3, duel_points: 4, ladder_points: 6.5, neg_points: 7.9, mm_points: 0,
    bench_efficiency: null, bench_points: null, bench_venue: null, luck: 0.4, luck_private: 1.7, adjustments: [], team: 't01',
  },
  starter_broker_key: 'bk-live-secret', tick: 3191, tick_seconds: 10, unlocked: ['abuela', 'chato'], venue: null,
}

describe('projectMe', () => {
  it('keeps exactly what the screens read', () => {
    expect(projectMe(ME)).toEqual({
      id: 't01', name: 'Team 1', cash: 392,
      affinity: { LAV: 1.1, MAL: 0.5 },
      score: { score: 18.4, rank: 9, deals: 3, duel_points: 4, ladder_points: 6.5, neg_points: 7.9, mm_points: 0, bench_points: null, bench_efficiency: null, bench_venue: null },
      album: { pages: [{ set: 'LAV', name: 'Lavapiés', have: 5, of: 10, complete: false, master: false }] },
      assets: [
        { id: 1, kind: 'card', ref: 'MAL-05', serial: 1, your_value: 11 },
        { id: 9, kind: 'pack', ref: 'sobre_barrio', your_value: 24 },
      ],
    })
  })

  it('carries the bench run and the board market for the Market Test panel, and nothing else of the score', () => {
    const score = projectMe({ score: { ...ME.score, market: 7.5, bench_points: 2.5, bench_efficiency: 0.8, bench_venue: 'v-t01' } }).score
    expect(score).toEqual({
      score: 18.4, rank: 9, deals: 3, duel_points: 4, ladder_points: 6.5, neg_points: 7.9, mm_points: 0, bench_points: 2.5,
      market: 7.5, bench_efficiency: 0.8, bench_venue: 'v-t01',
    })
  })

  it('never carries a key or what the game prices our hand at', () => {
    const text = JSON.stringify(projectMe({ ...ME, broker_key: 'bk-2', api_key: 'k' }))
    for (const leak of ['bk-live-secret', 'bk-2', 'collection_value', 'luck_private', 'key', 'open_threads']) expect(text).not.toContain(leak)
  })

  it('carries the affinity as set → number only, for the album\'s value to us', () => {
    expect(projectMe({ affinity: { LAV: 1.6, SAL: '1.3', RET: null, CHA: 0.9, x: { y: 1 } } })).toEqual({ affinity: { LAV: 1.6, CHA: 0.9 } })
    expect(projectMe({ affinity: [1.6] })).toEqual({})
  })

  it('a body with parts missing or of the wrong shape yields what is there', () => {
    expect(projectMe({ id: 't01', score: 'x', album: { pages: 'y' }, assets: [null, 3, { ref: 'LAT-01' }] })).toEqual({ id: 't01', assets: [{ ref: 'LAT-01' }] })
    expect(projectMe({})).toEqual({})
  })
})
