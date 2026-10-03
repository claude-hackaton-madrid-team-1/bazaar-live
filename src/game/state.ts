import { HEALTH_AGENTS, type HealthReport } from '../../shared/health.ts'
import { applyDecision, applyLedger, applyOutcome, createDecisionLog, type DecisionLog } from './decisions.ts'

// The game's JSON, read defensively: every field is optional and falls back with `??`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Payload = Record<string, any>

export type GameEvent = {
  id: number
  tick?: number
  t?: number
  type: string
  scope?: string
  actor?: string
  payload: Payload
}

export type Phase = 'observe' | 'decide' | 'act'

export type LogLine = { eventId: number; tick: number; kind: string; text: string }

export type ThreadOffer = {
  eventId: number
  tick: number | undefined
  messageId: number | null
  offerId: number | null
  side: 'us' | 'them'
  price: number | null
  maker: string
  to: string
  createdTick: number | null
  expiresTick: number | null
  final: boolean
  assets: number[]
  /** The tactic our agent picked for the words of one of our messages (our database's feed adds it); null otherwise. */
  tactic: string | null
}

export type Thread = {
  id: number
  with: string
  topic: string
  side: 'buy' | 'sell'
  ourPrice: number | null
  theirPrice: number | null
  rounds: number
  final: boolean
  expiresTick: number | null
  status: 'open' | 'closed'
  lastText: string | null
  offers: ThreadOffer[]
  /** The price it settled at: a dealer thread often ends with a settlement and no thread.closed. */
  dealPrice?: number | null
  /** The tick it closed or settled at. */
  closedTick?: number | null
  /** thread.closed's reason (`idle`, ...), or `deal` when a settlement closed it. */
  closedReason?: string | null
}

export type Duel = {
  id: number
  role: string
  /** The other side, as the game names it: an alias like "Rival Azul" (duels never name a team); null until known. */
  rival: string | null
  /** The card at stake and the tick the duel ends by (from `duel.started`); null until known. */
  item: string | null
  deadlineTick: number | null
  session: number | null
  ourPrice: number | null
  theirPrice: number | null
  ourDays: number | null
  theirDays: number | null
  /** Messages heard, both sides (not the game's rounds: those are the fewer priced messages of the two sides). */
  rounds: number
  status: 'open' | 'deal' | 'no deal'
  dealPrice: number | null
  points: number | null
  lastEventId: number | null
  /** Our limit (a value as buyer, a cost as seller): from our database or our /api/duels, behind GAME_VIEW_TOKEN. */
  limit: number | null
  /** The share of a deal's value lost per round of talk. */
  decay: number | null
  /** What the deal kept for us: the surplus against our limit after the decay (the game's `result`). */
  gain: number | null
  /** The game's rounds at the close, from the result; null while live (the screen counts them from `offers`). */
  finalRounds: number | null
  /** Every priced message, oldest first (bounded). */
  offers: DuelMessage[]
  /** When it started (its first event) and when it closed (its result). */
  startTick: number | null
  closedTick: number | null
}

export type DuelMessage = { tick: number | null; side: 'us' | 'them'; price: number | null; days: number | null }

export type Trade = {
  eventId: number
  settlementId: number | null
  tick: number | undefined
  venue: string
  seller: string
  buyer: string
  assetId: number | null
  ref: string
  serial: number | null
  kind: string
  name: string
  price: number
  fee: number
  ours: boolean
  gain: number | null
}

/** An open offer on a venue's board (`offer.listed`). An ask gives goods for cash, a bid cash for goods, a swap goods for goods. */
export type BookOffer = {
  id: number
  eventId: number
  venue: string
  maker: string
  /** The one team the offer is addressed to; null when anyone may take it. */
  to: string | null
  side: 'ask' | 'bid' | 'swap'
  ref: string
  kind: string
  assetIds: number[]
  serial: number | null
  price: number | null
  createdTick: number | undefined
  expiresTick: number | null
}

export type Venue = {
  id: string
  name: string
  owner: string | null
  status: 'open' | 'closing' | 'closed'
  feeBps: number | null
  feePerCard: number | null
  openedTick: number | null
  seenTick: number
  announcement: { eventId: number; tick: number | undefined; text: string } | null
  announcements: number
}

