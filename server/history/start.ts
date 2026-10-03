/**
 * Brings /api/history up on the server's one shared pool (`startShowPool`, SHOW_DATABASE_URL): the same
 * read-only role and the same connections as the transcript, /api/learn, the decisions poller and the game
 * screens, so no new connection (the role's connection limit is 4), and the game screens' GAME_VIEW_TOKEN.
 * Without that pool the route answers `enabled: false`; the pool's owner (server/index.ts) closes it.
 */
import { EMPTY_HISTORY, type HistorySnapshot } from '../../shared/history.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { HistoryPoller } from './poller.ts'

export interface History {
  readonly enabled: () => boolean
  readonly snapshot: () => HistorySnapshot
  readonly token: string | null
  readonly stop: () => void
}

/** `shared`: the server's one pool, never ended here; null or absent → off (no pool of its own). */
export function startHistory(
  env: Readonly<Record<string, string | undefined>>,
  log: (entry: Record<string, unknown>) => void,
  shared?: SharedShowPool | null,
): History {
  const token = env.GAME_VIEW_TOKEN?.trim() || null
  if (!shared) {
    log({ route: 'history', event: 'off', reason: 'no database' })
    return { enabled: () => false, snapshot: () => EMPTY_HISTORY, token, stop: () => undefined }
  }
  const poller = new HistoryPoller({ db: shared.pool, log, secrets: shared.secrets })
  poller.start()
  log({ route: 'history', event: 'on' })
  return { enabled: () => true, snapshot: () => poller.current(), token, stop: () => poller.stop() }
}
