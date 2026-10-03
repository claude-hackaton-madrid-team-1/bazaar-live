/**
 * The guardrail and strategy values of the bazaar repo, as its docs say them. Our agents publish none of them (their
 * /health and /events leave limits out on purpose, and the database only keeps a denial's text), so this file is the
 * fallback: the server's defaults (server/game/decisions.ts, under the GUARDRAIL_* variables) and the page's, under the
 * newest denial text (src/game/limits.ts). Copied from bazaar origin/main after bazaar#216 (2026-10-03 ~16:35 Madrid:
 * floor 50 → 20, hourly cap 150 → 250), bazaar#219 (ee19c617, ~17:20 Madrid, tick 838: floor 20 → 5) and d3a59037
 * (~18:14 Madrid: `protect_page_sets` RET,CHA → every set, after SAL-07, Salamanca's only copy, sold at tick 947):
 *   GUARDRAILS.md  `cash_floor`, `max_spend_per_game_hour`, `max_accepts_per_tick`, `allow_venue_open`,
 *                  `venue_bond_reserve`, `max_price_*`, `protect_page_sets`, `team_threads_enabled`
 *   STRATEGY.md    `sell_min_surplus`, complete_pages / sell_spares
 * When GUARDRAILS.md changes a value, change it here and move `since` to the first tick that runs it: a denial text
 * (`cash 81 - 79 < cash_floor 20`) only overrides these when it is that new.
 */
export const GUARDRAILS_DOC = {
  /**
   * From when the values a denial can name (the floor, the hour's cap, the price caps) hold: `tick` is what src/game/limits.ts compares a denial's tick with; `day` only says which
   * game day that tick belongs to (no code reads it). bazaar#219 set the floor at tick 838: the agents' last denial with
   * `cash_floor 20` is tick 813, the first with `cash_floor 5` tick 858. (bazaar#216 before it: the last denial with
   * `cash_floor 50` / `max_spend_per_game_hour 150` is tick 765, the first with `cash_floor 20` tick 773.)
   */
  since: { day: '2026-10-03', tick: 839 },
  /** Never let a purchase take cash below this (bazaar#216: 50 → 20; bazaar#219: 20 → 5). */
  cashFloor: 5,
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
  /** Our only copy of a page card of these sets is never sold: every set since d3a59037 (was RET,CHA, the new pages). */
  protectPageSets: ['LAV', 'SAL', 'MAL', 'RET', 'LAT', 'CHA'] as readonly string[],
  /** While team threads are on, the maker never lists a duplicate held in exactly two copies (the swap desk's). */
  teamThreads: true,
  /** The Jev bar for a team swap (`team_swap_jev_min_confidence`). */
  jevBar: 0.75,
  /** STRATEGY.md: a spare is offered at our value + this. */
  sellMinSurplus: 5,
} as const

/** Where the doc values come from, for a tooltip. */
export const GUARDRAILS_DOC_SOURCE = 'bazaar GUARDRAILS.md · bazaar#216, #219, d3a59037 · 2026-10-03'