export type PackOpened = { eventId: number; tick: number | undefined; team: string; name: string; pack: string; best: string | null }

export type Gift = { eventId: number; tick: number | undefined; team: string; from: string; cash: number; packs: string[]; cards: string[]; reason: string }

export type FailedSettlement = { eventId: number; tick: number | undefined; offer: number | null; reason: string; venue: string | null; ref: string | null; ours: boolean }

export type ThreadOpened = { eventId: number; tick: number | undefined; thread: number; kind: string; team: string; with: string; topic: Payload | null }

export type Page = { set: string; name?: string; have?: number; of?: number; complete?: boolean; master?: boolean; [k: string]: unknown }

export type Score = { score?: number; rank?: number; duel_points?: number; ladder_points?: number; neg_points?: number; mm_points?: number; bench_points?: number | null; [k: string]: unknown }

export type State = {
  team: string
  name: string
  tick: number
  day: string
  tickSeconds: number
  phase: Phase
  goal: string
  cash: number
  score: Score
  pages: Page[]
  owned: Record<string, { id: number; serial: number }[]>
  values: Record<string, number>
  /** Our set multipliers (set → ×), from /me: what a card of each set is worth to us is book × this. */
  affinity: Record<string, number>
  /** Our sealed packs, from /me. */
  packs: { id: number; ref: string; name: string }[]
  log: LogLine[]
  threads: Record<number, Thread>
  duels: Record<number, Duel>
  tape: Trade[]
  prices: Record<string, number[]>
  history: { tick: number; score: number; cash: number }[]
  ours: { trades: number; gain: number }
  /** The open offers of every venue's board, venue → offer id → offer. */
  book: Map<string, Map<number, BookOffer>>
  venues: Map<string, Venue>
  packsOpened: PackOpened[]
  gifts: Gift[]
  failed: FailedSettlement[]
  opened: ThreadOpened[]
  events: GameEvent[]
  mine: GameEvent[]
  byId: Map<number, GameEvent>
  meEventId?: number
  /** Our agents' decisions, outcomes and ledger (agent.decision / agent.outcome / agent.ledger). */
  agents: DecisionLog
  /** The taker's and the maker's latest /health, as the server relays it (agent.health); empty until the first. */
  health: HealthReport[]
  /**
   * When the server last found new rows for the screens that read their own API (/history, /learn), by screen,
   * ISO (pages.changed); null until the server says it sends these, and then the screens refetch on each.
   */
  changes: Readonly<Record<string, string>> | null
}

export const KNOWN_TYPES = new Set([
  'agent.hello', 'clock', 'agent.phase', 'agent.thought', 'agent.action', 'agent.me',
  'thread.message', 'thread.closed', 'settlement', 'duel.started', 'duel.message', 'duel.result',
  'thread.opened', 'offer.listed', 'offer.cancelled', 'settlement.failed', 'pack.opened', 'gift.given',
  'venue.opened', 'venue.announcement', 'venue.fee_announced', 'venue.fee_changed', 'venue.closing', 'venue.closed',
  'agent.decision', 'agent.outcome', 'agent.ledger', 'agent.health', 'pages.changed',
])

export const LIMITS = {
  log: 300, tape: 200, prices: 24, events: 500, mine: 1500, history: 400,
  book: 400, venues: 40, packsOpened: 100, gifts: 100, failed: 100, opened: 200, duelOffers: 60,
}

export function createState(): State {
  return {
    team: '', name: '', tick: 0, day: '', tickSeconds: 60, phase: 'observe', goal: '',
    cash: 0, score: {}, pages: [], owned: {}, values: {}, affinity: {}, packs: [],
    log: [], threads: {}, duels: {}, tape: [], prices: {}, history: [], ours: { trades: 0, gain: 0 },
    book: new Map(), venues: new Map(), packsOpened: [], gifts: [], failed: [], opened: [],
    events: [], mine: [], byId: new Map(), agents: createDecisionLog(), health: [], changes: null,
  }
}

const push = <T>(list: T[], item: T, max: number) => {
  list.push(item)
  if (list.length > max) list.splice(0, list.length - max)
}

