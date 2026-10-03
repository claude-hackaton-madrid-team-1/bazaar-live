import { describe, expect, it } from 'vitest'
import { EMPTY_STRATEGY, type StrategyDecision, type StrategySnapshot } from '../../../shared/strategy.ts'
import { GUARDRAILS_DOC } from '../../../shared/guardrails.ts'
import { mockStrategy, strategyStateOf } from '../strategy.ts'
import { STRATEGY_STRINGS } from '../strategyStrings.ts'
import {
  bindingOf, blockedBuys, boardOf, brokenRules, currentLimit, holdingsOf, mainNow, jevVetoOf, leversOf, nowTickOf, planOf, rulesOf, unblockOf, windowOf,
} from './strategy.ts'

const d = (over: Partial<StrategyDecision> & Pick<StrategyDecision, 'id' | 'tick'>): StrategyDecision => ({
  agent: 'taker', kind: 'accept_ask', status: 'rejected', allowed: false, guardrail: null, card: null, giveCard: null, rarity: null, venue: 'rastro',
  price: null, fee: null, total: null, value: null, surplus: null, jevValue: null, jevVerdict: null, jevReason: null, reason: null, ...over,
})

const mock = mockStrategy(630)
const all = (s: StrategySnapshot) => {
  const win = windowOf(s.decisions, nowTickOf(s))
  const rules = rulesOf(s.decisions, nowTickOf(s), s.limits ?? null)
  const levers = leversOf(s, rules)
  const blocked = blockedBuys(s, win)
  return { win, rules, levers, blocked, binding: bindingOf(blocked, levers) }
}

describe('brokenRules', () => {
  it('reads every rule a denial names, with its value, money first', () => {
    expect(brokenRules(d({ id: 1, tick: 1, guardrail: 'denied: price 34 > max_price_uncommon 26; cash 57 - 34 < cash_floor 50; spend 139 + 29 > max_spend_per_game_hour 150' }))).toEqual([
      { rule: 'cash_floor', rarity: null, limit: 50, text: null },
      { rule: 'max_spend_per_game_hour', rarity: null, limit: 150, text: null },
      { rule: 'max_price', rarity: 'uncommon', limit: 26, text: null },
    ])
    // while the venue's bond is held the floor that refused is cash_floor + the reserve
    expect(brokenRules(d({ id: 1, tick: 1, guardrail: 'denied: cash 300 - 40 < cash_floor 11 + venue_bond_reserve 280' }))[0]).toMatchObject({ rule: 'cash_floor', limit: 291 })
    expect(brokenRules(d({ id: 1, tick: 1, guardrail: 'denied: we already hold SAL-08 (block_buying_held_cards); max_counterparty_share 1.0' })).map((b) => b.rule)).toEqual(['block_buying_held_cards', 'other'])
  })

  it('tells a Jev refusal from one with no rule logged, and a decision that went through from both', () => {
    expect(brokenRules(d({ id: 1, tick: 1, kind: 'team_open', jevVerdict: 'undecided', jevReason: 'below_threshold', reason: 'jev undecided (0.29 < 0.75 or not yes, below_threshold)' }))[0]?.rule).toBe('jev')
    expect(brokenRules(d({ id: 1, tick: 1, reason: 'worth 70×1.1 = 77; ask 78 + fee 5 = 83' }))[0]?.rule).toBe('unrecorded')
    expect(brokenRules(d({ id: 1, tick: 1, status: 'done', allowed: true }))).toEqual([])
  })
})

