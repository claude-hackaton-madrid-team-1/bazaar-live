import { describe, expect, it } from 'vitest'
import { headOf, holdingOf, teamOf, wantOf } from './rows.ts'

describe('rivals rows', () => {
  it('reads a holding of a team or a dealer: a card, copies, how and two ticks are required', () => {
    expect(holdingOf({ holder: 't05', card: 'LAV-09', set_code: 'LAV', rarity: 'rare', name: 'Cine Doré', copies: '2', how: 'bought', since_tick: 120, seen_tick: '140' })).toEqual({
      holder: 't05', card: 'LAV-09', set: 'LAV', rarity: 'rare', name: 'Cine Doré', copies: 2, how: 'bought', since: 120, seen: 140,
    })
    expect(holdingOf({ holder: 'chato', card: 'SAL-02', copies: 1, how: 'gift', since_tick: 9, seen_tick: 3 })).toMatchObject({ holder: 'chato', set: null, since: 9, seen: 9 })
    expect(holdingOf({ holder: 't05', card: 'LAV-09', copies: 1, how: 'stolen', since_tick: 1, seen_tick: 1 })).toBeNull()
    expect(holdingOf({ holder: 'T05 <b>', card: 'LAV-09', copies: 1, how: 'bought', since_tick: 1, seen_tick: 1 })).toBeNull()
    expect(holdingOf({ holder: 't05', card: 'pack', copies: 1, how: 'bought', since_tick: 1, seen_tick: 1 })).toBeNull()
    expect(holdingOf({ holder: 't05', card: 'LAV-09', copies: 0, how: 'bought', since_tick: 1, seen_tick: 1 })).toBeNull()
  })

  it('reads a team: numbers only in its set interest, never a dealer', () => {
    expect(teamOf({ team: 't14', rank: 1, score: '30.36', level: 4, pages: 2, deals: 34, tick: 850, set_interest: { RET: 9, LAT: '-108', note: 3, SAL: 'x' } })).toEqual({
      team: 't14', rank: 1, score: 30.36, level: 4, pages: 2, deals: 34, tick: 850, interest: { RET: 9, LAT: -108 },
    })
    expect(teamOf({ team: 'abuela', rank: 1, score: 1 })).toBeNull()
    expect(teamOf({ team: 't14', rank: 1 })).toBeNull()
  })

  it('reads a want: a bid keeps its best cash, a dealer ask has none', () => {
    expect(wantOf({ team: 't03', card: 'LAV-10', via: 'bid', times: 12, last_tick: 842, top_bid: 71 })).toEqual({ team: 't03', card: 'LAV-10', via: 'bid', times: 12, last: 842, topBid: 71 })
    expect(wantOf({ team: 't10', card: 'MAL-09', via: 'dealer', times: 6, last_tick: 849, top_bid: null })).toEqual({ team: 't10', card: 'MAL-09', via: 'dealer', times: 6, last: 849, topBid: null })
    expect(wantOf({ team: 't10', card: 'MAL-09', via: 'swap', times: 1, last_tick: 1 })).toBeNull()
  })

  it('reads the head tick', () => {
    expect(headOf({ tick: '856' })).toBe(856)
    expect(headOf({})).toBeNull()
  })
})