export const topicOf = (offer: Payload): string => {
  for (const side of ['give', 'want']) {
    const types: string[] = offer[side]?.types ?? []
    if (types.length) return types[0]?.split(':').at(-1) ?? '?'
    const assets: Payload[] = offer[side]?.assets ?? []
    if (assets.length) return assets[0]?.ref ?? '?'
  }
  return '?'
}

export const priceOf = (offer: Payload): number | null => offer.want?.cash || offer.give?.cash || null

// The relay's own events (clock, /me, our /api/duels) are `team`; the feed's are `public`.
const fromRelay = (e: GameEvent): boolean => e.scope === 'team'

export function isOurs(s: State, e: GameEvent): boolean {
  const p = e.payload ?? {}
  if (e.type.startsWith('agent.') || e.type === 'clock') return true
  // The feed's `duel.closed` is every team's: a duel event is ours when it came from our duel list, or names one of ours.
  if (e.type.startsWith('duel.')) return fromRelay(e) || p.duel in s.duels
  if (e.type === 'thread.message') return p.team === s.team
  if (e.type === 'thread.closed') return p.thread in s.threads
  if (e.type === 'settlement') return (p.parties ?? []).includes(s.team)
  // the board and the rest: ours when we are the actor or the maker (never when we have no team yet)
  if (!s.team) return false
  if (e.actor === s.team) return true
  if (e.type === 'offer.listed') return p.offer?.maker === s.team
  if (e.type === 'offer.cancelled' || e.type === 'settlement.failed') return isOurOffer(s, p.offer)
  if (e.type === 'thread.opened') return p.team === s.team || p.with === s.team
  if (e.type === 'pack.opened' || e.type === 'gift.given') return p.team === s.team
  if (e.type.startsWith('venue.')) return (p.owner ?? s.venues.get(p.venue)?.owner) === s.team
  return false
}

/** The offer with this id on any board, the payload's venue looked at first. */
export function findOffer(s: State, id: unknown, venue?: unknown): BookOffer | undefined {
  if (typeof id !== 'number') return undefined
  const hinted = typeof venue === 'string' ? s.book.get(venue)?.get(id) : undefined
  if (hinted) return hinted
  for (const offers of s.book.values()) if (offers.has(id)) return offers.get(id)
  return undefined
}

/** Our offer: one we listed on a board, or one in a thread of ours. */
function isOurOffer(s: State, id: unknown): boolean {
  if (findOffer(s, id)?.maker === s.team) return true
  return Object.values(s.threads).some((th) => th.offers.some((o) => o.offerId === id))
}

/** A tactic id (`scarcity`, `plain`, ...); `none` is no tactic. */
const tacticOf = (v: unknown): string | null => (typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) && v !== 'none' ? v : null)

function threadMessage(s: State, e: GameEvent) {
  const p = e.payload
  if (p.team !== s.team) return
  const th = (s.threads[p.thread] ??= {
    id: p.thread, with: p.with ?? '?', topic: '?', side: 'buy', ourPrice: null, theirPrice: null,
    rounds: 0, final: false, expiresTick: null, status: 'open', lastText: null, offers: [],
  })
  const ours = p.sender === s.team
  const offer = p.offer
  if (offer) {
    th.topic = topicOf(offer)
    const price = priceOf(offer)
    if (ours) {
      th.side = offer.give?.cash ? 'buy' : 'sell'
      th.ourPrice = price
    } else {
      th.side = offer.want?.cash ? 'buy' : 'sell'
      th.theirPrice = price
      th.final = Boolean(offer.final)
    }
    th.expiresTick = offer.expires_tick ?? null
    th.offers.push({
      eventId: e.id, tick: e.tick, messageId: p.message ?? null, offerId: offer.id ?? null,
      side: ours ? 'us' : 'them', price, maker: offer.maker, to: offer.to,
      createdTick: offer.created_tick ?? null, expiresTick: offer.expires_tick ?? null, final: Boolean(offer.final),
      assets: [...(offer.give?.assets ?? []), ...(offer.want?.assets ?? [])].map((a: Payload) => a.id),
      tactic: ours ? tacticOf(p.tactic) : null,
    })
  }
  if (!ours && p.text) th.lastText = p.text
  th.rounds += 1
}

