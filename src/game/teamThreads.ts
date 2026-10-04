/**
 * Threads between teams (the team desk's swaps): `thread.opened` / `thread.message` / `thread.closed` of kind `team`
 * where we are either side. Kept apart from the dealer threads (`State.threads`), whose screens price a card against a
 * dealer. A team's words are untrusted: kept as plain text for the page to print escaped, never spoken.
 */
import type { GameEvent, Payload } from './state.ts'

/** One side of a team offer: the cash and the cards (refs) it moves. */
export type TeamSide = { readonly cash: number; readonly cards: readonly string[] }

export type TeamOffer = {
  readonly eventId: number
  readonly tick: number | null
  readonly side: 'us' | 'them'
  /** What the offer's maker gives and wants. */
  readonly give: TeamSide
  readonly want: TeamSide
  readonly final: boolean
  /** The tick the offer lapses after; null when the game gave none. */
  readonly expiresTick: number | null
}

export type TeamThread = {
  id: number
  /** The other team. */
  with: string
  venue: string | null
  /** Who opened it: us, or them. */
  openedBy: 'us' | 'them'
  openedTick: number | null
  lastTick: number | null
  status: 'open' | 'closed'
  closedReason: string | null
  offers: TeamOffer[]
  /** Their latest words: untrusted, plain text only. */
  lastText: string | null
}

export const TEAM_THREAD_LIMITS = { threads: 60, offers: 40, text: 280 }

/** A team's id (`t07`), as opposed to a dealer's (`abuela`). */
export const TEAM_ID = /^t\d{1,3}$/

/** A team thread: the game says `kind: team`; with no kind, both sides are team ids. */
export function isTeamThread(p: Payload): boolean {
  if (p.kind === 'team') return true
  return p.kind == null && TEAM_ID.test(String(p.team ?? '')) && TEAM_ID.test(String(p.with ?? ''))
}

/** Ours when we opened it or it was opened with us. */
export const isOurTeamThread = (team: string, p: Payload): boolean => Boolean(team) && isTeamThread(p) && (p.team === team || p.with === team)

/** One side of an offer (`give` or `want`): its cards (asset refs and wanted types) and its cash. */
export const sideOf = (v: Payload | undefined): TeamSide => {
  const cards: string[] = []
  for (const a of Array.isArray(v?.assets) ? v.assets : []) if (typeof a?.ref === 'string') cards.push(a.ref)
  for (const ty of Array.isArray(v?.types) ? v.types : []) if (typeof ty === 'string') cards.push(ty.split(':').at(-1) ?? ty)
  const cash = typeof v?.cash === 'number' && Number.isFinite(v.cash) ? v.cash : 0
  return { cash, cards }
}

/** Plain text, bounded: control and format characters out (bidi tricks), whitespace folded. */
export function plainText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const plain = v
    .normalize('NFC')
    .replace(/[\p{Cf}\p{Co}\p{Cs}]/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    // stacked combining marks ("zalgo"): at most two on a letter
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return null
  // cut by code point, never inside a surrogate pair
  const chars = Array.from(plain)
  return chars.length <= TEAM_THREAD_LIMITS.text ? plain : `${chars.slice(0, TEAM_THREAD_LIMITS.text - 1).join('').trimEnd()}…`
}

function threadOf(all: Map<number, TeamThread>, team: string, p: Payload, tick: number | null): TeamThread | null {
  if (typeof p.thread !== 'number') return null
  const existing = all.get(p.thread)
  if (existing) return existing
  // bounded: the oldest thread goes first (a Map keeps insertion order)
  while (all.size >= TEAM_THREAD_LIMITS.threads) all.delete(all.keys().next().value as number)
  const th: TeamThread = {
    id: p.thread, with: p.team === team ? String(p.with ?? '?') : String(p.team ?? '?'), venue: typeof p.venue === 'string' ? p.venue : null,
    openedBy: p.team === team ? 'us' : 'them', openedTick: tick, lastTick: tick, status: 'open', closedReason: null, offers: [], lastText: null,
  }
  all.set(p.thread, th)
  return th
}

export function teamThreadOpened(all: Map<number, TeamThread>, team: string, e: GameEvent): void {
  const p = e.payload
  if (!isOurTeamThread(team, p)) return
  threadOf(all, team, p, e.tick ?? null)
}

export function teamThreadMessage(all: Map<number, TeamThread>, team: string, e: GameEvent): void {
  const p = e.payload
  if (!all.has(p.thread) && !isOurTeamThread(team, p)) return
  const th = threadOf(all, team, p, e.tick ?? null)
  if (!th) return
  const ours = p.sender === team
  th.lastTick = e.tick ?? th.lastTick
  const offer: Payload | undefined = p.offer && typeof p.offer === 'object' ? p.offer : undefined
  if (offer) {
    // the offer's maker says whose side `give` is (a message may carry the other side's offer back)
    const mine = offer.maker != null ? offer.maker === team : ours
    const expires = typeof offer.expires_tick === 'number' ? offer.expires_tick : null
    th.offers.push({ eventId: e.id, tick: e.tick ?? null, side: mine ? 'us' : 'them', give: sideOf(offer.give), want: sideOf(offer.want), final: Boolean(offer.final), expiresTick: expires })
    if (th.offers.length > TEAM_THREAD_LIMITS.offers) th.offers.splice(0, th.offers.length - TEAM_THREAD_LIMITS.offers)
  }
  if (!ours) th.lastText = plainText(p.text) ?? th.lastText
}

export function teamThreadClosed(all: Map<number, TeamThread>, e: GameEvent): boolean {
  const th = all.get(e.payload.thread)
  if (!th) return false
  th.status = 'closed'
  th.lastTick = e.tick ?? th.lastTick
  th.closedReason = typeof e.payload.reason === 'string' ? e.payload.reason : null
  return true
}
