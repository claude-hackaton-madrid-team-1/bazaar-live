/**
 * The Negotiations screen split by dealer: per counterparty, its live threads, its ended ones, and what answers "how
 * is it going with them, and what should we do": our edge, the deals, the tactics that closed, how they move and how
 * long since we last spoke.
 */
import type { State } from '../state.ts'
import { dealerTactics, negRows, type NegRow, type TacticTally } from './negotiations.ts'

export type DealerGroup = {
  readonly with: string
  /** Newest first, as `negRows` orders them. */
  readonly live: NegRow[]
  /** By last activity, newest first. */
  readonly ended: NegRow[]
  readonly threads: number
  readonly deals: number
  /** What our deals with them made against our value, summed; null without a measured deal. */
  readonly edge: number | null
  /** Their average move per round towards us over every thread (first price to last); null with no thread of two prices. */
  readonly step: number | null
  /** Ended threads where their last offer was a final one, out of the ended threads where they made one. */
  readonly finals: { readonly n: number; readonly of: number }
  /** The tick of the last offer with them, either side. */
  readonly lastTick: number | null
  /** The tactics of our ended threads with them, the ones that closed a deal first. */
  readonly tactics: TacticTally[]
}

const round1 = (v: number): number => Math.round(v * 10) / 10

function group(s: State, who: string, rows: NegRow[], tactics: TacticTally[]): DealerGroup {
  const ended = rows.filter((r) => r.status !== 'open')
  const deals = ended.filter((r) => r.ended?.how === 'deal')
  const edges = deals.flatMap((r) => (r.ended?.edge != null ? [r.ended.edge] : []))
  // buying, their ask comes down; selling, their bid goes up: positive is towards us either way
  const steps = rows.flatMap((r) => {
    const p = r.trend.theirs
    if (p.length < 2) return []
    return [(((p.at(-1) as number) - (p[0] as number)) * (r.side === 'buy' ? -1 : 1)) / (p.length - 1)]
  })
  const theirLast = ended.flatMap((r) => {
    const o = s.threads[r.id]?.offers.filter((x) => x.side === 'them').at(-1)
    return o ? [o.final] : []
  })
  const ticks = rows.flatMap((r) => (r.lastTick != null ? [r.lastTick] : []))
  return {
    with: who,
    live: rows.filter((r) => r.status === 'open'),
    ended,
    threads: rows.length,
    deals: deals.length,
    edge: edges.length ? round1(edges.reduce((a, b) => a + b, 0)) : null,
    step: steps.length ? round1(steps.reduce((a, b) => a + b, 0) / steps.length) : null,
    finals: { n: theirLast.filter(Boolean).length, of: theirLast.length },
    lastTick: ticks.length ? Math.max(...ticks) : null,
    tactics,
  }
}

/**
 * One group per counterparty with threads, most threads first then by name: an order that holds while the game runs, so
 * a dealer's chip does not jump on every message.
 */
export function dealerGroups(s: State, rows: readonly NegRow[] = negRows(s)): DealerGroup[] {
  const by = new Map<string, NegRow[]>()
  for (const r of rows) by.set(r.with, [...(by.get(r.with) ?? []), r])
  const tactics = new Map(dealerTactics(s, rows).map((d) => [d.with, d.tactics]))
  return [...by]
    .map(([who, list]) => group(s, who, list, tactics.get(who) ?? []))
    .sort((a, b) => b.threads - a.threads || a.with.localeCompare(b.with))
}

/** The dealer a `?dealer=` names (`Pilar` as `pilar`), or null (every dealer) when it names none with threads. */
export const dealerOf = (groups: readonly DealerGroup[], requested: string | null): DealerGroup | null =>
  groups.find((g) => g.with.toLowerCase() === requested?.trim().toLowerCase()) ?? null

/** The thread to read: the requested one when it is among these rows, else the first of them. */
export function selectedIn(rows: readonly NegRow[], requested: string | null): number | null {
  const n = requested ? Number(requested) : NaN
  return rows.find((r) => r.id === n)?.id ?? rows[0]?.id ?? null
}
