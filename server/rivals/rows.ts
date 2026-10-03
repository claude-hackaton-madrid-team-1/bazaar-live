/**
 * Rows of db/rival_albums.sql's views → the wire type (shared/rivals.ts). Same rules as server/strategy/rows.ts: every
 * field is checked, a row in an odd shape loses that field or is skipped when it lacks what makes it a row (a holder,
 * a card, a tick), it never breaks the snapshot.
 */
import { HOW_KNOWN, type RivalCard, type RivalTeam, type RivalWant } from '../../shared/rivals.ts'
import { line, num } from '../learn/rows.ts'

type Row = Record<string, unknown>

const asRow = (raw: unknown): Row => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Row) : {})

const int = (raw: unknown): number | null => {
  const n = num(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

/** A card code as the catalog writes it (LAV-09); anything else is not a card. */
const REF = /^[A-Z]{3}-\d{1,3}$/
const ref = (raw: unknown): string | null => (typeof raw === 'string' && REF.test(raw) ? raw : null)

/** A team (`t05`) or a dealer (`chato`): a short lowercase id. */
const ID = /^[a-z][a-z0-9_]{0,23}$/
const id = (raw: unknown): string | null => (typeof raw === 'string' && ID.test(raw) ? raw : null)

const TEAM = /^t\d{1,3}$/

export function holdingOf(raw: unknown): RivalCard | null {
  const r = asRow(raw)
  const holder = id(r.holder)
  const card = ref(r.card)
  const copies = int(r.copies)
  const since = int(r.since_tick)
  const seen = int(r.seen_tick)
  const how = HOW_KNOWN.find((h) => h === r.how)
  if (!holder || !card || copies === null || copies < 1 || since === null || seen === null || !how) return null
  return {
    holder,
    card,
    set: line(r.set_code, 8),
    rarity: line(r.rarity, 16),
    name: line(r.name, 64),
    copies,
    how,
    since,
    seen: Math.max(since, seen),
  }
}

export function teamOf(raw: unknown): RivalTeam | null {
  const r = asRow(raw)
  const team = typeof r.team === 'string' && TEAM.test(r.team) ? r.team : null
  const rank = int(r.rank)
  const score = num(r.score)
  if (!team || rank === null || score === null) return null
  const interest: Record<string, number> = {}
  for (const [k, v] of Object.entries(asRow(r.set_interest))) {
    const n = num(v)
    if (/^[A-Z]{3}$/.test(k) && n !== null) interest[k] = n
  }
  const filled = int(r.album_filled)
  const slots = int(r.album_slots)
  return {
    team, rank, score, level: int(r.level), pages: int(r.pages), deals: int(r.deals), tick: int(r.tick),
    albumFilled: filled !== null && filled >= 0 ? filled : null, albumSlots: slots !== null && slots > 0 ? slots : null,
    interest,
  }
}

export function wantOf(raw: unknown): RivalWant | null {
  const r = asRow(raw)
  const team = typeof r.team === 'string' && TEAM.test(r.team) ? r.team : null
  const card = ref(r.card)
  const times = int(r.times)
  const last = int(r.last_tick)
  if (!team || !card || (r.via !== 'bid' && r.via !== 'dealer') || times === null || times < 1 || last === null) return null
  const bid = int(r.top_bid)
  return { team, card, via: r.via, times, last, topBid: bid !== null && bid > 0 ? bid : null }
}

export function headOf(raw: unknown): number | null {
  return int(asRow(raw).tick)
}
