/**
 * Our money limits now (the cash floor, the hourly spend cap, the venue's bond reserve) and what they leave us to
 * spend. No live source carries them: the agents' /health and /events leave limits out, and the database only keeps
 * a denial's text. So the newest evidence wins:
 *
 *   1. a denial text newer than the docs (`cash 73 - 67 < cash_floor 20`, the newest per rule by tick): what the agents run;
 *   2. the server's GUARDRAIL_* variables;
 *   3. GUARDRAILS.md as shared/guardrails.ts copies it.
 *
 * A denial is newer than the docs when its tick is at or past `GUARDRAILS_DOC.since.tick` in the same run; once the
 * game's clock has started again below that tick (a new run), every denial of the new run is. A stale denial (the old
 * `cash_floor 50`) never beats a newer doc value.
 */
import { GUARDRAILS_DOC } from '../../shared/guardrails.ts'
import type { GuardrailLimits, LedgerTick } from '../../shared/decisions.ts'

export type LimitSource = 'denial' | 'env' | 'doc'

export interface Limit {
  readonly value: number
  readonly source: LimitSource
  /** The denial's tick, when one set it. */
  readonly tick: number | null
}

/** A tick this far above now belongs to an earlier run's clock (as in views/strategy.ts). */
export const NEW_RUN = 100

/** What a denial text says of the money rules: `cash_floor 20 + venue_bond_reserve 270`, `max_spend_per_game_hour 250`. */
export interface MoneyText {
  readonly cashFloor: number | null
  /** The reserve the floor held at that tick: 0 when the text names the floor alone, null when it names no floor. */
  readonly bondReserve: number | null
  readonly maxSpend: number | null
}

export function moneyTextOf(text: string | null | undefined): MoneyText {
  const floor = text ? /cash_floor (\d+)(?: \+ venue_bond_reserve (\d+))?/.exec(text) : null
  const spend = text ? /max_spend_per_game_hour (\d+)/.exec(text) : null
  return {
    cashFloor: floor ? Number(floor[1]) : null,
    bondReserve: floor ? Number(floor[2] ?? 0) : null,
    maxSpend: spend ? Number(spend[1]) : null,
  }
}

/** Is a denial at `tick` newer than the docs, with the clock at `now`? */
export function newerThanDocs(tick: number, now: number, since: { readonly tick: number } = GUARDRAILS_DOC.since): boolean {
  if (tick > now + NEW_RUN) return false // an earlier run's clock
  if (now < since.tick) return true // the clock started again since the docs: this run is newer
  return tick >= since.tick
}

export interface MoneyRules {
  readonly cashFloor: Limit
  readonly maxSpend: Limit
  /** `venue_bond_reserve`, whether it applies or not (see `moneyOf`). */
  readonly bondReserve: Limit
  /** The newest fresh cash_floor denial held the reserve (true), did not (false), or there is none (null). */
  readonly reserveHeld: boolean | null
}

const doc = (value: number): Limit => ({ value, source: 'doc', tick: null })

/** The server's value: its variable when one set it, else the docs' (the server's default is the docs too). */
function serverLimit(server: GuardrailLimits | null | undefined, key: 'cashFloor' | 'spendPerHour', fallback: number): Limit {
  if (!server) return doc(fallback)
  return { value: server[key], source: server.fromEnv?.includes(key) ? 'env' : 'doc', tick: null }
}

/**
 * The money limits now. `denials`: any order (the newest per rule by tick wins); `now`: the clock's tick; `server`:
 * the limits the server sent (GUARDRAIL_* else the docs), or null.
 */
export function moneyRulesOf(denials: Iterable<{ readonly tick: number; readonly text: string | null }>, now: number, server?: GuardrailLimits | null): MoneyRules {
  let floor: { tick: number; value: number; reserve: number } | null = null
  let spend: { tick: number; value: number } | null = null
  for (const d of denials) {
    if (!d.text || !newerThanDocs(d.tick, now)) continue
    const m = moneyTextOf(d.text)
    if (m.cashFloor !== null && (!floor || d.tick >= floor.tick)) floor = { tick: d.tick, value: m.cashFloor, reserve: m.bondReserve ?? 0 }
    if (m.maxSpend !== null && (!spend || d.tick >= spend.tick)) spend = { tick: d.tick, value: m.maxSpend }
  }
  const reserveDoc = server?.bondReserve ?? (GUARDRAILS_DOC.allowVenueOpen ? GUARDRAILS_DOC.venueBondReserve : 0)
  return {
    cashFloor: floor ? { value: floor.value, source: 'denial', tick: floor.tick } : serverLimit(server, 'cashFloor', GUARDRAILS_DOC.cashFloor),
    maxSpend: spend ? { value: spend.value, source: 'denial', tick: spend.tick } : serverLimit(server, 'spendPerHour', GUARDRAILS_DOC.maxSpendPerHour),
    bondReserve: floor && floor.reserve > 0 ? { value: floor.reserve, source: 'denial', tick: floor.tick } : doc(reserveDoc),
    reserveHeld: floor ? floor.reserve > 0 : null,
  }
}

