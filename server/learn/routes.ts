/**
 * GET /api/learn   JSON: what our agents learned (db/learn.sql), as the poller last read it, or `{enabled: false}`
 *                  without a database.
 *
 * This is the team's private memory (lessons, learned ladders, rivals' profiles): GAME_VIEW_TOKEN, when set,
 * is required as `?token=`, exactly like the game stream. A per-address limit on reads.
 */
import type { LearnSnapshot } from '../../shared/learn.ts'
import { createSnapshotRoutes, type SnapshotRouteDeps } from '../snapshot-routes.ts'

export type LearnRouteDeps = SnapshotRouteDeps<LearnSnapshot>

export function createLearnRoutes(deps: LearnRouteDeps): ReturnType<typeof createSnapshotRoutes> {
  // the page reads every 10 s; a few tabs and a reload fit
  return createSnapshotRoutes('/api/learn', { capacity: 20, refillPerSecond: 0.5 }, deps)
}
