import { nameOfRef } from '../cards.ts'
import { RARITY_COLOR, SETS, SLOT_RARITY, type Rarity } from '../game.ts'
import type { State } from '../state.ts'
import type { HowKnown, RivalCard, RivalsSnapshot, RivalTeam, RivalWant } from '../../../shared/rivals.ts'
import { albumRows } from './album.ts'
import { ourVenues } from './our-market.ts'

/*
 * The Rivals screen, from what the public feed shows (db/rival_albums.sql) and our own album (the game stream):
 *  - what we need: the cards our target pages lack (incomplete pages our affinity boosts, as /strategy picks them);
 *  - who holds each of them, and who chases it with us;
 *  - every team by rank, with how many of our needs it holds;
 *  - one team's album as far as we know it: a card we never saw it hold is unknown, never missing.
 */

const PAGE_SLOTS = 10

/** A team chasing a card counts while its last bid or dealer ask is this recent: about an hour at 15 s a tick. */
export const CHASE_TICKS = 240

const isTeam = (id: string): boolean => /^t\d{1,3}$/.test(id)

const refFor = (set: string, i: number) => `${set}-${String(i + 1).padStart(2, '0')}`

/** The newest tick we know: the feed's head, else the game's clock. */
export const nowOf = (snap: RivalsSnapshot, s: Pick<State, 'tick'>): number => Math.max(snap.tick ?? 0, s.tick)

export interface Need {
  readonly ref: string
  readonly set: string
  readonly page: string
  readonly rarity: Rarity
  /** The page's cards we hold, of its ten. */
  readonly have: number
  readonly of: number
}

/**
 * The cards we lack on the pages we aim for: incomplete pages with our affinity above ×1 (/strategy's targets), the
 * closest page first. With no such page (the affinity not read yet), the incomplete pages three cards or fewer short.
 */
export function needsOf(s: State): Need[] {
  const rows = albumRows(s).filter((r) => !r.complete && r.missing > 0)
  const targets = rows.filter((r) => r.affinity.known && r.affinity.value > 1)
  const pick = targets.length ? targets : rows.filter((r) => r.missing <= 3)
  return pick.flatMap((row) =>
    row.slots
      .slice(0, PAGE_SLOTS)
      .filter((c) => c.count === 0)
      .map((c) => ({ ref: c.ref, set: row.set, page: row.name, rarity: c.rarity, have: row.have, of: row.of })),
  )
}

/** A holder of a card we need. */
export interface Holder {
  readonly team: string
  readonly copies: number
  readonly how: HowKnown
  readonly since: number
  readonly seen: number
}

/** A team after the same card as us. */
export interface Chaser {
  readonly team: string
  readonly last: number
  readonly topBid: number | null
  readonly via: readonly RivalWant['via'][]
}

export interface NeedRow extends Need {
  readonly name: string | null
  /** Teams holding it: a spare (two copies or more) first, then the freshest sighting. */
  readonly holders: readonly Holder[]
  /** Dealers holding it, by id. */
  readonly dealers: readonly string[]
  /** Teams that bid for it or asked a dealer for it lately, the latest first. */
  readonly chasers: readonly Chaser[]
}

const byHolder = (a: Holder, b: Holder) => Number(b.copies > 1) - Number(a.copies > 1) || b.seen - a.seen || a.team.localeCompare(b.team)