export type MoneyRule = 'cash_floor' | 'max_spend_per_game_hour'

/** What we can spend now, and which limit stops us first. */
export interface Money {
  readonly cash: number | null
  /** The floor a buy keeps: `cash_floor`, plus the bond reserve only while it applies. */
  readonly floor: number
  readonly cashFloor: Limit
  /** The bond reserve on top of the floor, or null when it does not apply. */
  readonly reserve: number | null
  /** Cash above the floor (never below 0). */
  readonly cashRoom: number | null
  readonly spent: number | null
  readonly maxSpend: Limit
  /** What the hour's cap still allows (never below 0). */
  readonly spendRoom: number | null
  /** The smaller room: what the next buy may cost. */
  readonly available: number | null
  /** The limit that leaves the smaller room (the floor on a tie), or null without both numbers. */
  readonly binds: MoneyRule | null
}

/**
 * Cash against the floor and the hour's spend against its cap. The bond reserve applies only while a venue is planned
 * (`allow_venue_open`) and ours is not open yet: `venue` says whether we run one (null: unknown, then the newest fresh
 * denial says whether the floor held it; with neither, it is left out).
 */
export function moneyOf(cash: number | null, spent: number | null, rules: MoneyRules, venue: boolean | null): Money {
  const planned = rules.bondReserve.value > 0
  const applies = planned && (venue !== null ? !venue : rules.reserveHeld === true)
  const reserve = applies ? rules.bondReserve.value : null
  const floor = rules.cashFloor.value + (reserve ?? 0)
  const cashRoom = cash === null ? null : Math.max(0, cash - floor)
  const spendRoom = spent === null ? null : Math.max(0, rules.maxSpend.value - spent)
  const binds: MoneyRule | null = cashRoom !== null && spendRoom !== null ? (cashRoom <= spendRoom ? 'cash_floor' : 'max_spend_per_game_hour') : cashRoom !== null ? 'cash_floor' : spendRoom !== null ? 'max_spend_per_game_hour' : null
  const rooms = [cashRoom, spendRoom].filter((v): v is number => v !== null)
  return { cash, floor, cashFloor: rules.cashFloor, reserve, cashRoom, spent, maxSpend: rules.maxSpend, spendRoom, available: rooms.length ? Math.min(...rooms) : null, binds }
}

/** The hour's window rolls: the oldest spend in it leaves one game hour after it was made, and frees its amount. */
export interface Release {
  readonly amount: number
  /** Game ticks until it leaves the window, when the ledger shows its pace (two ticks at least). */
  readonly ticks: number | null
  /** The same in real seconds, when the tick's length is known. */
  readonly seconds: number | null
}

/** Game hours per tick as the ledger's own rows show them (first to last), or null with fewer than two. */
export function paceOf(ticks: readonly LedgerTick[]): number | null {
  const first = ticks[0]
  const last = ticks.at(-1)
  return first && last && last.tick > first.tick && last.t > first.t ? (last.t - first.t) / (last.tick - first.tick) : null
}

/**
 * The next spend to leave the hour's window (guardrails.context_from sums the spend rows with `t_hours` past now − 1),
 * from the ledger's ticks (oldest first), the game hour now and the game hours a tick lasts (`pace`).
 */
export function releaseOf(ticks: readonly LedgerTick[], nowT: number, pace: number | null, tickSeconds: number | null): Release | null {
  const next = ticks.find((t) => t.t > nowT - 1 && t.spent > 0)
  if (!next) return null
  const leftHours = Math.max(0, next.t + 1 - nowT)
  const left = pace ? Math.max(1, Math.ceil(leftHours / pace - 1e-9)) : null
  return { amount: next.spent, ticks: left, seconds: left !== null && tickSeconds ? left * tickSeconds : null }
}