/**
 * A settlement names no thread: our newest open thread with that counterparty about that card is the one it
 * closed (a dealer's deal reaches the feed as a settlement only, never as thread.closed).
 */
function settleThread(s: State, other: string, ref: string, price: number, tick: number | undefined) {
  const th = Object.values(s.threads)
    .filter((t) => t.status === 'open' && t.with === other && t.topic === ref)
    .sort((a, b) => b.id - a.id)[0]
  if (!th) return
  th.status = 'closed'
  th.dealPrice = price
  th.closedTick = tick ?? null
  th.closedReason = 'deal'
}

function settlement(s: State, e: GameEvent) {
  const p = e.payload
  const parties: string[] = p.parties ?? []
  const venue = p.venue || p.persona || 'direct'
  const price: number = p.price ?? 0
  for (const item of p.items ?? []) {
    const ref: string = item.ref ?? '?'
    const seller: string = item.frm ?? '?'
    const buyer: string = item.to ?? '?'
    const ours = parties.includes(s.team)
    const value: number | undefined = p.your_value ?? s.values[ref]
    let gain: number | null = null
    if (ours && value != null) gain = buyer === s.team ? value - price : price - value
    if (ours) {
      s.ours.trades += 1
      s.ours.gain += gain ?? 0
    }
    s.tape.unshift({
      eventId: e.id, settlementId: p.settlement ?? null, tick: e.tick, venue, seller, buyer,
      assetId: item.id ?? null, ref, serial: item.serial ?? null, kind: item.kind ?? 'card',
      name: item.name ?? ref, price, fee: p.fee ?? 0, ours, gain,
    })
    if (s.tape.length > LIMITS.tape) s.tape.length = LIMITS.tape
    if (ours) settleThread(s, buyer === s.team ? seller : buyer, ref, price, e.tick)
    push((s.prices[ref] ??= []), price, LIMITS.prices)
    dropFilled(s, p.venue, item, price)
  }
  if (p.venue) touchVenue(s, p.venue, e.tick)
}

// ---------------------------------------------------------------- the board: offers, venues

/** A venue on first sight (a listing, a trade, an announcement): the house's ones never send venue.opened. */
function touchVenue(s: State, id: string, tick: number | undefined): Venue {
  let v = s.venues.get(id)
  if (!v) {
    v = {
      id, name: id, owner: null, status: 'open', feeBps: null, feePerCard: null, openedTick: null,
      seenTick: tick ?? s.tick, announcement: null, announcements: 0,
    }
    s.venues.set(id, v)
    const all = [...s.venues.values()]
    if (all.length > LIMITS.venues) {
      // the closed ones go first, then the ones not seen for longest
      const rank = (x: Venue) => (x.status === 'closed' ? 0 : 1)
      const out = all.filter((x) => x !== v).sort((a, b) => rank(a) - rank(b) || a.seenTick - b.seenTick)[0]
      if (out) s.venues.delete(out.id)
    }
  }
  v.seenTick = Math.max(v.seenTick, tick ?? s.tick)
  return v
}

const bookSize = (s: State) => [...s.book.values()].reduce((n, offers) => n + offers.size, 0)

function dropOffer(s: State, o: BookOffer) {
  const offers = s.book.get(o.venue)
  if (!offers) return
  offers.delete(o.id)
  if (!offers.size) s.book.delete(o.venue)
}

/** Offers past their expiry tick are gone: the game expires them when `expires_tick < tick`. */
function expireBook(s: State, tick: number) {
  for (const offers of s.book.values()) {
    for (const o of offers.values()) if (o.expiresTick != null && o.expiresTick < tick) dropOffer(s, o)
  }
}

