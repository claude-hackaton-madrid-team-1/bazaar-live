import { describe, expect, it } from 'vitest'
import { boardOf, boardRowsOf, LIST_MAX } from './boardRows.ts'

/** A row as pg hands it over: numeric as strings, text[] as arrays, jsonb parsed. */
const RAW = {
  team: 't05', tick: 640, rank: 2, score: '412.5', negotiating: '120.25', market: '80', level: 3, pages: 2, deals: 14, venue: 'v05',
  rank_change: 1, score_change: '18.5', trend_ticks: 30,
  trend: [{ tick: 610, rank: 3, score: 394 }, { tick: 640, rank: 2, score: 412.5 }],
  our_team: 't01', our_rank: 4, our_score: '380', our_negotiating: '100', our_market: '60.5', our_pages: 1,
  dealer_deals: 9, venue_trades: 3, top_set: 'LAV', set_interest: { LAV: 2.5, MAL: -1 },
  strengths: ['negotiating', 'climbing'], weaknesses: ['no_venue_trades'],
  they_want: [{ ref: 'LAV-09', price: 70, tick: 638 }], they_have: [{ ref: 'MAL-02', price: 12, tick: 636 }],
  we_have_for_them: [{ ref: 'LAV-09', spare: 1, their_price: 70, our_value: 42.5 }],
  they_have_for_us: [{ ref: 'MAL-02', their_price: 12, value_to_us: 17.5 }], match_count: 2,
  guarded: true, guard_reason: 'top5',
  move_kind: 'swap', move_give: 'LAV-09', move_get: 'MAL-02', move_price: null, our_gain: '17.5', their_gain: '28', suggested_move: 'Swap our spare LAV-09 for their MAL-02.',
  why_climbed: 'Sold LAV-09 to t07 for 70 on v05.', why_climbed_tick: 639,
}