/** Each card we need, with who holds it and who chases it besides us. */
export function needRows(snap: RivalsSnapshot, s: State, now = nowOf(snap, s)): NeedRow[] {
  return needsOf(s).map((need) => {
    const held = snap.holdings.filter((h) => h.card === need.ref && h.holder !== s.team)
    const chasers = new Map<string, { team: string; last: number; topBid: number | null; via: RivalWant['via'][] }>()
    for (const w of snap.wants) {
      if (w.card !== need.ref || w.team === s.team || now - w.last > CHASE_TICKS) continue
      const c = chasers.get(w.team) ?? { team: w.team, last: w.last, topBid: null, via: [] }
      c.last = Math.max(c.last, w.last)
      if (w.topBid !== null) c.topBid = Math.max(c.topBid ?? 0, w.topBid)
      c.via.push(w.via)
      chasers.set(w.team, c)
    }
    return {
      ...need,
      name: held.find((h) => h.name)?.name ?? nameOfRef(need.ref),
      holders: held.filter((h) => isTeam(h.holder)).map((h) => ({ team: h.holder, copies: h.copies, how: h.how, since: h.since, seen: h.seen })).sort(byHolder),
      dealers: held.filter((h) => !isTeam(h.holder)).map((h) => h.holder).sort(),
      chasers: [...chasers.values()].sort((a, b) => b.last - a.last || a.team.localeCompare(b.team)),
    }
  })
}

export interface TeamRow {
  readonly team: string
  readonly rank: number
  readonly score: number
  /** Complete pages, by the leaderboard. */
  readonly pages: number | null
  readonly us: boolean
  /** How many of the cards we need it holds. */
  readonly holdsNeeds: number
  /** Its most chased set (its likely ×1.6), when one is clearly positive. */
  readonly chases: string | null
  /** It chases a set we aim for. */
  readonly rival: boolean
}

/** The set a team's public moves chase most, when its count is above 0. */
export const chasedSet = (t: Pick<RivalTeam, 'interest'>): string | null => {
  let best: [string, number] | null = null
  for (const [set, n] of Object.entries(t.interest)) if (n > 0 && (!best || n > best[1] || (n === best[1] && set < best[0]))) best = [set, n]
  return best?.[0] ?? null
}

/** Every team by rank, ours included (marked), with what it holds of our needs and what it chases. */
export function teamRows(snap: RivalsSnapshot, s: State, needs: readonly Need[] = needsOf(s)): TeamRow[] {
  const wanted = new Set(needs.map((n) => n.ref))
  const aims = new Set(needs.map((n) => n.set))
  return [...snap.teams]
    .sort((a, b) => a.rank - b.rank || a.team.localeCompare(b.team))
    .map((t) => {
      const us = t.team === s.team
      const chases = chasedSet(t)
      return {
        team: t.team, rank: t.rank, score: t.score, pages: t.pages, us,
        holdsNeeds: us ? 0 : snap.holdings.filter((h) => h.holder === t.team && wanted.has(h.card)).length,
        chases, rival: !us && chases !== null && aims.has(chases),
      }
    })
}

export interface RivalSlot {
  readonly ref: string
  readonly name: string | null
  readonly rarity: Rarity
  readonly color: string
  /** Null: we never saw this team hold it (unknown, not missing). */
  readonly known: Pick<RivalCard, 'copies' | 'how' | 'since' | 'seen'> | null
  /** One of the cards we need. */
  readonly need: boolean
}

export interface RivalPage {
  readonly set: string
  readonly name: string
  readonly color: string
  /** Page cards (of ten) we know it holds. */
  readonly known: number
  readonly of: number
  /** Of the cards we need on this page, how many it holds. */
  readonly needs: number
  /** Not seen complete, but among the likeliest of the complete pages the leaderboard counts and we do not see. */
  readonly probable: boolean
  readonly slots: readonly RivalSlot[]
}

/**
 * The leaderboard counts a team's complete pages; public moves may show fewer of them complete. Flags the likeliest of
 * the others, as many as we miss: the most cards known first (9 of 10 known is likely complete), the given order on a
 * tie. A page with no card known is no evidence, never flagged.
 */
export function markProbable(pages: readonly RivalPage[], complete: number | null): RivalPage[] {
  const seen = pages.filter((p) => p.known >= p.of).length
  const missing = Math.max(0, (complete ?? 0) - seen)
  const picked = new Set(
    pages
      .filter((p) => p.known > 0 && p.known < p.of)
      .sort((a, b) => b.known - a.known)
      .slice(0, missing)
      .map((p) => p.set),
  )
  return pages.map((p) => (picked.has(p.set) ? { ...p, probable: true } : p))
}

