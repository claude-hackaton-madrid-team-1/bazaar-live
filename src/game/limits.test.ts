import { describe, expect, it } from 'vitest'
import type { GuardrailLimits, LedgerTick } from '../../shared/decisions.ts'
import { GUARDRAILS_DOC } from '../../shared/guardrails.ts'
import { moneyOf, moneyRulesOf, moneyTextOf, newerThanDocs, NEW_RUN, paceOf, releaseOf } from './limits.ts'

/** The docs' first tick: every number below is relative to it. */
const S = GUARDRAILS_DOC.since.tick
const NOW = S + 40
const DOC_FLOOR = GUARDRAILS_DOC.cashFloor
const DOC_SPEND = GUARDRAILS_DOC.maxSpendPerHour
const RESERVE = GUARDRAILS_DOC.venueBondReserve

const denial = (tick: number, text: string) => ({ tick, text })
const server = (over: Partial<GuardrailLimits> = {}): GuardrailLimits => ({ spendPerHour: DOC_SPEND, cashFloor: DOC_FLOOR, acceptsPerTick: 1, bondReserve: RESERVE, ...over })

describe('moneyTextOf', () => {
  it('reads the floor, the reserve held on top of it, and the hourly cap', () => {
    expect(moneyTextOf('denied: cash 30 - 25 < cash_floor 11; spend 40 + 25 > max_spend_per_game_hour 60')).toEqual({ cashFloor: 11, bondReserve: 0, maxSpend: 60 })
    expect(moneyTextOf('denied: cash 300 - 25 < cash_floor 11 + venue_bond_reserve 280')).toEqual({ cashFloor: 11, bondReserve: 280, maxSpend: null })
    expect(moneyTextOf('denied: price 31 > max_price_uncommon 26')).toEqual({ cashFloor: null, bondReserve: null, maxSpend: null })
    expect(moneyTextOf(null)).toEqual({ cashFloor: null, bondReserve: null, maxSpend: null })
  })
})

describe('newerThanDocs', () => {
  it('in the docs’ run, only a denial at or past their first tick is newer', () => {
    expect(newerThanDocs(S - 1, NOW)).toBe(false)
    expect(newerThanDocs(S, NOW)).toBe(true)
    expect(newerThanDocs(NOW, NOW)).toBe(true)
  })

  it('once the clock started again below the docs’ tick, the new run’s denials are newer; an earlier run’s are not', () => {
    expect(newerThanDocs(5, 20)).toBe(true)
    expect(newerThanDocs(20 + NEW_RUN + 1, 20)).toBe(false)
    expect(newerThanDocs(S + 500, S + 10)).toBe(false) // a far higher tick than now: an earlier run's clock
  })
})

describe('moneyRulesOf', () => {
  it('a stale denial with the old value never beats a newer doc value', () => {
    const rules = moneyRulesOf([denial(S - 3, 'denied: cash 90 - 80 < cash_floor 77; spend 10 + 80 > max_spend_per_game_hour 66')], NOW)
    expect(rules.cashFloor).toEqual({ value: DOC_FLOOR, source: 'doc', tick: null })
    expect(rules.maxSpend).toEqual({ value: DOC_SPEND, source: 'doc', tick: null })
    expect(rules.reserveHeld).toBeNull()
  })

  it('nor a newer server value: the GUARDRAIL_* variable wins over the stale denial and the docs', () => {
    const rules = moneyRulesOf([denial(S - 3, 'denied: cash 90 - 80 < cash_floor 77')], NOW, server({ cashFloor: 33, fromEnv: ['cashFloor'] }))
    expect(rules.cashFloor).toEqual({ value: 33, source: 'env', tick: null })
    expect(rules.maxSpend.source).toBe('doc')
  })

  it('a denial newer than the docs wins over the server and the docs; the newest per rule by tick, in any order', () => {
    const rules = moneyRulesOf(
      [
        denial(S + 9, 'denied: cash 50 - 45 < cash_floor 12'),
        denial(S + 2, 'denied: cash 50 - 45 < cash_floor 13; spend 10 + 45 > max_spend_per_game_hour 44'),
        denial(S + 30, 'denied: price 31 > max_price_uncommon 26'),
        denial(S - 1, 'denied: spend 10 + 45 > max_spend_per_game_hour 99'),
      ],
      NOW,
      server({ cashFloor: 33, fromEnv: ['cashFloor'] }),
    )
    expect(rules.cashFloor).toEqual({ value: 12, source: 'denial', tick: S + 9 })
    expect(rules.maxSpend).toEqual({ value: 44, source: 'denial', tick: S + 2 })
    expect(rules.reserveHeld).toBe(false)
  })
})

