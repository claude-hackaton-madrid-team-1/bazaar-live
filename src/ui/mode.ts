import type { AgentHealth, AgentId } from '../model/events'
import type { FeedStatus } from '../net/feed'

export type Mode = 'live' | 'dry' | 'offline'

/** LIVE or DRY RUN comes from the agent's own /health, never guessed. */
export function modeOf(health: AgentHealth | null, feed: FeedStatus): Mode {
  if (!health || !health.ok) return 'offline'
  if (health.mode === 'live') return 'live'
  if (health.mode === 'dry') return 'dry'
  return feed === 'open' ? 'dry' : 'offline'
}

/** Which game the agents are playing in, as the page labels it. */
export type World = 'real' | 'simulator' | 'mixed' | 'mock' | 'unknown'

/**
 * REAL GAME or SIMULATOR comes from the agents' own /health (`target.mode`), never guessed: both real is
 * `real`, both simulator is `simulator`, one of each is `mixed`, and nothing known yet is `unknown`.
 * The recorded mock (`?mock=1`) is always labelled as such.
 */
export function worldOf(health: Readonly<Record<AgentId, AgentHealth | null>>, mock: boolean): World {
  if (mock) return 'mock'
  const targets = [health.taker, health.maker].flatMap((h) => (h?.ok && h.target ? [h.target] : []))
  if (targets.length === 0) return 'unknown'
  if (targets.every((t) => t === 'real')) return 'real'
  if (targets.every((t) => t === 'simulator')) return 'simulator'
  return 'mixed'
}