function offerListed(s: State, e: GameEvent) {
  const p = e.payload
  const offer: Payload = p.offer ?? {}
  if (typeof offer.id !== 'number') return
  const venue: string = p.venue ?? offer.venue ?? 'direct'
  const now = Math.max(s.tick, e.tick ?? 0)
  const expiresTick: number | null = offer.expires_tick ?? null
  expireBook(s, now)
  // a replayed backlog can list offers that expired long ago
  if (expiresTick != null && expiresTick < now) return
  const assets: Payload[] = offer.give?.assets ?? []
  const side = offer.want?.cash ? 'ask' : offer.give?.cash ? 'bid' : 'swap'
  const goods: Payload | undefined = side === 'bid' ? offer.want : offer.give
  const first: Payload | undefined = goods?.assets?.[0]
  let offers = s.book.get(venue)
  if (!offers) s.book.set(venue, (offers = new Map()))
  offers.set(offer.id, {
    id: offer.id, eventId: e.id, venue, maker: offer.maker ?? e.actor ?? '?', to: typeof offer.to === 'string' ? offer.to : null, side,
    ref: side === 'bid' ? topicOf({ want: offer.want }) : topicOf({ give: offer.give }),
    kind: first?.kind ?? goods?.types?.[0]?.split(':')[0] ?? 'card',
    assetIds: assets.map((a) => a.id).filter((id) => typeof id === 'number'),
    serial: first?.serial ?? null, price: priceOf(offer), createdTick: offer.created_tick ?? e.tick, expiresTick,
  })
  if (venue !== 'direct') touchVenue(s, venue, e.tick)
  let size = bookSize(s)
  if (size <= LIMITS.book) return
  const oldest = [...s.book.values()].flatMap((o) => [...o.values()]).sort((a, b) => a.id - b.id)
  for (const o of oldest) {
    if (size-- <= LIMITS.book) break
    dropOffer(s, o)
  }
}

/**
 * A settlement names no offer, so the board guesses which one it filled: any offer giving a copy that
 * moved is stale, and on that venue the buyer's bid for the card goes too (at that price, else the highest).
 */
function dropFilled(s: State, venue: unknown, item: Payload, price: number) {
  for (const offers of s.book.values()) {
    for (const o of offers.values()) if (o.assetIds.includes(item.id)) dropOffer(s, o)
  }
  if (typeof venue !== 'string') return
  const bids = [...(s.book.get(venue)?.values() ?? [])].filter((o) => o.side === 'bid' && o.maker === item.to && o.ref === item.ref)
  const filled = bids.find((o) => o.price === price) ?? bids.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))[0]
  if (filled) dropOffer(s, filled)
}

function venueEvent(s: State, e: GameEvent) {
  const p = e.payload
  if (typeof p.venue !== 'string') return
  const v = touchVenue(s, p.venue, e.tick)
  if (p.name) v.name = p.name
  if (p.fee_bps != null && e.type !== 'venue.fee_announced') v.feeBps = p.fee_bps
  if (p.fee_per_card != null && e.type !== 'venue.fee_announced') v.feePerCard = p.fee_per_card
  switch (e.type) {
    case 'venue.opened':
      v.owner = p.owner ?? v.owner
      v.status = 'open'
      v.openedTick = e.tick ?? s.tick
      break
    case 'venue.announcement':
      v.announcement = { eventId: e.id, tick: e.tick, text: p.text ?? '' }
      v.announcements += 1
      break
    case 'venue.closing':
      // closing cancels every open offer of the venue, with no offer.cancelled for each
      v.status = 'closing'
      s.book.delete(p.venue)
      break
    case 'venue.closed':
      v.status = 'closed'
      s.book.delete(p.venue)
      break
  }
}

function settlementFailed(s: State, e: GameEvent, ours: boolean) {
  const p = e.payload
  const o = findOffer(s, p.offer)
  push(s.failed, {
    eventId: e.id, tick: e.tick, offer: typeof p.offer === 'number' ? p.offer : null, reason: p.reason ?? '?',
    venue: o?.venue ?? null, ref: o?.ref ?? null, ours,
  }, LIMITS.failed)
  if (o) dropOffer(s, o)
}

const duelOf = (s: State, p: Payload): Duel => (s.duels[p.duel] ??= {
  id: p.duel, role: p.role ?? '?', rival: null, item: null, deadlineTick: null, session: null, ourPrice: null, theirPrice: null, ourDays: null, theirDays: null,
  rounds: 0, status: 'open', dealPrice: null, points: null, lastEventId: null,
  limit: null, decay: null, gain: null, finalRounds: null, offers: [], startTick: null, closedTick: null,
})

const numOr = (v: unknown, or: number | null): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : or)

