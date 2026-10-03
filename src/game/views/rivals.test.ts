import { describe, expect, it } from 'vitest'
import { EMPTY_RIVALS, type RivalCard, type RivalsSnapshot, type RivalTeam } from '../../../shared/rivals.ts'
import { mockRivals, rivalsStateOf } from '../rivals.ts'
import { GAME_STRINGS } from '../strings.ts'
import { apply, createState, type GameEvent, type Payload } from '../state.ts'
import { CHASE_TICKS, chasedSet, knownBySet, needRows, needsOf, nowOf, pickTeam, rivalAlbum, teamRows } from './rivals.ts'

let nextId = 1
const ev = (type: string, payload: Payload = {}, tick = 500): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor: '', payload })

const BOOK = [10, 10, 10, 10, 10, 25, 25, 25, 70, 70]
const ref = (set: string, n: number) => `${set}-${String(n).padStart(2, '0')}`

/** Our album: AAA ×1.6 lacks its slot 10, BBB ×1.2 lacks 8 and 9, CCC ×0.5 lacks eight, DDD ×1.3 complete. */
function us(affinity: Record<string, number> = { AAA: 1.6, BBB: 1.2, CCC: 0.5, DDD: 1.3 }) {
  const held = (set: string, slots: number[], aff: number) => slots.map((n) => ({ id: 100 + slots.length * 10 + n, kind: 'card', ref: ref(set, n), serial: 1, your_value: (BOOK[n - 1] ?? 0) * aff }))
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('agent.me', {
    cash: 100,
    affinity,
    album: {
      pages: [
        { set: 'CCC', name: 'Ccc', have: 2, of: 10, complete: false },
        { set: 'BBB', name: 'Bbb', have: 8, of: 10, complete: false },
        { set: 'AAA', name: 'Aaa', have: 9, of: 10, complete: false },
        { set: 'DDD', name: 'Ddd', have: 10, of: 10, complete: true },
      ],
    },
    assets: [
      ...held('AAA', [1, 2, 3, 4, 5, 6, 7, 8, 9], 1.6),
      ...held('BBB', [1, 2, 3, 4, 5, 6, 7, 10], 1.2),
      ...held('CCC', [1, 2], 0.5),
      ...held('DDD', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1.3),
    ],
  }, 500))
  return s
}

const card = (holder: string, c: string, extra: Partial<RivalCard> = {}): RivalCard => ({
  holder, card: c, set: c.slice(0, 3), rarity: null, name: null, copies: 1, how: 'bought', since: 400, seen: 400, ...extra,
})

const snap = (over: Partial<RivalsSnapshot> = {}): RivalsSnapshot => ({ ...EMPTY_RIVALS, tick: 500, ...over })

describe('needsOf', () => {
  it('lists what our target pages lack (affinity above ×1), the closest page first; never a low or complete page', () => {
    expect(needsOf(us()).map((n) => [n.ref, n.page, n.have, n.of])).toEqual([
      ['AAA-10', 'Aaa', 9, 10],
      ['BBB-08', 'Bbb', 8, 10],
      ['BBB-09', 'Bbb', 8, 10],
    ])
    expect(needsOf(us()).map((n) => n.rarity)).toEqual(['rare', 'uncommon', 'rare'])
  })

  it('without a target page, the incomplete pages three cards or fewer short', () => {
    expect(needsOf(us({ AAA: 1, BBB: 0.9, CCC: 0.5, DDD: 1 })).map((n) => n.ref)).toEqual(['AAA-10', 'BBB-08', 'BBB-09'])
  })
})

