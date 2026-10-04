/**
 * What the Our market screen keeps beyond the board (`State.book`) and the venues (`State.venues`): each venue's bond
 * and mechanism from `venue.opened`, the latest announcements per venue, and the bench sessions (`bench.started`:
 * the organisers' synthetic book every venue gets). Bounded; the reducer calls `applyMarketExtras`.
 */
import type { GameEvent, Payload } from './state.ts'

export type Announcement = { readonly eventId: number; readonly tick: number | null; readonly text: string }

export type Bench = {
  readonly eventId: number
  readonly session: number | null
  readonly name: string
  readonly startTick: number | null
  readonly ticks: number | null
  readonly venues: readonly string[]
}

export type MarketExtras = {
  /** venue → its bond and mechanism, as `venue.opened` said them. */
  readonly venues: Map<string, { bond: number | null; mechanism: string | null }>
  /** venue → its latest announcements, oldest first. */
  readonly announcements: Map<string, Announcement[]>
  /** Bench sessions, oldest first. */
  readonly benches: Bench[]
  /** An `agent.venues` that came before we knew our team (`agent.hello`): applied once we do. */
  pendingVenues: GameEvent | null
}

export const MARKET_LIMITS = { announcements: 12, benches: 20, text: 280 }

export const createMarketExtras = (): MarketExtras => ({ venues: new Map(), announcements: new Map(), benches: [], pendingVenues: null })

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A venue's announcement as plain text: another team writes it, so control and format characters go and it is bounded. */
export function announcementText(v: unknown): string {
  if (typeof v !== 'string') return ''
  const plain = v.normalize('NFC').replace(/[\p{Cf}\p{Co}\p{Cs}]/gu, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(plain)
  return chars.length <= MARKET_LIMITS.text ? plain : `${chars.slice(0, MARKET_LIMITS.text - 1).join('').trimEnd()}…`
}

export function applyMarketExtras(m: MarketExtras, e: GameEvent): void {
  const p: Payload = e.payload ?? {}
  switch (e.type) {
    case 'venue.opened':
      if (typeof p.venue === 'string') m.venues.set(p.venue, { bond: num(p.bond), mechanism: typeof p.rules?.mechanism === 'string' ? p.rules.mechanism : null })
      break
    case 'venue.announcement': {
      if (typeof p.venue !== 'string') break
      const list = m.announcements.get(p.venue) ?? []
      if (list.some((a) => a.eventId === e.id)) break
      list.push({ eventId: e.id, tick: e.tick ?? null, text: announcementText(p.text) })
      if (list.length > MARKET_LIMITS.announcements) list.splice(0, list.length - MARKET_LIMITS.announcements)
      m.announcements.set(p.venue, list)
      break
    }
    case 'bench.started': {
      if (m.benches.some((b) => b.eventId === e.id)) break
      m.benches.push({
        eventId: e.id, session: num(p.session), name: typeof p.name === 'string' ? announcementText(p.name) : '',
        startTick: num(p.start_tick) ?? e.tick ?? null, ticks: num(p.ticks),
        venues: Array.isArray(p.venues) ? p.venues.filter((v: unknown): v is string => typeof v === 'string') : [],
      })
      if (m.benches.length > MARKET_LIMITS.benches) m.benches.splice(0, m.benches.length - MARKET_LIMITS.benches)
      break
    }
  }
}
