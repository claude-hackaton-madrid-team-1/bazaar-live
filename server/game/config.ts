/**
 * Which game the relay reads, and with which key: the same feature flag as bazaar's config.py, over two
 * hardcoded URLs (a free-form URL is how a real key reaches a wrong host).
 *
 * - `BAZAAR_SIM` unset or 0 → the real game with `BAZAAR_KEY`; a `sim-...` key is refused there.
 * - `BAZAAR_SIM=1` → the simulator with `BAZAAR_SIM_KEY` (default `sim-team1`); only a `sim-...` key goes there,
 *   and the real `BAZAAR_KEY` is not even read.
 *
 * The key never leaves this process: it is not logged, not returned by any route, not sent to the page.
 */

export const REAL_URL = 'https://bazaar.causaprima.ai'
export const SIM_URL = 'https://bazaar-sim-production-1d48.up.railway.app'
export const DEFAULT_SIM_KEY = 'sim-team1'
const SIM_KEY_PREFIX = 'sim-'

export const POLL_MS = { default: 5000, min: 2000, max: 60_000 } as const

export type GameTarget = 'real' | 'simulator'

export type GameConfig =
  | {
      readonly enabled: true
      readonly target: GameTarget
      readonly url: string
      readonly key: string
      /** GAME_VIEW_TOKEN: when set, the stream asks for it (`?token=`). */
      readonly token: string | null
      readonly pollMs: number
    }
  | { readonly enabled: false; readonly reason: string }

const ON = ['1', 'true', 'yes', 'on']

function pollMs(raw: string | undefined): number {
  const n = Number(raw)
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(n)) return POLL_MS.default
  return Math.min(POLL_MS.max, Math.max(POLL_MS.min, Math.round(n)))
}

export function readGameConfig(env: Readonly<Record<string, string | undefined>>): GameConfig {
  const sim = (env.BAZAAR_SIM ?? '').trim().toLowerCase()
  const simulated = ON.includes(sim)
  if (sim !== '' && sim !== '0' && !simulated) return { enabled: false, reason: 'BAZAAR_SIM must be unset, 0 or 1' }
  const token = env.GAME_VIEW_TOKEN?.trim() || null
  if (simulated) {
    const key = env.BAZAAR_SIM_KEY?.trim() || DEFAULT_SIM_KEY
    if (!key.startsWith(SIM_KEY_PREFIX)) return { enabled: false, reason: 'BAZAAR_SIM_KEY must be a sim-... key' }
    return { enabled: true, target: 'simulator', url: SIM_URL, key, token, pollMs: pollMs(env.GAME_POLL_MS) }
  }
  const key = env.BAZAAR_KEY?.trim()
  if (!key) return { enabled: false, reason: 'BAZAAR_KEY is not set' }
  if (key.startsWith(SIM_KEY_PREFIX)) return { enabled: false, reason: 'a sim-... key never reaches the real game: set BAZAAR_SIM=1' }
  return { enabled: true, target: 'real', url: REAL_URL, key, token, pollMs: pollMs(env.GAME_POLL_MS) }
}
