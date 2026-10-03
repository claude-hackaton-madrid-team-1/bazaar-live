/**
 * Brings /api/strategy up on the server's one shared pool (`startShowPool`, SHOW_DATABASE_URL): the same
 * read-only role and the same connections as the transcript, /api/learn, /api/history, the decisions poller and
 * the game screens, so no new connection (the role's connection limit is 4), and the game screens' GAME_VIEW_TOKEN.
 * Without that pool the route answers `enabled: false`; the pool's owner (server/index.ts) closes it.
 */
import { EMPTY_STRATEGY, type StrategySnapshot } from '../../shared/strategy.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { StrategyPoller } from './poller.ts'

export interface Strategy {
  readonly enabled: () => boolean
  readonly snapshot: () => StrategySnapshot
  readonly token: string | null
  readonly stop: () => void
}

/** `shared`: the server's one pool, never ended here; null or absent → off (no pool of its own). */
export function startStrategy(
  env: Readonly<Record<string, string | undefined>>,
  log: (entry: Record<string, unknown>) => void,
  shared?: SharedShowPool | null,
): Strategy {
  const token = env.GAME_VIEW_TOKEN?.trim() || null
  if (!shared) {
    log({ route: 'strategy', event: 'off', reason: 'no database' })
    return { enabled: () => false, snapshot: () => EMPTY_STRATEGY, token, stop: () => undefined }
  }
  const poller = new StrategyPoller({ db: shared.pool, log, secrets: shared.secrets })
  poller.start()
  log({ route: 'strategy', event: 'on' })
  return { enabled: () => true, snapshot: () => poller.current(), token, stop: () => poller.stop() }
}
