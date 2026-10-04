/**
 * Our venues on the game stream, as the sticky status `venues.ours`: the screens fed by the stream (/negotiations'
 * markets, /market's venues) learn which venue is ours from its `venue.opened`, but the stream replays only the newest
 * feed rows and we opened v19 long before them. So whenever the Venue poller's rows of show.venue_ours change, the list
 * goes to every viewer, and a late one gets it after the backlog (STICKY_LAST), where no older venue event can undo it.
 *
 * Only what the public feed already says of a venue (id, name, mechanism, fees, status, the tick it opened): never the
 * Market Test numbers or the broker's moves of the same poller.
 */
import type { OurVenue, VenueSnapshot } from '../../shared/venue.ts'
import type { GameEvent } from '../game/relay.ts'

/** Ids of their own, between the duels' (-1e12 down) and `offers.ours` (-2^49 down): only the latest is ever kept. */
export const FIRST_VENUES_ID = -(2 ** 48)

export interface StatusHub {
  publishStatus(e: GameEvent): void
}

/** A venue of ours as `venues.ours` carries it; one with no known status (a starter stall replaced since) is left out. */
export function venuesPayload(venues: readonly OurVenue[]): Record<string, unknown>[] {
  return venues.flatMap((v) => (v.status === null ? [] : [{
    venue: v.venue, name: v.name, mechanism: v.mechanism, feeBps: v.feeBps, feePerCard: v.feePerCard, status: v.status, openedTick: v.openedTick,
  }]))
}

export class VenuesStream {
  private nextId = FIRST_VENUES_ID
  private sent = ''
  private readonly hub: StatusHub
  private readonly log: (entry: Record<string, unknown>) => void

  constructor(hub: StatusHub, log: (entry: Record<string, unknown>) => void) {
    this.hub = hub
    this.log = log
  }

  /** Publishes the snapshot's venues when they differ from the last ones sent; a view not read yet sends nothing. */
  update(snapshot: VenueSnapshot): void {
    if (!snapshot.parts.venues) return
    const venues = venuesPayload(snapshot.venues)
    const json = JSON.stringify(venues)
    if (json === this.sent) return
    try {
      const id = this.nextId
      this.nextId -= 1
      this.hub.publishStatus({ id, type: 'venues.ours', scope: 'team', actor: '', payload: { venues } })
      this.sent = json
    } catch (error: unknown) {
      this.log({ route: 'venue', event: 'publish_failed', message: error instanceof Error ? error.name : 'ERR' })
    }
  }
}
