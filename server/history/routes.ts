/**
 * GET /api/history   JSON: our cash over the day and what moved it (db/history.sql), as the poller last read
 *                    it, or `{enabled: false}` without a database.
 *
 * Our cash and our trades are private: GAME_VIEW_TOKEN, when set, is required as `?token=`, exactly like the
 * game stream and /api/learn. A per-address limit on reads.
 */
import type { HistorySnapshot } from '../../shared/history.ts'
import { createSnapshotRoutes, type SnapshotRouteDeps } from '../snapshot-routes.ts'

export type HistoryRouteDeps = SnapshotRouteDeps<HistorySnapshot>

export function createHistoryRoutes(deps: HistoryRouteDeps): ReturnType<typeof createSnapshotRoutes> {
  // the page reads every 5 s; a few tabs and a reload fit
  return createSnapshotRoutes('/api/history', { capacity: 30, refillPerSecond: 1 }, deps)
}
