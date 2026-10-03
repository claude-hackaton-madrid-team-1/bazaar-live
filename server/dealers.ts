/**
 * GET /api/dealers → `{names: {id: name}}`: the display name of every dealer the game lists, so the
 * captions can name a dealer that arrives later (L4, L5) by its persona name instead of a voice slot.
 *
 * Read from the game's public `GET /api/dealers` with NO key (it is a keyless read, so it never spends
 * our team key's rate budget), at most once per TTL however many pages ask; a failed read keeps the last
 * good list. Only ids and names that pass the closed patterns leave this module.
 */
import { cleanName } from '../shared/clean.ts'
import { REAL_URL, SIM_URL } from './game/config.ts'

const TTL_MS = 5 * 60_000
const RETRY_MS = 30_000
const TIMEOUT_MS = 4000
const MAX_DEALERS = 20
const ID = /^[a-z][a-z0-9_-]{0,39}$/

/** The game the dealers are read from: the simulator with BAZAAR_SIM=1, else the real game (never a free-form URL). */
export function dealersUrl(env: Readonly<Record<string, string | undefined>>): string {
  return ['1', 'true', 'yes', 'on'].includes((env.BAZAAR_SIM ?? '').trim().toLowerCase()) ? SIM_URL : REAL_URL
}

export type DealerNames = Readonly<Record<string, string>>

/** The id → name map from a `/api/dealers` body (`{personas: [{id, name}]}`); anything else is dropped. */
export function parseDealerNames(body: unknown): DealerNames {
  const personas = typeof body === 'object' && body !== null ? (body as { personas?: unknown }).personas : null
  if (!Array.isArray(personas)) return {}
  const out: Record<string, string> = {}
  for (const p of personas) {
    if (Object.keys(out).length >= MAX_DEALERS) break
    if (typeof p !== 'object' || p === null) continue
    const { id, name } = p as { id?: unknown; name?: unknown }
    const key = typeof id === 'string' ? id.trim().toLowerCase() : ''
    const clean = cleanName(name)
    if (ID.test(key) && clean) out[key] = clean
  }
  return out
}

export interface DealerNamesDeps {
  /** The game's base URL (the real game or the simulator, by BAZAAR_SIM). */
  readonly url: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
}

/** A cached reader: returns the last good list at once and refreshes it in the background when it is old. */
export function createDealerNames(deps: DealerNamesDeps): () => Promise<DealerNames> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  let names: DealerNames = {}
  let nextAt = 0
  let pending: Promise<void> | null = null

  async function refresh(): Promise<void> {
    try {
      const res = await fetchImpl(`${deps.url}/api/dealers`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) throw new Error(`dealers answered ${res.status}`)
      const parsed = parseDealerNames(await res.json())
      if (Object.keys(parsed).length > 0) names = parsed
      nextAt = now() + TTL_MS
    } catch {
      nextAt = now() + RETRY_MS
    }
  }

  return async () => {
    if (now() >= nextAt && !pending) {
      pending = refresh().finally(() => {
        pending = null
      })
    }
    // The first read waits for the list; later ones answer from the cache while it refreshes.
    if (Object.keys(names).length === 0 && pending) await pending
    return names
  }
}
