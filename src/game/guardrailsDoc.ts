/**
 * The few guardrail and strategy values the Strategy screen cannot read live from our database: a decision's
 * guardrail text names a rule only when it broke it, so a cap no buy has hit yet (a rare's, a pack's) is only in the
 * docs. Copied from the bazaar repo, origin/main 6e94c9c8 (2026-10-03 12:58 +02:00):
 *   GUARDRAILS.md  `cash_floor`, `max_spend_per_game_hour`, `max_price_*`, `protect_page_sets`, `team_threads_enabled`
 *   STRATEGY.md    `sell_min_surplus`, complete_pages / sell_spares
 * Every value the guardrail texts carry (`cash_floor 50`, `max_price_uncommon 26`, ...) overrides these
 * (src/game/views/strategy.ts, `rulesOf`): update this file when GUARDRAILS.md changes a value no denial shows.
 */
export const GUARDRAILS_DOC = {
  /** Never let a purchase take cash below this. */
  cashFloor: 50,
  /** Primas our buys may commit in one game hour, all processes together. */
  maxSpendPerHour: 150,
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
export const GUARDRAILS_DOC_SOURCE = 'bazaar GUARDRAILS.md · 2026-10-03'
