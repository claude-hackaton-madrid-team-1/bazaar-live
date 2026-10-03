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

export type Target = 'real' | 'simulator'
export type Targets = Readonly<Record<AgentId, Target | null>>

/** The target each agent last reported: it is fixed per deploy, so a failed poll must not forget it. */
export function rememberTargets(known: Targets, health: Readonly<Record<AgentId, AgentHealth | null>>): Targets {
  const next = (agent: AgentId): Target | null => (health[agent]?.ok && health[agent]?.target ? (health[agent]?.target ?? null) : known[agent])
  const targets: Targets = { taker: next('taker'), maker: next('maker') }
  return targets.taker === known.taker && targets.maker === known.maker ? known : targets
}

/**
 * REAL GAME or SIMULATOR comes from the agents' own /health (`target.mode`), never guessed: both real is
 * `real`, both simulator is `simulator`, one of each is `mixed`, and nothing known yet is `unknown`.
 * The recorded mock (`?mock=1`) is always labelled as such.
 */
export function worldOf(targets: Targets, mock: boolean): World {
  if (mock) return 'mock'
  const known = [targets.taker, targets.maker].filter((t): t is Target => t !== null)
  if (known.length === 0) return 'unknown'
  if (known.every((t) => t === 'real')) return 'real'
  if (known.every((t) => t === 'simulator')) return 'simulator'
  return 'mixed'
}
