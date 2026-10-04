/**
 * GET /api/venue  JSON: our venue, the Market Test sessions, the books our broker saw and what it matched, and other
 *                 teams on our venue (db/venue.sql), as the poller last read it, or `{enabled: false}` without a database.
 *
 * Our broker's moves and our private score parts: GAME_VIEW_TOKEN, when set, is required as `?token=`, exactly like the
 * game stream, /api/strategy and /api/history. A per-address limit on reads.
 */
import type { VenueSnapshot } from '../../shared/venue.ts'
import { createSnapshotRoutes, type SnapshotRouteDeps } from '../snapshot-routes.ts'

export type VenueRouteDeps = SnapshotRouteDeps<VenueSnapshot>

export function createVenueRoutes(deps: VenueRouteDeps): ReturnType<typeof createSnapshotRoutes> {
  // the page reads every 5 s (3 s while a session runs); a few tabs and a reload fit
  return createSnapshotRoutes('/api/venue', { capacity: 40, refillPerSecond: 1 }, deps)
}