describe('rulesOf', () => {
  const S = GUARDRAILS_DOC.since.tick

  it('reads the caps from the newest denial newer than the docs that names them, the rest from GUARDRAILS.md', () => {
    const rules = rulesOf([
      d({ id: 3, tick: S + 20, guardrail: 'denied: cash 81 - 79 < cash_floor 7' }),
      d({ id: 2, tick: S + 10, guardrail: 'denied: price 29 > max_price_uncommon 23; cash 119 - 29 < cash_floor 100' }),
      d({ id: 1, tick: S + 5, kind: 'team_open', reason: 'jev undecided (0.42 < 0.8 or not yes, below_threshold)' }),
    ], S + 30)
    expect(rules.cashFloor).toEqual({ value: 7, live: true })
    expect(rules.maxPrice.uncommon).toEqual({ value: 23, live: true })
    expect(rules.maxPrice.rare).toEqual({ value: GUARDRAILS_DOC.maxPrice.rare, live: false })
    expect(rules.maxSpend).toEqual({ value: GUARDRAILS_DOC.maxSpendPerHour, live: false })
    expect(rules.jevBar).toEqual({ value: 0.8, live: true })
  })

  it('a stale denial with the old value never beats the newer docs, nor the server’s variable', () => {
    const old = [d({ id: 1, tick: S - 2, guardrail: 'denied: price 29 > max_price_uncommon 23; cash 81 - 79 < cash_floor 77; spend 50 + 79 > max_spend_per_game_hour 66' })]
    const rules = rulesOf(old, S + 30)
    expect(rules.cashFloor).toEqual({ value: GUARDRAILS_DOC.cashFloor, live: false })
    expect(rules.maxSpend).toEqual({ value: GUARDRAILS_DOC.maxSpendPerHour, live: false })
    expect(rules.maxPrice.uncommon).toEqual({ value: GUARDRAILS_DOC.maxPrice.uncommon, live: false })
    const env = rulesOf(old, S + 30, { cashFloor: 33, spendPerHour: 333, acceptsPerTick: 1, fromEnv: ['cashFloor', 'spendPerHour'] })
    expect([env.cashFloor.value, env.maxSpend.value, env.money.cashFloor.source]).toEqual([33, 333, 'env'])
  })
})

describe('windowOf', () => {
  it('keeps the last ticks of the current run and stops at an earlier day', () => {
    const rows = [d({ id: 5, tick: 10 }), d({ id: 4, tick: 3 }), d({ id: 3, tick: 620 }), d({ id: 2, tick: 600 })]
    expect(windowOf(rows, 12).map((r) => r.id)).toEqual([5, 4])
    expect(windowOf([d({ id: 2, tick: 600 }), d({ id: 1, tick: 200 })], 630).map((r) => r.id)).toEqual([2])
    expect(windowOf(rows, null)).toEqual([])
  })
})

describe('the plan and the levers', () => {
  it('aims at the incomplete pages our affinity boosts, the highest first, with the cards they lack', () => {
    const plan = planOf(mock)
    expect(plan.targets.map((p) => [p.set, p.missing.map((m) => m.ref)])).toEqual([
      ['LAV', ['LAV-09', 'LAV-10']],
      ['MAL', ['MAL-09', 'MAL-10']],
    ])
    expect(plan.complete.map((p) => p.set)).toEqual(['SAL'])
    expect(plan.spareSets.map((s) => [s.set, s.protected])).toEqual([['LAT', true], ['RET', true], ['CHA', true]]) // every set since d3a59037
    expect(plan.spareSets.find((s) => s.set === 'CHA')?.name).toBe('Chamberí')
    expect(plan.allProtected).toBe(true)
    expect(STRATEGY_STRINGS.es.sell(5, '', 'La Latina', plan.allProtected)).toBe('Vender solo repetidas, a nuestro valor + 5: la única copia de una carta de página nunca se vende')
  })

  it('what we can spend is the smaller of cash above the floor and the hour left', () => {
    const { levers } = all(mock)
    const floor = GUARDRAILS_DOC.cashFloor
    const cap = GUARDRAILS_DOC.maxSpendPerHour
    expect(levers).toMatchObject({ cash: 81, floor, reserve: null, cashRoom: 81 - floor, spent: 0, spendRoom: cap, room: 81 - floor, binds: 'cash_floor' })
    expect(levers.caps.map((c) => c.rarity)).toEqual(['common', 'uncommon', 'rare', 'pack'])
    const spentOut = { ...mock, spend: { ledgerTick: 1, tHours: 1, spent: cap - 2, buys: 3 } }
    expect(leversOf(spentOut, rulesOf(mock.decisions)).room).toBe(2)
    expect(leversOf(spentOut, rulesOf(mock.decisions)).binds).toBe('max_spend_per_game_hour')
    // no venue of ours yet (and one planned): the floor holds the bond reserve too
    const noVenue = { ...mock, me: mock.me && { ...mock.me, cash: 500, venue: null } }
    expect(leversOf(noVenue, rulesOf(mock.decisions))).toMatchObject({ floor: floor + GUARDRAILS_DOC.venueBondReserve, reserve: GUARDRAILS_DOC.venueBondReserve })
  })
})

