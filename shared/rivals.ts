/**
 * The wire type of GET /api/rivals: what the Rivals screen reads of db/rival_albums.sql, as the server last read it.
 * Every field is checked on the server (server/rivals/rows.ts). Public game facts only (the feed, the leaderboard),
 * never a value of ours; the route still sits behind GAME_VIEW_TOKEN like every game screen.
 */

/** How we know a holder has a card: a settlement moved a copy to it, a pack showed it, a gift or a craft named it, or it listed one. */
export type HowKnown = 'bought' | 'pack' | 'gift' | 'crafted' | 'listed'

export const HOW_KNOWN: readonly HowKnown[] = ['bought', 'pack', 'gift', 'crafted', 'listed']

/** A card a holder (a team, `t05`, or a dealer, `chato`) holds as far as the public feed shows. */
export interface RivalCard {
  readonly holder: string
  readonly card: string
  readonly set: string | null
  readonly rarity: string | null
  readonly name: string | null
  /** The copies we know of (at least 1). */
  readonly copies: number
  /** How we learned of the copy held longest. */
  readonly how: HowKnown
  /** The tick since which it holds the copy held longest. */
  readonly since: number
  /** The tick of the latest public event that showed it there. */
  readonly seen: number
}

/** A team's latest leaderboard read, and the set interest read off its public moves. */
export interface RivalTeam {
  readonly team: string
  readonly rank: number
  readonly score: number
  readonly level: number | null
  /** Complete album pages, by the leaderboard. */
  readonly pages: number | null
  readonly deals: number | null
  readonly tick: number | null
  /** Set → +1 per buy, bid or dealer ask in it, -1 per sale or listing: the top one hints at its ×1.6 set. */
  readonly interest: Readonly<Record<string, number>>
}

/** A team chasing a card: bids on a board, or asks to a dealer. */
export interface RivalWant {
  readonly team: string
  readonly card: string
  readonly via: 'bid' | 'dealer'
  readonly times: number
  readonly last: number
  /** Its best cash bid, for a board bid. */
  readonly topBid: number | null
}

/** Which views answered on the last poll (a view the admin has not applied yet is `false`). */
export interface RivalsParts {
  readonly holdings: boolean
  readonly teams: boolean
  readonly wants: boolean
  readonly head: boolean
}

export interface RivalsSnapshot {
  /** When the server last read the database; null before the first good read. */
  readonly at: string | null
  readonly parts: RivalsParts
  /** The newest feed tick: "X min ago" is counted from it. */
  readonly tick: number | null
  readonly holdings: readonly RivalCard[]
  readonly teams: readonly RivalTeam[]
  readonly wants: readonly RivalWant[]
}

export const EMPTY_RIVALS: RivalsSnapshot = {
  at: null,
  parts: { holdings: false, teams: false, wants: false, head: false },
  tick: null,
  holdings: [],
  teams: [],
  wants: [],
}
