/**
 * GET /api/strategy  JSON: what we aim for, why we hold what we hold and why we do not buy (db/strategy.sql), as the
 *                    poller last read it, or `{enabled: false}` without a database.
 *
 * Our values, our caps and why our agents refused a buy are private: GAME_VIEW_TOKEN, when set, is required as
 * `?token=`, exactly like the game stream, /api/learn and /api/history. A per-address limit on reads.
 */
import type { StrategySnapshot } from '../../shared/strategy.ts'
import { createSnapshotRoutes, type SnapshotRouteDeps } from '../snapshot-routes.ts'

export type StrategyRouteDeps = SnapshotRouteDeps<StrategySnapshot>

export function createStrategyRoutes(deps: StrategyRouteDeps): ReturnType<typeof createSnapshotRoutes> {
  // the page reads every 5 s; a few tabs and a reload fit
  return createSnapshotRoutes('/api/strategy', { capacity: 30, refillPerSecond: 1 }, deps)
}
