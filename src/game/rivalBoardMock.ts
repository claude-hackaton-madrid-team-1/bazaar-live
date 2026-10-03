/**
 * A made-up rival board for `?mock=1` (./rivals.ts `mockRivals`), around the mock standings: a top-5 rival we hold off,
 * a team near us we may still sell to (our gain is more than twice theirs), a swap, and nothing to trade with the rest.
 */
import type { BoardRow } from '../../shared/rivalBoard.ts'
import type { RivalTeam } from '../../shared/rivals.ts'

const BASE = {
  negotiating: null, market: null, level: null, deals: null, venue: null, rankChange: 0, scoreChange: 0, trendTicks: 60,
  ourNegotiating: null, ourMarket: null, dealerDeals: 0, venueTrades: 0, topSet: null, setInterest: {},
  strengths: [], weaknesses: [], theyWant: [], theyHave: [], weHaveForThem: [], theyHaveForUs: [], matchCount: 0,
  guarded: false, guardReason: null, moveKind: 'watch', moveGive: null, moveGet: null, movePrice: null, ourGain: null,
  theirGain: null, suggestedMove: '', whyClimbed: null, whyClimbedTick: null,
} as const

export function mockBoard(teams: readonly RivalTeam[], tick: number): BoardRow[] {
  const us = teams.find((t) => t.team === 't01') ?? null
  const ourRank = us?.rank ?? null
  return teams
    .filter((t) => t.team !== 't01')
    .map((t, i): BoardRow => {
      const near = ourRank !== null && Math.abs(t.rank - ourRank) <= 3
      const row: BoardRow = {
        ...BASE,
        team: t.team, tick, rank: t.rank, score: t.score, pages: t.pages, trend: [{ tick: tick - 60, rank: t.rank + 1, score: t.score - 1 }, { tick, rank: t.rank, score: t.score }],
        ourRank, ourScore: us?.score ?? null, ourPages: us?.pages ?? null, setInterest: t.interest,
        strengths: i % 3 === 0 ? ['negotiating', 'dealer_ladder'] : ['venue'], weaknesses: i % 2 === 0 ? ['no_venue_trades', 'needs_cards'] : ['market'],
        guarded: t.rank <= 5 || near, guardReason: t.rank <= 5 ? 'top5' : near ? 'near' : null,
        moveKind: t.rank <= 5 || near ? 'hold' : 'watch',
      }
      if (t.rank === 1) {
        return { ...row, theyWant: [{ ref: 'LAV-09', price: 74, tick: tick - 3 }], weHaveForThem: [{ ref: 'LAV-09', spare: 1, theirPrice: 74, ourValue: 40 }], matchCount: 1, whyClimbed: `${t.team} +2 ranks in 20 ticks: negotiating +1.4`, whyClimbedTick: tick - 8 }
      }
      if (near) {
        return { ...row, moveKind: 'sell', moveGive: 'SAL-01', movePrice: 12, ourGain: 10.3, theirGain: 4, weHaveForThem: [{ ref: 'SAL-01', spare: 2, theirPrice: 12, ourValue: 0.5 }], theyWant: [{ ref: 'SAL-01', price: 12, tick: tick - 2 }], matchCount: 1 }
      }
      if (i === teams.length - 4) {
        return {
          ...row, moveKind: 'swap', moveGive: 'LAT-02', moveGet: 'MAL-04', ourGain: 19.5, theirGain: 16,
          theyWant: [{ ref: 'LAT-02', price: null, tick: tick - 5 }], theyHave: [{ ref: 'MAL-04', price: 18, tick: tick - 4 }],
          weHaveForThem: [{ ref: 'LAT-02', spare: 1, theirPrice: null, ourValue: 0.5 }], theyHaveForUs: [{ ref: 'MAL-04', theirPrice: 18, valueToUs: 20 }], matchCount: 2,
        }
      }
      return row
    })
}