describe('why we do not buy', () => {
  it('groups refusals per card, what we still lack first, by the surplus given up', () => {
    const { blocked } = all(mock)
    expect(blocked.map((b) => [b.card, b.count, b.price, b.surplus, b.heldNow, b.main?.rule])).toEqual([
      ['MAL-10', 9, 79, 34.4, false, 'cash_floor'],
      ['SAL-08', 12, 31, 24.2, true, 'cash_floor'],
    ])
    expect(blocked[1]?.rules.map((r) => [r.rule, r.count])).toEqual([['max_price', 12], ['cash_floor', 4]])
  })

  it('the cash floor binds while the refused price is above what we can spend, with the cash that would fit it', () => {
    const { blocked, levers, binding } = all(mock)
    const floor = GUARDRAILS_DOC.cashFloor
    expect(binding).toMatchObject({ rule: 'cash_floor', limit: floor, latest: { card: 'MAL-10' } })
    expect(unblockOf(binding, blocked, levers)).toMatchObject({ rule: 'cash_floor', cards: 1, surplus: 34.4, cashNeeded: 79 + floor })
    const t = STRATEGY_STRINGS.es
    expect(t.headline(binding, levers.cash, levers.room, levers.spent)).toBe(`Caja 81 · suelo ${floor} · solo ${81 - floor} disponibles para comprar`)
    expect(STRATEGY_STRINGS.en.headline(binding, levers.cash, levers.room, levers.spent)).toBe(`Cash 81 · floor ${floor} · only ${81 - floor} available to buy`)
  })

  it('old money denials do not block a buy the new limits allow: the rule that still refuses it is the reason', () => {
    const S = GUARDRAILS_DOC.since.tick
    const old = (id: number, tick: number) =>
      d({ id, tick, card: 'MAL-10', rarity: 'rare', price: 100, total: 104, value: 113, surplus: 9, guardrail: 'denied: price 104 > max_price_rare 95; cash 107 - 104 < cash_floor 77; spend 83 + 104 > max_spend_per_game_hour 166' })
    const s: StrategySnapshot = {
      ...mock,
      me: mock.me && { ...mock.me, tick: S + 40, cash: 190 },
      spend: { ledgerTick: S + 40, tHours: 8, spent: 80, buys: 2 },
      decisions: [old(3, S - 1), old(2, S - 2), old(1, S - 3)],
    }
    const r = all(s)
    const floor = GUARDRAILS_DOC.cashFloor
    expect(r.levers).toMatchObject({ cash: 190, floor, room: Math.min(190 - floor, GUARDRAILS_DOC.maxSpendPerHour - 80) })
    expect(r.binding).toMatchObject({ rule: 'max_price', rarity: 'rare', limit: 95, latest: { card: 'MAL-10' } })
    expect(STRATEGY_STRINGS.es.headline(r.binding, 190, r.levers.room, 80)).toBe('Tope rara 95: lo que queremos cuesta más')
    // its row says the same: the money rules it once broke cover it now, and their old numbers are gone
    const row = r.blocked[0]!
    expect(mainNow(row, r.levers)).toMatchObject({ rule: 'max_price', rarity: 'rare' })
    expect(row.rules.filter((x) => x.rule !== 'max_price').map((x) => currentLimit(x, r.levers))).toEqual([null, null])
  })

  it('with cash back the floor no longer binds: cleared, or the rule that does not move with cash; nothing refused, none', () => {
    const rich = { ...mock, me: mock.me && { ...mock.me, cash: 400 } }
    const r = all(rich)
    expect(r.binding).toMatchObject({ rule: 'cleared', latest: { card: 'MAL-10' } }) // its refusals named only the floor
    expect(unblockOf(r.binding, r.blocked, r.levers)).toBeNull()
    expect(STRATEGY_STRINGS.es.headline(r.binding, 400, 150, 0)).toBe('Caja 400: ninguna regla frena una compra ahora')
    const both: StrategySnapshot = {
      ...rich,
      decisions: [d({ id: 9, tick: 629, card: 'LAV-09', rarity: 'rare', total: 120, value: 150, guardrail: 'denied: price 120 > max_price_rare 95; cash 130 - 120 < cash_floor 50' })],
    }
    expect(all(both).binding).toMatchObject({ rule: 'max_price', rarity: 'rare', limit: 95 })
    const capped: StrategySnapshot = {
      ...rich,
      decisions: [d({ id: 9, tick: 629, card: 'LAV-09', rarity: 'rare', total: 120, value: 150, guardrail: 'denied: price 120 > max_price_rare 95' })],
    }
    const c = all(capped)
    expect(c.binding).toMatchObject({ rule: 'max_price', rarity: 'rare', limit: 95 })
    expect(unblockOf(c.binding, c.blocked, c.levers)).toMatchObject({ rule: 'max_price', cards: 1, surplus: 30, cashNeeded: null })
    const none = all({ ...rich, decisions: [] })
    expect(none.binding.rule).toBe('none')
    expect(unblockOf(none.binding, none.blocked, none.levers)).toBeNull()
  })

  it('reads the board against what we lack: held, sets we do not chase, and what we lack on sale', () => {
    const { rules, levers } = all(mock)
    const board = boardOf(mock, rules, levers)
    expect(board).toMatchObject({ total: 11, wanted: 4, missing: [], held: 8, notChased: 3, offAlbum: 0 })
    const rare = { offer: 1, tick: 629, expiresTick: 650, venue: 'rastro', maker: 't05', to: null, asset: 900, card: 'LAV-09', rarity: 'rare', price: 99, ours: false }
    const withRare = { ...mock, asks: [...mock.asks, rare] }
    expect(boardOf(withRare, rules, levers).missing).toEqual([{ card: 'LAV-09', name: null, rarity: 'rare', price: 99, cap: 95, room: 81 - GUARDRAILS_DOC.cashFloor }])
    // addressed to another team: not ours to take
    const addressed = { ...mock, asks: [{ ...rare, to: 't09' }] }
    expect(boardOf(addressed, rules, levers).total).toBe(0)
  })

  it('counts the swaps Jev refused in one line', () => {
    const { win, rules } = all(mock)
    expect(jevVetoOf(win, rules)).toMatchObject({ count: 6, bar: 0.75, give: 'SAL-10', want: 'LAT-07' })
  })
})