describe('needRows', () => {
  const holdings = [
    card('t05', 'AAA-10', { seen: 480 }),
    card('t07', 'AAA-10', { copies: 2, how: 'pack', since: 300, seen: 300 }),
    card('t09', 'AAA-10', { seen: 490 }),
    card('t01', 'AAA-10'),
    card('dealer_x', 'AAA-10'),
    card('t05', 'BBB-09', { how: 'listed' }),
  ]
  const wants = [
    { team: 't04', card: 'AAA-10', via: 'bid' as const, times: 3, last: 495, topBid: 60 },
    { team: 't04', card: 'AAA-10', via: 'dealer' as const, times: 1, last: 498, topBid: null },
    { team: 't06', card: 'AAA-10', via: 'bid' as const, times: 1, last: 500 - CHASE_TICKS - 1, topBid: 99 },
    { team: 't01', card: 'AAA-10', via: 'bid' as const, times: 9, last: 499, topBid: 70 },
  ]

  it('names who holds each card: a spare first, then the freshest; dealers apart; never us', () => {
    const rows = needRows(snap({ holdings, wants }), us())
    const a = rows[0]
    expect(a?.holders.map((h) => [h.team, h.copies, h.how])).toEqual([['t07', 2, 'pack'], ['t09', 1, 'bought'], ['t05', 1, 'bought']])
    expect(a?.dealers).toEqual(['dealer_x'])
    expect(rows[1]?.holders).toEqual([])
    expect(rows[2]?.holders.map((h) => [h.team, h.how])).toEqual([['t05', 'listed']])
  })

  it('names who chases it with us lately: one line per team, its best bid; an old bid and our own are left out', () => {
    const a = needRows(snap({ holdings, wants }), us())[0]
    expect(a?.chasers).toEqual([{ team: 't04', last: 498, topBid: 60, via: ['bid', 'dealer'] }])
  })
})

describe('teamRows', () => {
  const teams: RivalTeam[] = [
    { team: 't07', rank: 2, score: 29.5, level: 4, pages: 2, deals: 30, tick: 500, interest: { AAA: 12, CCC: -40 } },
    { team: 't01', rank: 3, score: 28.9, level: 4, pages: 1, deals: 20, tick: 500, interest: {} },
    { team: 't05', rank: 1, score: 30.4, level: 4, pages: 2, deals: 40, tick: 500, interest: { CCC: 3, BBB: 3 } },
    { team: 't09', rank: 4, score: 20, level: 3, pages: 0, deals: 9, tick: 500, interest: { AAA: -2 } },
  ]
  const holdings = [card('t07', 'AAA-10'), card('t07', 'BBB-09'), card('t07', 'BBB-01'), card('t07', 'BBB-11'), card('t05', 'CCC-01'), card('t01', 'AAA-01')]

  it('sorts by rank, marks us, counts our needs each holds and flags a team chasing a set we aim for', () => {
    const rows = teamRows(snap({ teams, holdings }), us())
    expect(rows.map((r) => [r.team, r.rank, r.us, r.holdsNeeds, r.chases, r.rival])).toEqual([
      ['t05', 1, false, 0, 'BBB', true],
      ['t07', 2, false, 2, 'AAA', true],
      ['t01', 3, true, 0, null, false],
      ['t09', 4, false, 0, null, false],
    ])
    expect(rows[1]?.best).toEqual({ set: 'BBB', known: 2 })
  })

  it('picks the team asked for (case aside), else the best-ranked rival holding most of our needs; never us', () => {
    const rows = teamRows(snap({ teams, holdings }), us())
    expect(pickTeam(rows, 'T09')).toBe('t09')
    expect(pickTeam(rows, 't01')).toBe('t07')
    expect(pickTeam(rows, null)).toBe('t07')
    expect(pickTeam([], null)).toBeNull()
  })

  it('reads the chased set only when one is above 0, a tie by name', () => {
    expect(chasedSet({ interest: { BBB: 3, AAA: 3, CCC: -1 } })).toBe('AAA')
    expect(chasedSet({ interest: { AAA: 0, BBB: -5 } })).toBeNull()
  })
})

