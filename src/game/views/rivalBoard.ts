/**
 * The rival board's view model (the private part of the Rivals screen), pure: a team's suggested move as a typed
 * shape that the words (../rivalBoardStrings.ts) turn into a sentence in the page's language, and the lookups the
 * standings and the team panel need. The view's own English sentence (`suggestedMove`) is never the screen's text:
 * the move is rebuilt from its fields.
 */
import type { BoardRow, GuardReason, MoveKind } from '../../../shared/rivalBoard.ts'

/** A trade the board suggests; `guard` says the team is guarded and the trade passed the twice-their-gain rule. */
interface Trade {
  readonly ourGain: number | null
  readonly theirGain: number | null
  readonly guard: GuardReason | null
}

export type MoveView =
  | (Trade & { readonly kind: 'swap'; readonly give: string; readonly get: string })
  | (Trade & { readonly kind: 'sell'; readonly give: string; readonly price: number | null })
  | (Trade & { readonly kind: 'buy'; readonly get: string; readonly price: number | null })
  | { readonly kind: 'hold'; readonly reason: GuardReason | null; readonly rank: number; readonly ourRank: number | null }
  | { readonly kind: 'watch' }

/**
 * The move, from the row's fields. A trade missing the card it needs (an odd row) reads as watch: the screen never
 * says "offer — for —".
 */
export function moveOf(row: BoardRow): MoveView {
  const trade: Trade = { ourGain: row.ourGain, theirGain: row.theirGain, guard: row.guarded ? row.guardReason : null }
  switch (row.moveKind) {
    case 'swap':
      return row.moveGive && row.moveGet ? { ...trade, kind: 'swap', give: row.moveGive, get: row.moveGet } : { kind: 'watch' }
    case 'sell':
      return row.moveGive ? { ...trade, kind: 'sell', give: row.moveGive, price: row.movePrice } : { kind: 'watch' }
    case 'buy':
      return row.moveGet ? { ...trade, kind: 'buy', get: row.moveGet, price: row.movePrice } : { kind: 'watch' }
    case 'hold':
      return { kind: 'hold', reason: row.guardReason, rank: row.rank, ourRank: row.ourRank }
    case 'watch':
      return { kind: 'watch' }
  }
}

export const isTrade = (kind: MoveKind): boolean => kind === 'swap' || kind === 'sell' || kind === 'buy'

/** The badge tone of a move: a trade is good news, a hold a warning, watch nothing to do. */
export const moveTone = (kind: MoveKind): 'good' | 'warn' | 'neutral' => (isTrade(kind) ? 'good' : kind === 'hold' ? 'warn' : 'neutral')

/** The board's row of one team, or null (no board yet, or a team the board does not list, as ourselves). */
export const boardOfTeam = (rows: readonly BoardRow[], team: string | null): BoardRow | null =>
  team === null ? null : (rows.find((r) => r.team === team) ?? null)

/** Set interest, strongest first, positive (they buy it) before negative (they sell it). */
export function interestsOf(row: BoardRow): { readonly set: string; readonly interest: number }[] {
  return Object.entries(row.setInterest)
    .map(([set, interest]) => ({ set, interest }))
    .sort((a, b) => b.interest - a.interest || a.set.localeCompare(b.set))
}

/** Rank over the trend window, oldest point first and newest last; null without two points. */
export function rankTrend(row: BoardRow): { readonly from: number; readonly to: number } | null {
  const first = row.trend[0]
  const last = row.trend[row.trend.length - 1]
  return first && last && row.trend.length > 1 ? { from: first.rank, to: last.rank } : null
}