describe('boardOf', () => {
  it('reads every field of a full row, pg strings as numbers', () => {
    expect(boardOf(RAW)).toEqual({
      team: 't05', tick: 640, rank: 2, score: 412.5, negotiating: 120.25, market: 80, level: 3, pages: 2, deals: 14, venue: 'v05',
      rankChange: 1, scoreChange: 18.5, trendTicks: 30,
      trend: [{ tick: 610, rank: 3, score: 394 }, { tick: 640, rank: 2, score: 412.5 }],
      ourRank: 4, ourScore: 380, ourNegotiating: 100, ourMarket: 60.5, ourPages: 1,
      dealerDeals: 9, venueTrades: 3, topSet: 'LAV', setInterest: { LAV: 2.5, MAL: -1 },
      strengths: ['negotiating', 'climbing'], weaknesses: ['no_venue_trades'],
      theyWant: [{ ref: 'LAV-09', price: 70, tick: 638 }], theyHave: [{ ref: 'MAL-02', price: 12, tick: 636 }],
      weHaveForThem: [{ ref: 'LAV-09', spare: 1, theirPrice: 70, ourValue: 42.5 }],
      theyHaveForUs: [{ ref: 'MAL-02', theirPrice: 12, valueToUs: 17.5 }], matchCount: 2,
      guarded: true, guardReason: 'top5',
      moveKind: 'swap', moveGive: 'LAV-09', moveGet: 'MAL-02', movePrice: null, ourGain: 17.5, theirGain: 28,
      suggestedMove: 'Swap our spare LAV-09 for their MAL-02.',
      whyClimbed: 'Sold LAV-09 to t07 for 70 on v05.', whyClimbedTick: 639,
    })
  })

  it.each([
    ['no team', { team: null }],
    ['a team that is not one short word', { team: 't05 <b>' }],
    ['no rank', { rank: undefined }],
    ['a rank below 1', { rank: 0 }],
    ['a rank that is not a whole number', { rank: '2.5' }],
    ['no tick', { tick: 'soon' }],
    ['a negative tick', { tick: -1 }],
    ['our own team', { team: 't01' }],
  ])('skips a row with %s', (_why, patch) => {
    expect(boardOf({ ...RAW, ...patch })).toBeNull()
  })

  it('skips what is not a row at all', () => {
    for (const raw of [null, undefined, 'x', 7, [RAW]]) expect(boardOf(raw)).toBeNull()
  })

  it('an odd field becomes null or empty, never a crash', () => {
    const r = boardOf({
      ...RAW,
      score: 'NaN', negotiating: Infinity, market: {}, level: -2, pages: 1.5, deals: '14', venue: 'v 05',
      rank_change: '1.5', score_change: [], trend_ticks: null, trend: { tick: 1 },
      our_team: 7, our_rank: 0, our_score: 'high', our_pages: -1,
      dealer_deals: -3, venue_trades: 'many', top_set: 'lav', set_interest: ['LAV'],
      strengths: 'negotiating', weaknesses: null,
      they_want: 'LAV-09', they_have: null, we_have_for_them: {}, they_have_for_us: 12, match_count: -1,
      guarded: 'true', guard_reason: 'rich',
      move_kind: 'gift', move_give: 'lav-09', move_get: 'LAV-9999', move_price: -5, our_gain: '', their_gain: 'x',
      suggested_move: '   ', why_climbed: 42, why_climbed_tick: 'x',
    })
    expect(r).toMatchObject({
      score: null, negotiating: null, market: null, level: null, pages: null, deals: 14, venue: null,
      rankChange: null, scoreChange: null, trendTicks: null, trend: [],
      ourRank: null, ourScore: null, ourPages: null,
      dealerDeals: 0, venueTrades: 0, topSet: null, setInterest: {},
      strengths: [], weaknesses: [], theyWant: [], theyHave: [], weHaveForThem: [], theyHaveForUs: [], matchCount: 0,
      guarded: false, guardReason: null,
      moveKind: 'watch', moveGive: null, moveGet: null, movePrice: null, ourGain: null, theirGain: null,
      suggestedMove: '', whyClimbed: null, whyClimbedTick: null,
    })
  })

  it('keeps only known codes, each once, and only well-formed list items', () => {
    const r = boardOf({
      ...RAW,
      strengths: ['climbing', 'bribes', 'climbing', null, 'venue'],
      weaknesses: ['needs_cards', 'dealer_ladder', 'falling'],
      // parsed as pg parses jsonb: "__proto__" becomes an own key, not the prototype
      set_interest: JSON.parse('{"LAV": "2.5", "lav": 1, "LAVAPIES": 2, "MAL": "x", "__proto__": {"polluted": 1}, "SAL": -0.5}'),
      trend: [{ tick: 600, rank: 5 }, { tick: 'x', rank: 4 }, { tick: 620, rank: 0 }, 'p', { tick: 640, rank: 2, score: '412.5' }],
      they_want: [{ ref: 'LAV-09', price: -3, tick: -1 }, { ref: 'lav-09', price: 5 }, { price: 5 }, { ref: 'SAL-10' }],
      we_have_for_them: [{ ref: 'LAV-09', spare: 0 }, { ref: 'LAV-08', spare: '2', their_price: '33', our_value: 'x' }, { ref: 'X', spare: 1 }],
      they_have_for_us: [{ ref: 'MAL-02', their_price: null, value_to_us: '17.5' }, { ref: 'MAL 02' }],
      match_count: null,
    })
    expect(r?.strengths).toEqual(['climbing', 'venue'])
    expect(r?.weaknesses).toEqual(['needs_cards', 'falling'])
    expect(r?.setInterest).toEqual({ LAV: 2.5, SAL: -0.5 })
    expect(Object.getPrototypeOf(r?.setInterest)).toBe(Object.prototype)
    expect(r?.trend).toEqual([{ tick: 600, rank: 5, score: null }, { tick: 640, rank: 2, score: 412.5 }])
    expect(r?.theyWant).toEqual([{ ref: 'LAV-09', price: null, tick: null }, { ref: 'SAL-10', price: null, tick: null }])
    expect(r?.weHaveForThem).toEqual([{ ref: 'LAV-08', spare: 2, theirPrice: 33, ourValue: null }])
    expect(r?.theyHaveForUs).toEqual([{ ref: 'MAL-02', theirPrice: null, valueToUs: 17.5 }])
    // no count from the view: the two lists' own lengths
    expect(r?.matchCount).toBe(2)
  })

  it(`caps every list at ${LIST_MAX}: the trend keeps its newest points`, () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ref: `LAV-${i + 1}`, price: i, tick: 600 + i, spare: 1, their_price: i, value_to_us: i }))
    const trend = Array.from({ length: 30 }, (_, i) => ({ tick: 600 + i, rank: 1 + (i % 18), score: i }))
    const interest = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`S${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, i]))
    const r = boardOf({ ...RAW, they_want: many, they_have: many, we_have_for_them: many, they_have_for_us: many, trend, set_interest: interest, match_count: 60 })
    expect(r?.theyWant).toHaveLength(LIST_MAX)
    expect(r?.theyHave).toHaveLength(LIST_MAX)
    expect(r?.weHaveForThem).toHaveLength(LIST_MAX)
    expect(r?.theyHaveForUs).toHaveLength(LIST_MAX)
    expect(r?.theyWant[0]?.ref).toBe('LAV-1')
    expect(r?.trend).toHaveLength(LIST_MAX)
    expect(r?.trend[0]?.tick).toBe(610)
    expect(r?.trend.at(-1)?.tick).toBe(629)
    expect(Object.keys(r?.setInterest ?? {})).toHaveLength(LIST_MAX)
    // the view's own count stands: it counts what the caps cut
    expect(r?.matchCount).toBe(60)
  })

  it('cuts the sentence to 200 and the note to 300 characters, on one printable line', () => {
    const r = boardOf({ ...RAW, suggested_move: `Swap\u0000 now\n${'x'.repeat(400)}`, why_climbed: `Climbed‮ ${'y'.repeat(400)}` })
    expect(r?.suggestedMove).toHaveLength(200)
    expect(r?.suggestedMove.startsWith('Swap now x')).toBe(true)
    expect(r?.suggestedMove.endsWith('…')).toBe(true)
    expect(r?.whyClimbed).toHaveLength(300)
    expect(r?.whyClimbed?.startsWith('Climbed y')).toBe(true)
  })

  it('takes every move kind and guard reason the screen knows', () => {
    for (const kind of ['swap', 'sell', 'buy', 'hold', 'watch']) expect(boardOf({ ...RAW, move_kind: kind })?.moveKind).toBe(kind)
    expect(boardOf({ ...RAW, guard_reason: 'near' })?.guardReason).toBe('near')
    expect(boardOf({ ...RAW, guarded: false, guard_reason: null })).toMatchObject({ guarded: false, guardReason: null })
    expect(boardOf({ ...RAW, move_kind: 'sell', move_price: '70' })?.movePrice).toBe(70)
  })
})

describe('boardRowsOf', () => {
  it('keeps each team once (its first row: the best rank) and drops what does not parse', () => {
    const rows = boardRowsOf([
      { ...RAW, team: 't03', rank: 1 },
      { ...RAW, team: 't05', rank: 2 },
      { ...RAW, team: 't03', rank: 7 },
      { ...RAW, team: 't01', rank: 4 },
      { team: 't09' },
      'garbage',
      { ...RAW, team: 't09', rank: 9, our_team: null },
    ])
    expect(rows.map((r) => [r.team, r.rank])).toEqual([['t03', 1], ['t05', 2], ['t09', 9]])
  })

  it('reads an empty view as no rows', () => {
    expect(boardRowsOf([])).toEqual([])
  })
})
