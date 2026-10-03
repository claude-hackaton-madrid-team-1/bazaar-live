import { describe, expect, it } from 'vitest'
import { askOf, catalogOf, decisionOf, meOf, spendOf } from './rows.ts'

describe('strategy rows', () => {
  it('reads our snapshot: numbers only in the affinity, odd pages and cards dropped', () => {
    const me = meOf({
      team: 't01', tick: '629', read_at: new Date('2026-10-03T11:24:25Z'), cash: 81, level: 3, venue: 'v19', tick_seconds: 15,
      affinity: { LAV: 1.6, SAL: '1.3', bad: 2, CHA: 'x' },
      pages: [{ set: 'LAV', name: 'Lavapiés', have: 8, of: 10, complete: false }, { set: 'SAL', have: 10, of: 10, complete: true }, { set: 'X' }],
      cards: [{ ref: 'LAV-01', set: 'LAV', rarity: 'common', asset: 3, value: '16' }, { ref: 'nope', value: 1 }, 'x'],
    })
    expect(me).toEqual({
      team: 't01', tick: 629, at: '2026-10-03T11:24:25.000Z', cash: 81, level: 3, venue: 'v19', tickSeconds: 15,
      affinity: { LAV: 1.6, SAL: 1.3 },
      pages: [{ set: 'LAV', name: 'Lavapiés', have: 8, of: 10, complete: false }, { set: 'SAL', name: null, have: 10, of: 10, complete: true }],
      cards: [{ ref: 'LAV-01', set: 'LAV', rarity: 'common', asset: 3, value: 16 }],
    })
    expect(meOf({ team: 't01', tick: 1 })).toBeNull()
  })

  it('reads the spend, never below 0', () => {
    expect(spendOf({ ledger_tick: 629, t_hours: '6.5667', spent: -3, buys: 0 })).toEqual({ ledgerTick: 629, tHours: 6.5667, spent: 0, buys: 0 })
    expect(spendOf({})).toBeNull()
  })

  it('reads a decision of the taker or the maker, never another agent', () => {
    const d = decisionOf({
      id: '1344', tick: 584, agent: 'taker', kind: 'accept_ask', status: 'rejected', allowed: false,
      guardrail: 'denied: cash 81 - 79 < cash_floor 50', card: 'MAL-10', rarity: 'rare', venue: 'rastro', price: 74, fee: 5, total: 79,
      our_value: '113.4', surplus: '34.4', jev_value: null, reason: 'worth 70×1.1 + bonus share 36.4 = 113.4;\nask 74 + fee 5 on rastro = 79',
    })
    expect(d).toMatchObject({ id: 1344, agent: 'taker', allowed: false, card: 'MAL-10', total: 79, value: 113.4, surplus: 34.4, giveCard: null })
    expect(d?.reason).toBe('worth 70×1.1 + bonus share 36.4 = 113.4; ask 74 + fee 5 on rastro = 79')
    expect(decisionOf({ id: 1, tick: 1, agent: 'duels', kind: 'duel_hold', status: 'approved' })).toBeNull()
  })

  it('reads an open ask: a card code and a price are required', () => {
    expect(askOf({ offer: 9161, tick: 629, expires_tick: 649, venue: 'rastro', maker: 't01', to_team: null, asset: 778, card: 'SAL-01', rarity: 'common', price: 10, ours: true })).toEqual({
      offer: 9161, tick: 629, expiresTick: 649, venue: 'rastro', maker: 't01', to: null, asset: 778, card: 'SAL-01', rarity: 'common', price: 10, ours: true,
    })
    expect(askOf({ offer: 1, tick: 1, card: 'SAL-01', price: 0 })).toBeNull()
    expect(askOf({ offer: 1, tick: 1, card: 'pack', price: 3 })).toBeNull()
  })

  it('reads a catalog card', () => {
    expect(catalogOf({ card: 'MAL-10', set_code: 'MAL', set_name: 'Malasaña', name: 'Noche de Movida', rarity: 'rare', book: '70.0', minted: 5, print_run: 30, page: true, last_fill: 74, last_fill_tick: 600 })).toEqual({
      card: 'MAL-10', set: 'MAL', setName: 'Malasaña', name: 'Noche de Movida', rarity: 'rare', book: 70, minted: 5, printRun: 30, page: true, lastFill: 74, lastFillTick: 600,
    })
  })
})
