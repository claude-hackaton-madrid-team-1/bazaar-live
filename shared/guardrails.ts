/**
 * The guardrail and strategy values of the bazaar repo, as its docs say them. Our agents publish none of them (their
 * /health and /events leave limits out on purpose, and the database only keeps a denial's text), so this file is the
 * fallback: the server's defaults (server/game/decisions.ts, under the GUARDRAIL_* variables) and the page's, under the
 * newest denial text (src/game/limits.ts). Copied from bazaar origin/main after bazaar#216 (2026-10-03 ~16:35 Madrid):
 *   GUARDRAILS.md  `cash_floor`, `max_spend_per_game_hour`, `max_accepts_per_tick`, `allow_venue_open`,
 *                  `venue_bond_reserve`, `max_price_*`, `protect_page_sets`, `team_threads_enabled`
 *   STRATEGY.md    `sell_min_surplus`, complete_pages / sell_spares
 * When GUARDRAILS.md changes a value, change it here and move `since` to the first tick that runs it: a denial text
 * (`cash 81 - 79 < cash_floor 20`) only overrides these when it is that new.
 */
export const GUARDRAILS_DOC = {
  /**
   * From when these values hold, as a tick of the game day they were set on. bazaar#216 merged at about tick 762; the
   * agents' last denial with the old `cash_floor 50` / `max_spend_per_game_hour 150` is tick 765, the first with
   * `cash_floor 20` tick 773 (decisions.policy_checks).
   */
  since: { day: '2026-10-03', tick: 766 },
  /** Never let a purchase take cash below this (bazaar#216: 50 → 20). */
  cashFloor: 20,
  /** Primas our buys may commit in one game hour, all processes together (bazaar#216: 150 → 250). */
  maxSpendPerHour: 250,
  /** Accepts per tick for the whole team. */
  acceptsPerTick: 1,
  /** The switch that plans our own venue: while it is on and our venue is not open yet, the floor holds the bond too. */
  allowVenueOpen: true,
  /** Bond 250 + opening fee 20, kept on top of `cashFloor` only while `allowVenueOpen` and our venue is not open. */
  venueBondReserve: 270,
  /** Never pay more for a card of this rarity (a sealed pack: `pack`). */
  maxPrice: { common: 12, uncommon: 26, rare: 95, pack: 20 } as Readonly<Record<string, number>>,
  /** Our only copy of a page card of these sets is never sold (the new pages). */
  protectPageSets: ['RET', 'CHA'] as readonly string[],
  /** While team threads are on, the maker never lists a duplicate held in exactly two copies (the swap desk's). */
  teamThreads: true,
  /** The Jev bar for a team swap (`team_swap_jev_min_confidence`). */
  jevBar: 0.75,
  /** STRATEGY.md: a spare is offered at our value + this. */
  sellMinSurplus: 5,
} as const

/** Where the doc values come from, for a tooltip. */
export const GUARDRAILS_DOC_SOURCE = 'bazaar GUARDRAILS.md · bazaar#216 · 2026-10-03'
