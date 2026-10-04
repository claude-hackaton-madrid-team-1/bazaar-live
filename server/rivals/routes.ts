/**
 * GET /api/rivals  JSON: what each rival holds by the public feed, where it ranks and what it chases
 *                  (db/rival_albums.sql), as the poller last read it, or `{enabled: false}` without a database.
 *
 * Public game facts only, but read next to our own album on the game screens: GAME_VIEW_TOKEN, when set, is required
 * as `?token=`, exactly like the game stream and /api/strategy. A per-address limit on reads.
 */
import type { RivalsSnapshot } from '../../shared/rivals.ts'
import { createSnapshotRoutes, type SnapshotRouteDeps } from '../snapshot-routes.ts'

export type RivalsRouteDeps = SnapshotRouteDeps<RivalsSnapshot>

export function createRivalsRoutes(deps: RivalsRouteDeps): ReturnType<typeof createSnapshotRoutes> {
  // the page reads every 15 s and on each notice; a few tabs and a reload fit
  return createSnapshotRoutes('/api/rivals', { capacity: 30, refillPerSecond: 1 }, deps)
}
