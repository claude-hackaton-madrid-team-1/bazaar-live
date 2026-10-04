/**
 * The guardrail and strategy values of the bazaar repo, as its docs say them. Our agents publish none of them (their
 * /health and /events leave limits out on purpose, and the database only keeps a denial's text), so this file is the
 * fallback: the server's defaults (server/game/decisions.ts, under the GUARDRAIL_* variables) and the page's, under the
 * newest denial text (src/game/limits.ts). Snapshot refreshed after AT1 / bazaar#281 (2026-10-04):
 * hourly cap disabled; cash floor, price caps and page protections unchanged.
 *   GUARDRAILS.md  `cash_floor`, `max_spend_per_game_hour`, `max_accepts_per_tick`, `allow_venue_open`,
 *                  `venue_bond_reserve`, `max_price_*`, `protect_page_sets`, `team_threads_enabled`
 *   STRATEGY.md    `sell_min_surplus`, complete_pages / sell_spares
 * When GUARDRAILS.md changes a value, change it here and move `since` to the first tick that runs it: a denial text
 * (`cash 81 - 79 < cash_floor 20`) only overrides these when it is that new.
 */
// Snapshot refreshed for AT1 (bazaar#281): hourly cap disabled, other listed values unchanged.
export const GUARDRAILS_DOC = {
  /** First observed ticks running AT1; older denial text must not restore its removed hourly cap. */
  since: { day: '2026-10-04', tick: 1670 },
  /** Never let a purchase take cash below this (bazaar#216: 50 → 20; bazaar#219: 20 → 5). */
  cashFloor: 5,
  /** Zero disables the hourly cap (AT1 / bazaar#281, active by tick 1670); cash/value guards remain. */
  maxSpendPerHour: 0,
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
export const GUARDRAILS_DOC_SOURCE = 'bazaar GUARDRAILS.md · bazaar#281 · 2026-10-04'