/** The payload's `rival`; for an event without one, a message's sender when it is neither us nor the bare "rival". */
function noteRival(s: State, d: Duel, p: Payload) {
  if (typeof p.rival === 'string' && p.rival) d.rival = p.rival
  else if (d.rival === null && typeof p.sender === 'string' && p.sender && p.sender !== s.team && p.sender !== 'rival') d.rival = p.sender
}

/** A duel opens: what is at stake and until when, so it shows while live even before anyone speaks. */
function duelStarted(s: State, e: GameEvent) {
  const p = e.payload
  const d = duelOf(s, p)
  noteRival(s, d, p)
  if (typeof p.role === 'string' && p.role) d.role = p.role
  if (typeof p.item === 'string' && p.item) d.item = p.item
  if (typeof p.deadline_tick === 'number') d.deadlineTick = p.deadline_tick
  if (typeof p.session === 'number') d.session = p.session
  d.limit = numOr(p.limit, d.limit)
  d.decay = numOr(p.decay, d.decay)
  d.startTick ??= typeof e.tick === 'number' ? e.tick : null
  d.lastEventId ??= e.id
}

function duelMessage(s: State, e: GameEvent) {
  const p = e.payload
  const d = duelOf(s, p)
  noteRival(s, d, p)
  const side = p.sender === s.team ? 'us' : 'them'
  if (side === 'us') [d.ourPrice, d.ourDays] = [p.price ?? null, p.days ?? null]
  else [d.theirPrice, d.theirDays] = [p.price ?? null, p.days ?? null]
  push(d.offers, { tick: typeof e.tick === 'number' ? e.tick : null, side, price: numOr(p.price, null), days: numOr(p.days, null) }, LIMITS.duelOffers)
  d.startTick ??= typeof e.tick === 'number' ? e.tick : null
  d.rounds += 1
  d.lastEventId = e.id
}

function duelResult(s: State, e: GameEvent) {
  const d = duelOf(s, e.payload)
  noteRival(s, d, e.payload)
  d.status = e.payload.deal ? 'deal' : 'no deal'
  d.dealPrice = e.payload.price ?? null
  d.points = e.payload.points ?? null
  d.gain = numOr(e.payload.gain, d.gain)
  d.limit = numOr(e.payload.limit, d.limit)
  d.finalRounds = numOr(e.payload.rounds, d.finalRounds)
  d.closedTick = typeof e.tick === 'number' ? e.tick : d.closedTick
  d.lastEventId = e.id
}

function me(s: State, e: GameEvent) {
  const p = e.payload
  s.cash = p.cash ?? s.cash
  if (p.score) s.score = p.score
  if (p.album?.pages) s.pages = p.album.pages
  if (p.affinity && typeof p.affinity === 'object') {
    s.affinity = {}
    for (const [set, x] of Object.entries(p.affinity as Payload)) if (typeof x === 'number' && Number.isFinite(x)) s.affinity[set] = x
  }
  // the assets are all we hold: holding no card at all empties the album too
  if (Array.isArray(p.assets)) {
    s.owned = {}
    s.values = {}
    s.packs = []
    for (const a of p.assets as Payload[]) {
      if (a?.kind === 'card') {
        (s.owned[a.ref] ??= []).push({ id: a.id, serial: a.serial })
        s.values[a.ref] = a.your_value ?? 0
      } else if (a?.kind === 'pack') {
        s.packs.push({ id: a.id, ref: a.ref ?? '?', name: a.name ?? a.ref ?? '?' })
      }
    }
  }
  s.meEventId = e.id
  push(s.history, { tick: e.tick ?? s.tick, score: s.score.score ?? 0, cash: s.cash }, LIMITS.history)
}

/** The relayed reports, one per agent we know; anything else in the payload is dropped. */
function health(s: State, p: Payload): void {
  const agents: unknown[] = Array.isArray(p.agents) ? p.agents : []
  s.health = HEALTH_AGENTS.flatMap((a) => {
    const r = agents.find((x): x is HealthReport => typeof x === 'object' && x !== null && (x as HealthReport).agent === a)
    return r && typeof r.checkedAt === 'string' ? [{ ...r, since: typeof r.since === 'object' && r.since !== null ? r.since : {} }] : []
  })
}

