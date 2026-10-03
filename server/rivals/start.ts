/**
 * Brings /api/rivals up on the server's one shared pool (`startShowPool`, SHOW_DATABASE_URL): the same
 * read-only role and the same connections as the transcript, /api/learn, /api/history, /api/strategy, the decisions
 * poller and the game screens, so no new connection (the role's connection limit is 4), and the game screens' GAME_VIEW_TOKEN.
 * Without that pool the route answers `enabled: false`; the pool's owner (server/index.ts) closes it.
 */
import { EMPTY_RIVALS, type RivalsSnapshot } from '../../shared/rivals.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { RivalsPoller } from './poller.ts'

export interface Rivals {
  readonly enabled: () => boolean
  readonly snapshot: () => RivalsSnapshot
  readonly token: string | null
  /** The poller, to wake it and hear when its rows change (server/game/pages.ts); null while off. */
  readonly poller: RivalsPoller | null
  readonly stop: () => void
}

/** `shared`: the server's one pool, never ended here; null or absent → off (no pool of its own). */
export function startRivals(
  env: Readonly<Record<string, string | undefined>>,
  log: (entry: Record<string, unknown>) => void,
  shared?: SharedShowPool | null,
): Rivals {
  const token = env.GAME_VIEW_TOKEN?.trim() || null
  if (!shared) {
    log({ route: 'rivals', event: 'off', reason: 'no database' })
    return { enabled: () => false, snapshot: () => EMPTY_RIVALS, token, poller: null, stop: () => undefined }
  }
  const poller = new RivalsPoller({ db: shared.pool, log, secrets: shared.secrets })
  poller.start()
  log({ route: 'rivals', event: 'on' })
  return { enabled: () => true, snapshot: () => poller.current(), token, poller, stop: () => poller.stop() }
}