/** A team's album in numbers: what the leaderboard says beside what public moves show. */
export interface AlbumCounts {
  /** Filled album slots, by the leaderboard: null until the agents store it. */
  readonly held: number | null
  /** Page cards public moves show it holding. */
  readonly known: number
  /** Complete pages, by the leaderboard. */
  readonly complete: number | null
  /** Pages we see complete (every card known). */
  readonly seen: number
  /** Pages flagged probably complete. */
  readonly probable: number
}

export function albumCounts(snap: RivalsSnapshot, team: string, pages: readonly RivalPage[]): AlbumCounts {
  const row = snap.teams.find((t) => t.team === team)
  return {
    held: row?.albumFilled ?? null,
    known: pages.reduce((n, p) => n + p.known, 0),
    complete: row?.pages ?? null,
    seen: pages.filter((p) => p.known >= p.of).length,
    probable: pages.filter((p) => p.probable).length,
  }
}

/**
 * A team's album as far as the public feed shows it: every set we know of, in `order` (our album's order) first, the
 * sets we have no page of after it in the catalog's order; the pages the leaderboard says are complete though we do
 * not see them so, flagged (markProbable).
 */
export function rivalAlbum(snap: RivalsSnapshot, team: string, needs: readonly Need[] = [], order: readonly string[] = []): RivalPage[] {
  const mine = new Map(snap.holdings.filter((h) => h.holder === team).map((h) => [h.card, h]))
  const wanted = new Set(needs.map((n) => n.ref))
  const sets = new Set(order)
  for (const h of snap.holdings) sets.add(h.set ?? h.card.split('-')[0] ?? '')
  for (const n of needs) sets.add(n.set)
  const catalog = Object.keys(SETS)
  const rank = (set: string) => (order.includes(set) ? order.indexOf(set) : order.length + catalog.indexOf(set))
  const pages = [...sets]
    .filter((set) => set in SETS)
    .sort((a, b) => rank(a) - rank(b))
    .map((set): RivalPage => {
      const slots = SLOT_RARITY.map((rarity, i): RivalSlot => {
        const ref = refFor(set, i)
        const h = mine.get(ref)
        return {
          ref, name: h?.name ?? nameOfRef(ref), rarity, color: RARITY_COLOR[rarity],
          known: h ? { copies: h.copies, how: h.how, since: h.since, seen: h.seen } : null,
          need: wanted.has(ref),
        }
      })
      const page = slots.slice(0, PAGE_SLOTS)
      return {
        set, name: SETS[set]?.name ?? set, color: SETS[set]?.color ?? 'var(--text-muted)',
        known: page.filter((c) => c.known).length, of: PAGE_SLOTS,
        needs: page.filter((c) => c.known && c.need).length,
        probable: false,
        slots,
      }
    })
  return markProbable(pages, snap.teams.find((t) => t.team === team)?.pages ?? null)
}

/** One card of our page, beside the rival's. */
export interface OurSlot {
  readonly ref: string
  readonly rarity: Rarity
  readonly color: string
  readonly count: number
}

/** One neighbourhood, ours beside theirs: our page (null when we have none of the set) and what we know of theirs. */
export interface ComparedPage {
  readonly set: string
  readonly name: string
  readonly color: string
  readonly ours: { readonly have: number; readonly of: number; readonly complete: boolean; readonly slots: readonly OurSlot[] } | null
  readonly theirs: RivalPage
}

/**
 * Our album beside a rival's, neighbourhood by neighbourhood, in the order of our Album screen (closest page to
 * complete first), then the sets only the rival has cards of.
 */
export function compareAlbums(snap: RivalsSnapshot, s: State, team: string, needs: readonly Need[] = needsOf(s)): ComparedPage[] {
  const rows = albumRows(s)
  const ours = new Map(rows.map((r) => [r.set, r]))
  return rivalAlbum(snap, team, needs, rows.map((r) => r.set)).map((theirs) => {
    const row = ours.get(theirs.set)
    return {
      set: theirs.set,
      name: row?.name ?? theirs.name,
      color: theirs.color,
      ours: row ? { have: row.have, of: row.of, complete: row.complete, slots: row.slots.map((c) => ({ ref: c.ref, rarity: c.rarity, color: c.color, count: c.count })) } : null,
      theirs,
    }
  })
}

