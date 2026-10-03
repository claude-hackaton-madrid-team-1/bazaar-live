/**
 * Brings /api/injections up on the server's one shared pool (SHOW_DATABASE_URL, the read-only role): no connection
 * of its own. Without the pool the route answers `enabled: false` and everything else runs as before.
 */
import { EMPTY_INJECTIONS, type InjectionsSnapshot } from '../../shared/injections.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { InjectionsPoller } from './poller.ts'

export interface Injections {
  readonly enabled: () => boolean
  readonly snapshot: () => InjectionsSnapshot
  readonly stop: () => void
}

export const INJECTIONS_OFF: Injections = { enabled: () => false, snapshot: () => EMPTY_INJECTIONS, stop: () => undefined }

export function startInjections(log: (entry: Record<string, unknown>) => void, shared: SharedShowPool | null): Injections {
  if (!shared) {
    log({ route: 'injections', event: 'off', reason: 'no SHOW_DATABASE_URL' })
    return INJECTIONS_OFF
  }
  const poller = new InjectionsPoller({ db: shared.pool, log, secrets: shared.secrets })
  poller.start()
  log({ route: 'injections', event: 'on' })
  return { enabled: () => true, snapshot: () => poller.current(), stop: () => poller.stop() }
}
