/**
 * What of `/api/me` reaches the page: only the fields the game screens read (`src/game/state.ts` `me()`,
 * `views/album.ts` `scoreBars`, `views/debug.ts` `summarize`), copied by name. Everything else stays here:
 * `affinity` and `collection_value` (our private set multipliers and what they price our hand at),
 * `starter_broker_key` and any other key, `luck_private`, open threads, badges, level, venue.
 */
export type Payload = Record<string, unknown>

const isRecord = (v: unknown): v is Payload => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The keys of `from` that are in `keys` and set, in the order of `keys`. */
function pick(from: Payload, keys: readonly string[]): Payload {
  const out: Payload = {}
  for (const k of keys) if (from[k] !== undefined) out[k] = from[k]
  return out
}

const TOP = ['id', 'name', 'cash'] as const

/** The header's score and rank, the album's bars and deal count. */
const SCORE = ['score', 'rank', 'deals', 'duel_points', 'ladder_points', 'neg_points', 'mm_points'] as const

const PAGE = ['set', 'name', 'have', 'of', 'complete', 'master'] as const

// `your_value` kept on purpose (behind GAME_VIEW_TOKEN): it is the gain of our settlements on /agent and our value on /album.
const ASSET = ['id', 'kind', 'ref', 'serial', 'your_value'] as const

/** The allow-listed copy of a `/me` body. */
export function projectMe(me: Payload): Payload {
  const out = pick(me, TOP)
  if (isRecord(me.score)) out.score = pick(me.score, SCORE)
  if (isRecord(me.album) && Array.isArray(me.album.pages)) out.album = { pages: me.album.pages.filter(isRecord).map((p) => pick(p, PAGE)) }
  if (Array.isArray(me.assets)) out.assets = me.assets.filter(isRecord).map((a) => pick(a, ASSET))
  return out
}