describe('rivalAlbum', () => {
  it('draws a known card filled and every other one unknown, our needs marked, the page holding most of them first', () => {
    // a set the screen does not know (not in SETS) is never drawn
    expect(rivalAlbum(snap({ holdings: [card('t07', 'AAA-10')] }), 't07')).toEqual([])
    const real = [card('t07', 'LAV-10', { copies: 2, since: 300, seen: 450 }), card('t07', 'MAL-01'), card('t07', 'MAL-02'), card('t07', 'MAL-03'), card('t07', 'LAV-11', { how: 'pack' }), card('t05', 'SAL-01')]
    const needs = [{ ref: 'LAV-10', set: 'LAV', page: 'Lavapiés', rarity: 'rare' as const, have: 9, of: 10 }]
    const album = rivalAlbum(snap({ holdings: real }), 't07', needs)
    expect(album.map((p) => [p.set, p.known, p.needs])).toEqual([['LAV', 1, 1], ['MAL', 3, 0], ['SAL', 0, 0]])
    const lav = album[0]
    expect(lav?.slots).toHaveLength(12)
    expect(lav?.slots[9]).toMatchObject({ ref: 'LAV-10', need: true, known: { copies: 2, how: 'bought', since: 300, seen: 450 } })
    expect(lav?.slots[10]?.known?.how).toBe('pack')
    expect(lav?.slots[0]).toMatchObject({ ref: 'LAV-01', known: null, need: false, name: 'La Corrala' })
  })

  it('counts a holder\'s known page cards by set, the specials apart', () => {
    const k = knownBySet([card('t07', 'MAL-01'), card('t07', 'MAL-11'), card('t07', 'MAL-01'), card('t05', 'LAV-02')], 't07')
    expect([...k.entries()].map(([set, refs]) => [set, [...refs]])).toEqual([['MAL', ['MAL-01']]])
  })
})

describe('the source', () => {
  it('reads an answer: locked, off, an error keeps the last snapshot', () => {
    const prev = snap({ tick: 7 })
    expect(rivalsStateOf(401, {}, prev).status).toBe('locked')
    expect(rivalsStateOf(200, { enabled: false }, prev)).toEqual({ status: 'off', snapshot: EMPTY_RIVALS })
    expect(rivalsStateOf(500, null, prev)).toEqual({ status: 'error', snapshot: prev })
    const live = rivalsStateOf(200, { enabled: true, at: 'x', tick: 9, parts: { holdings: true }, holdings: [card('t05', 'AAA-01')], teams: 'odd' }, prev)
    expect(live.snapshot).toMatchObject({ at: 'x', tick: 9, parts: { holdings: true, teams: false }, teams: [] })
    expect(live.snapshot.holdings).toHaveLength(1)
  })

  it('says a time ago in whole minutes: never "5 h 60 min"', () => {
    expect(GAME_STRINGS.es.hum.ago(1439, 1439 * 15)).toBe('hace 6 h 0 min')
    expect(GAME_STRINGS.en.hum.ago(1400, 1400 * 15)).toBe('5 h 50 min ago')
  })

  it('counts time from the feed\'s head or the game clock, the later', () => {
    expect(nowOf(snap({ tick: 510 }), { tick: 500 })).toBe(510)
    expect(nowOf(snap({ tick: null }), { tick: 500 })).toBe(500)
  })

  it('makes the same mock market every time, with us ranked among the rivals', () => {
    const a = mockRivals(600)
    expect(mockRivals(600)).toEqual(a)
    expect(a.teams.map((t) => t.team)).toContain('t01')
    expect(a.teams.map((t) => t.rank)).toEqual(a.teams.map((_, i) => i + 1))
    expect(a.holdings.every((h) => h.copies >= 1 && h.seen >= h.since && h.seen <= 600)).toBe(true)
    // never a tick ahead of the mock game's clock, even at its start
    const early = mockRivals(20)
    expect([...early.holdings.map((h) => h.seen), ...early.wants.map((w) => w.last)].every((t) => t >= 0 && t <= 20)).toBe(true)
  })
})
