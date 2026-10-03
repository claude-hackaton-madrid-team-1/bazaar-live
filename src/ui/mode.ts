import type { AgentHealth } from '../model/events'
import type { FeedStatus } from '../net/feed'

export type Mode = 'live' | 'dry' | 'offline'

/** LIVE or DRY RUN comes from the agent's own /health, never guessed. */
export function modeOf(health: AgentHealth | null, feed: FeedStatus): Mode {
  if (!health || !health.ok) return 'offline'
  if (health.mode === 'live') return 'live'
  if (health.mode === 'dry') return 'dry'
  return feed === 'open' ? 'dry' : 'offline'
}
