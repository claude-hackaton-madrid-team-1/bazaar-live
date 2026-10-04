import { apply, createState, type BookOffer, type GameEvent, type Trade } from '../game/state'

export type OfferState = 'open' | 'expired' | 'cancelled' | 'unknown'
export type PostedOffer = BookOffer & { status: OfferState }
export type OfferGroup = { id: string; name: string; owner: string | null; rows: readonly PostedOffer[] }
export type OffersView = {
  tick: number | null
  receivedAt: number | null
  groups: readonly OfferGroup[]
  trades: readonly Trade[]
}
export const EMPTY_OFFERS: OffersView = { tick: null, receivedAt: null, groups: [], trades: [] }

/** Read-only projection of the show's existing authenticated feed; never another subscription. */
export class OffersTracker {
  private state = createState()
  private known = new Map<number, PostedOffer>()
  private receivedAt: number | null = null

  receive(events: readonly GameEvent[], replay: boolean, now = Date.now()): OffersView {
    if (replay) {
      this.state = createState()
      this.known.clear()
      this.receivedAt = null
    }
    for (const event of events) {
      apply(this.state, event)
      if (event.type === 'clock' || event.type === 'offers.ours') this.receivedAt = now
      if (event.type === 'offer.cancelled') {
        const row = this.known.get(event.payload.offer)
        if (row) row.status = event.payload.reason === 'expired' ? 'expired' : 'cancelled'
      }
      const open = new Set<number>()
      for (const book of this.state.book.values()) {
        for (const offer of book.values()) {
          if (!this.state.team || offer.maker !== this.state.team) continue
          open.add(offer.id)
          this.known.set(offer.id, { ...offer, status: 'open' })
        }
      }
      for (const row of this.known.values()) {
        if (open.has(row.id) || row.status !== 'open') continue
        // Disappearance is not proof of a sale. Confirmed trades are shown separately below.
        row.status = row.expiresTick !== null && row.expiresTick < this.state.tick ? 'expired' : 'unknown'
      }
    }
    const rows = [...this.known.values()].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.id - a.id).slice(0, 60)
    this.known = new Map(rows.map((row) => [row.id, row]))
    const groups = new Map<string, OfferGroup>()
    for (const row of rows) {
      const venue = this.state.venues.get(row.venue)
      const group = groups.get(row.venue) ?? { id: row.venue, name: venue?.name ?? row.venue, owner: venue?.owner ?? null, rows: [] }
      groups.set(row.venue, { ...group, rows: [...group.rows, { ...row }] })
    }
    return {
      tick: this.receivedAt === null ? null : this.state.tick,
      receivedAt: this.receivedAt,
      groups: [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)),
      trades: this.state.tape.filter((trade) => trade.ours).slice(0, 4),
    }
  }
}