export function apply(s: State, e: GameEvent): State {
  const p = (e.payload ??= {})
  // A status every 10 s: only the latest counts, so it never fills the event lists (nor the Debug screen's).
  if (e.type === 'agent.health') {
    health(s, p)
    return s
  }
  // The same kind of status: only the latest says when each screen's rows last changed.
  if (e.type === 'pages.changed') {
    s.changes = Object.fromEntries(Object.entries(p).filter((kv): kv is [string, string] => typeof kv[1] === 'string'))
    return s
  }
  const tick = e.tick ?? s.tick
  s.events.push(e)
  s.byId.set(e.id, e)
  while (s.events.length > LIMITS.events) {
    const old = s.events.shift()
    if (old && s.byId.get(old.id) === old && !s.mine.includes(old)) s.byId.delete(old.id)
  }
  const ours = isOurs(s, e)
  if (ours) {
    s.mine.push(e)
    while (s.mine.length > LIMITS.mine) {
      const old = s.mine.shift()
      if (old && s.byId.get(old.id) === old && !s.events.includes(old)) s.byId.delete(old.id)
    }
  }
  switch (e.type) {
    case 'agent.hello':
      s.team = p.team ?? s.team
      s.name = p.name ?? s.name
      break
    case 'clock':
      s.tick = tick
      s.day = p.day ?? s.day
      s.tickSeconds = p.tick_seconds ?? s.tickSeconds
      expireBook(s, s.tick)
      break
    case 'agent.phase':
      s.phase = p.phase ?? s.phase
      s.goal = p.goal ?? s.goal
      break
    case 'agent.thought':
      push(s.log, { eventId: e.id, tick, kind: 'thought', text: p.text ?? '' }, LIMITS.log)
      break
    case 'agent.action':
      push(s.log, { eventId: e.id, tick, kind: p.kind ?? 'act', text: p.summary ?? '' }, LIMITS.log)
      break
    case 'agent.me':
      me(s, e)
      break
    case 'offer.listed':
      offerListed(s, e)
      break
    case 'offer.cancelled': {
      const o = findOffer(s, p.offer, p.venue)
      if (o) dropOffer(s, o)
      break
    }
    case 'settlement.failed':
      settlementFailed(s, e, ours)
      break
    case 'venue.opened':
    case 'venue.announcement':
    case 'venue.fee_announced':
    case 'venue.fee_changed':
    case 'venue.closing':
    case 'venue.closed':
      venueEvent(s, e)
      break
    case 'pack.opened':
      push(s.packsOpened, { eventId: e.id, tick: e.tick, team: p.team ?? '?', name: p.name ?? p.team ?? '?', pack: p.pack ?? '?', best: p.best ?? null }, LIMITS.packsOpened)
      break
    case 'gift.given':
      push(s.gifts, {
        eventId: e.id, tick: e.tick, team: p.team ?? '?', from: e.actor || '?', cash: p.cash ?? 0,
        packs: p.packs ?? [], cards: p.cards ?? [], reason: p.reason ?? '',
      }, LIMITS.gifts)
      break
    case 'thread.opened':
      push(s.opened, {
        eventId: e.id, tick: e.tick, thread: p.thread, kind: p.kind ?? '?', team: p.team ?? '?', with: p.with ?? '?',
        topic: p.topic && typeof p.topic === 'object' ? p.topic : null,
      }, LIMITS.opened)
      break
    case 'thread.message':
      threadMessage(s, e)
      break
    case 'thread.closed': {
      const th = s.threads[p.thread]
      if (th) {
        th.status = 'closed'
        th.closedTick ??= e.tick ?? null
        // a settlement's `deal` stays: the mock closes a thread after settling it
        if (th.closedReason !== 'deal') th.closedReason = typeof p.reason === 'string' ? p.reason : null
      }
      break
    }
    case 'settlement':
      settlement(s, e)
      break
    case 'duel.started':
      if (ours) duelStarted(s, e)
      break
    case 'duel.message':
      if (ours) duelMessage(s, e)
      break
    case 'duel.result':
      if (ours) duelResult(s, e)
      break
    case 'agent.decision':
      applyDecision(s.agents, e)
      break
    case 'agent.outcome':
      applyOutcome(s.agents, e)
      break
    case 'agent.ledger':
      applyLedger(s.agents, e)
      break
  }
  return s
}