describe('why we hold', () => {
  it('keeps one copy of each page card of a boosted or protected set, and says why each spare is or is not on sale', () => {
    const { win } = all(mock)
    const h = holdingsOf(mock, win)
    expect(h.pages.map((p) => [p.set, p.why, p.cards.length])).toEqual([['LAV', 'boost', 8], ['MAL', 'boost', 8], ['SAL', 'boost', 10], ['LAT', 'protected', 2], ['RET', 'protected', 1]])
    expect(h.onSale.map((s) => [s.ref, s.ask, s.value, s.bestOther])).toEqual([['LAT-03', 12, 5, 6], ['SAL-01', 10, 1.3, 9]])
    expect(h.onSale[0]?.makerWhy).toContain('spare: ours + 5')
    const why = Object.fromEntries(h.notListed.map((s) => [s.ref, [s.copies, s.why?.kind]]))
    expect(why['LAT-02']).toEqual([1, 'two_copies']) // its only page copy is kept: every set is protected
    expect(why['SAL-01']).toEqual([1, 'other_copy_on_sale'])
    expect(why['SAL-10']).toEqual([1, 'two_copies'])
    expect(h.copies).toBe(mock.me?.cards.length)
  })

  it('a spare the maker took off sale carries the maker\'s words', () => {
    const s: StrategySnapshot = {
      ...mock,
      me: mock.me && { ...mock.me, cards: [1, 2, 3].map((asset) => ({ ref: 'LAT-05', set: 'LAT', rarity: 'common', asset, value: 2 })) },
      decisions: [d({ id: 1, tick: 620, agent: 'maker', kind: 'cancel_ask', status: 'done', allowed: true, card: 'LAT-05', reason: 'LAT-05 is no longer a sell target' })],
      asks: [],
    }
    expect(holdingsOf(s, s.decisions).notListed[0]?.why).toEqual({ kind: 'maker', reason: 'LAT-05 is no longer a sell target', tick: 620 })
  })

  it('an empty snapshot holds nothing and blocks nothing', () => {
    const r = all(EMPTY_STRATEGY)
    expect(r.blocked).toEqual([])
    expect(holdingsOf(EMPTY_STRATEGY, r.win)).toEqual({ pages: [], onSale: [], notListed: [], copies: 0 })
  })
})

describe('strategyStateOf', () => {
  it('reads the answer, a lock, an off server, and keeps the last snapshot through an error', () => {
    expect(strategyStateOf(401, null, mock).status).toBe('locked')
    expect(strategyStateOf(200, { enabled: false }, mock).status).toBe('off')
    expect(strategyStateOf(502, null, mock)).toEqual({ status: 'error', snapshot: mock })
    const live = strategyStateOf(200, { enabled: true, at: 'x', parts: { me: true }, me: mock.me, spend: null, decisions: [], asks: [], cards: [] }, EMPTY_STRATEGY)
    expect(live.status).toBe('live')
    expect(live.snapshot.parts).toEqual({ me: true, spend: false, decisions: false, asks: false, cards: false })
    expect(live.snapshot.me?.cash).toBe(81)
  })
})
