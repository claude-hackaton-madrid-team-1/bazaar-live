/**
 * Brings /api/history up on the Learn screen's pool: the same read-only role (SHOW_DATABASE_URL), the same
 * single connection (the role's connection limit is 4 and the transcript holds two), the same
 * GAME_VIEW_TOKEN. Without that pool the route answers `enabled: false`; the pool's owner closes it.
 */
import { EMPTY_HISTORY, type HistorySnapshot } from '../../shared/history.ts'
import type { Db } from '../transcript/poller.ts'
import { HistoryPoller } from './poller.ts'

export interface History {
  readonly enabled: () => boolean
  readonly snapshot: () => HistorySnapshot
  readonly token: string | null
  readonly stop: () => void
}

export function startHistory(
  shared: { readonly db: Db | null; readonly token: string | null; readonly secrets: readonly string[] },
  log: (entry: Record<string, unknown>) => void,
): History {
  const { db, token } = shared
  if (db === null) {
    log({ route: 'history', event: 'off', reason: 'no database' })
    return { enabled: () => false, snapshot: () => EMPTY_HISTORY, token, stop: () => undefined }
  }
  const poller = new HistoryPoller({ db, log, secrets: shared.secrets })
  poller.start()
  log({ route: 'history', event: 'on' })
  return { enabled: () => true, snapshot: () => poller.current(), token, stop: () => poller.stop() }
}