/** The team to show: the one asked for (case aside) when we have it, else the top-ranked rival holding most of our needs. */
export function pickTeam(rows: readonly TeamRow[], asked: string | null): string | null {
  const wanted = asked?.trim().toLowerCase()
  const hit = rows.find((r) => r.team === wanted && !r.us)
  if (hit) return hit.team
  const rivals = rows.filter((r) => !r.us)
  return [...rivals].sort((a, b) => b.holdsNeeds - a.holdsNeeds || a.rank - b.rank)[0]?.team ?? null
}

// ---------------------------------------------------------------- invite rivals to our market

export interface InviteCard {
  readonly ref: string
  readonly name: string | null
  readonly rarity: Rarity | null
  /** Our standing ask price on the venue; null when the board hid it. */
  readonly price: number | null
  readonly set: string
  readonly venue: string
  readonly venueName: string
}

export interface InviteRow {
  readonly team: string
  readonly rank: number
  /** The cards we list that this team is missing, cheapest first. */
  readonly cards: readonly InviteCard[]
  readonly sets: readonly string[]
  /** It already bids or asks a dealer for one of these: a hotter lead. */
  readonly chasing: boolean
}

/**
 * Who to invite to our market, from public moves only. For each rival: the cards we have LISTED for sale on a venue we
 * run that it is missing — a card on an incomplete page we never saw it hold, never one it holds or a page it likely
 * completed. "Missing" is a guess from the public feed ("may need"), never a claim about its private album. This writes
 * the pitch; it never sends a trade. The agent's own offers to teams are the maker's addressed asks (buyer rank) and
 * the card hunt, not this screen.
 */
export function inviteRows(snap: RivalsSnapshot, s: State): InviteRow[] {
  const asks = new Map<string, InviteCard>() // our cheapest standing ask per card, across the venues we run
  for (const v of ourVenues(s)) {
    for (const a of v.asks) {
      if (a.side !== 'ask') continue
      const cand: InviteCard = { ref: a.ref, name: a.name, rarity: a.rarity, price: a.price, set: a.ref.split('-')[0] ?? a.ref, venue: v.id, venueName: v.name }
      const prev = asks.get(a.ref)
      if (!prev || (cand.price ?? Infinity) < (prev.price ?? Infinity)) asks.set(a.ref, cand)
    }
  }
  if (asks.size === 0) return []
  const needs = needsOf(s)
  const order = [...new Set([...asks.values()].map((a) => a.set))] // build each listed card's page, even if the team holds none of it yet
  const wants = new Map<string, Set<string>>()
  for (const w of snap.wants) {
    const set = wants.get(w.team) ?? new Set<string>()
    set.add(w.card)
    wants.set(w.team, set)
  }
  const rows: InviteRow[] = []
  for (const t of snap.teams) {
    if (t.team === s.team) continue
    const cards: InviteCard[] = []
    for (const p of rivalAlbum(snap, t.team, needs, order)) {
      if (p.known >= p.of || p.probable) continue // complete or likely complete: no need
      for (const slot of p.slots) {
        if (slot.known != null) continue // we have seen it hold this one
        const ask = asks.get(slot.ref)
        if (ask) cards.push(ask)
      }
    }
    if (cards.length === 0) continue
    cards.sort((a, b) => (a.price ?? 0) - (b.price ?? 0) || a.ref.localeCompare(b.ref))
    rows.push({ team: t.team, rank: t.rank, cards, sets: [...new Set(cards.map((c) => c.set))], chasing: cards.some((c) => wants.get(t.team)?.has(c.ref)) })
  }
  return rows.sort((a, b) => Number(b.chasing) - Number(a.chasing) || b.cards.length - a.cards.length || a.rank - b.rank)
}