describe('moneyOf', () => {
  const plain = moneyRulesOf([], NOW, server({ cashFloor: 10, spendPerHour: 100, bondReserve: 200 }))

  it('the floor is cash_floor alone once our venue is open', () => {
    const m = moneyOf(150, 30, plain, true)
    expect(m).toMatchObject({ floor: 10, reserve: null, cashRoom: 140, spendRoom: 70, available: 70, binds: 'max_spend_per_game_hour' })
  })

  it('it holds the bond reserve too while our planned venue is not open yet', () => {
    const m = moneyOf(250, 30, plain, false)
    expect(m).toMatchObject({ floor: 210, reserve: 200, cashRoom: 40, available: 40, binds: 'cash_floor' })
  })

  it('no reserve when no venue is planned; with the venue unknown, the newest fresh denial says whether the floor held it', () => {
    expect(moneyOf(250, 0, moneyRulesOf([], NOW, server({ cashFloor: 10, bondReserve: 0 })), false)).toMatchObject({ floor: 10, reserve: null })
    const held = moneyRulesOf([denial(S + 1, 'denied: cash 250 - 60 < cash_floor 10 + venue_bond_reserve 200')], NOW, server({ cashFloor: 10, bondReserve: 200 }))
    expect(moneyOf(250, 0, held, null)).toMatchObject({ floor: 210, reserve: 200 })
    expect(moneyOf(250, 0, plain, null)).toMatchObject({ floor: 10, reserve: null })
  })

  it('what we can spend is the smaller room, never below zero; the floor binds on a tie', () => {
    expect(moneyOf(5, 0, plain, true)).toMatchObject({ cashRoom: 0, available: 0, binds: 'cash_floor' })
    expect(moneyOf(80, 30, plain, true)).toMatchObject({ cashRoom: 70, spendRoom: 70, binds: 'cash_floor' })
    expect(moneyOf(500, 130, plain, true)).toMatchObject({ spendRoom: 0, available: 0, binds: 'max_spend_per_game_hour' })
    expect(moneyOf(null, null, plain, true)).toMatchObject({ available: null, binds: null })
  })
})

describe('releaseOf', () => {
  // one game hour is 100 ticks here; a tick lasts 30 s
  const ticks: LedgerTick[] = [
    { tick: 100, t: 1.0, spent: 40, accepts: 1, listings: 0 }, // out of the window at t 2.2
    { tick: 140, t: 1.4, spent: 0, accepts: 0, listings: 1 },
    { tick: 150, t: 1.5, spent: 25, accepts: 1, listings: 0 },
    { tick: 210, t: 2.1, spent: 10, accepts: 1, listings: 0 },
    { tick: 220, t: 2.2, spent: 0, accepts: 0, listings: 0 },
  ]

  it('the oldest spend in the rolling hour leaves it one game hour after it was made', () => {
    expect(paceOf(ticks)).toBeCloseTo(0.01)
    expect(releaseOf(ticks, 2.2, 0.01, 30)).toEqual({ amount: 25, ticks: 30, seconds: 900 })
    expect(releaseOf(ticks, 2.2, 0.01, null)).toEqual({ amount: 25, ticks: 30, seconds: null })
  })

  it('nothing spent in the window: nothing to free; no pace: no time to say', () => {
    expect(releaseOf(ticks, 3.5, 0.01, 30)).toBeNull()
    const one = [{ tick: 5, t: 0.05, spent: 9, accepts: 1, listings: 0 }]
    expect(paceOf(one)).toBeNull()
    expect(releaseOf(one, 0.1, null, 30)).toEqual({ amount: 9, ticks: null, seconds: null })
  })
})


it('AT1 zero cap leaves cash available and ignores pre-rollout cap denials', () => {
  const rules = moneyRulesOf([denial(1665, 'spend 240 + 20 > max_spend_per_game_hour 250')], 1700)
  expect(rules.maxSpend.value).toBe(0)
  expect(moneyOf(491, 900, rules, true)).toMatchObject({ cashRoom: 486, spendRoom: null, available: 486, binds: 'cash_floor' })
})
