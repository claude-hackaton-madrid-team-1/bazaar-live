/**
 * What the Negotiations screen answers, per thread: is it going well and will it close (their price against
 * our value and our guardrail cap, the trend, the ticks left), what our agent decided last and why, and for the
 * ended ones how it ended against our value. Plus the duels, with only the columns that say something.
 */
import type { DecisionStatus } from '../../../shared/decisions.ts'
import type { DecisionRow } from '../decisions.ts'
import { isSuspicious, rarityOf, setOf } from '../game.ts'
import type { Duel, State, Thread } from '../state.ts'

export type ThreadRow = {
  id: number
  with: string
  topic: string
  set: { name: string; color: string } | null
  side: 'buy' | 'sell'
  theirPrice: number | null
  ourPrice: number | null
  theirLabel: 'ask' | 'bid'
  ourLabel: 'ask' | 'bid'
  gap: number | null
  rounds: number
  final: boolean
  expiresIn: number | null
  /** Open until it closed, settled, was scored, or its last offer lapsed. */
  status: 'open' | 'closed'
  lastText: string | null
  suspicious: boolean
  lastEventId: number | null
  lastTick: number | null
  /** The tactics our messages used, in the order we first used them (`plain`: our usual words). */
  tactics: string[]
}

export type Bubble = {
  round: number
  eventId: number
  tick: number | null
  side: 'us' | 'them'
  price: number | null
  offerId: number | null
  messageId: number | null
  maker: string
  to: string
  createdTick: number | null
  expiresTick: number | null
  final: boolean
  assets: number[]
  text: string | null
  /** The tactic our agent picked for these words; null for theirs, or when nobody recorded one. */
  tactic: string | null
  suspicious: boolean
}

export type Conversation = { thread: ThreadRow; bubbles: Bubble[]; lastText: string | null }

/**
 * The pill: won / lost once it ended; while live, stuck (their price is past our cap: it cannot close unless they
 * move), closing (the gap is small or closes within two rounds at this pace), expiring (quiet and about to lapse),
 * else haggling.
 */
export type NegStatus = 'won' | 'lost' | 'stuck' | 'closing' | 'expiring' | 'haggling'

export type Cap = {
  readonly cap: number
  /** The guardrail rule, e.g. `max_price_rare`. */
  readonly rule: string
  /** True when a decision of this very thread was denied by it; false when read off another card of the same rarity. */
  readonly own: boolean
}

export type Next = {
  readonly action: 'bid' | 'ask' | 'accept' | 'walk' | 'open' | 'other'
  readonly kind: string
  readonly price: number | null
  readonly status: DecisionStatus
  readonly rule: string | null
  readonly text: string | null
  readonly tick: number
}

export type Trend = {
  /** Their move per round towards us (down for an ask, up for a bid); 0 when they hold, null with under two prices. */
  readonly theirStep: number | null
  /** Our move per round towards them. */
  readonly ourStep: number | null
  /** Rounds until the prices meet at the current pace; null when they do not converge. */
  readonly roundsToMeet: number | null
  readonly theirs: number[]
  readonly ours: number[]
}

export type Ended = {
  readonly how: 'deal' | 'walked' | 'idle' | 'expired' | 'closed'
  readonly price: number | null
  /** What the deal made against our value: positive is good for us. */
  readonly edge: number | null
  readonly firstAsk: number | null
}

export type Verdict =
  | { readonly kind: 'capBelow'; readonly cap: number; readonly ask: number; readonly own: boolean; readonly roundsToCap: number | null }
  | { readonly kind: 'overValue'; readonly value: number; readonly ask: number }
  | { readonly kind: 'closing'; readonly gap: number }
  | { readonly kind: 'pace'; readonly step: number; readonly gap: number; readonly rounds: number | null }
  | { readonly kind: 'holding'; readonly gap: number }
  | { readonly kind: 'apart'; readonly gap: number }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'won'; readonly price: number; readonly value: number | null; readonly edge: number | null }
  | { readonly kind: 'lost'; readonly how: Ended['how'] }

export type NegRow = ThreadRow & {
  readonly state: NegStatus
  /** What the card is worth to us: the latest value our agent decided with, else /me's. */
  readonly value: number | null
  readonly cap: Cap | null
  readonly ticksLeft: number | null
  readonly trend: Trend
  readonly next: Next | null
  readonly ended: Ended | null
  readonly verdict: Verdict
}

/** `ticksLeft`: until the deadline, for a live duel whose deadline we know; null otherwise. */
export type DuelRow = Duel & { gap: number | null; tone: 'neutral' | 'good' | 'bad'; ticksLeft: number | null }

const gapOf = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : Math.abs(a - b))

const round1 = (v: number): number => Math.round(v * 10) / 10

// ---------------------------------------------------------------- decisions joined to a thread

/** Rows that only log what happened, never a choice: they say nothing about what the agent does next. */
const BOOKKEEPING = /^(process_started|.*_opened|.*_closed)$/

const decisionsOf = (s: State): DecisionRow[] => [...s.agents.decisions.taker, ...s.agents.decisions.maker]

/** When the thread started: its thread.opened, else its first offer. */
function startOf(s: State, th: Thread): number {
  const opened = s.opened.find((o) => o.thread === th.id)?.tick
  return opened ?? th.offers[0]?.tick ?? 0
}

/**
 * A decision carries no thread id: it is this thread's when it names the same counterparty and item, from the
 * thread's start to the start of our next thread with that counterparty about that item.
 */
export function threadDecisions(s: State, th: Thread): DecisionRow[] {
  const start = startOf(s, th)
  const next = Object.values(s.threads)
    .filter((o) => o.id !== th.id && o.with === th.with && o.topic === th.topic)
    .map((o) => startOf(s, o))
    .filter((t) => t > start)
  const end = next.length ? Math.min(...next) : Infinity
  return decisionsOf(s)
    .filter((d) => d.counterparty === th.with && d.item === th.topic && d.tick >= start && d.tick < end)
    .sort((a, b) => a.decision - b.decision)
}

/** Our value: the latest one our agent decided with in this thread, else for this item anywhere, else /me's (held cards). */
export function valueOf(s: State, th: Thread, own: DecisionRow[] = threadDecisions(s, th)): number | null {
  const inThread = own.filter((d) => d.value != null).at(-1)?.value
  if (inThread != null) return inThread
  const anywhere = decisionsOf(s).filter((d) => d.item === th.topic && d.value != null).sort((a, b) => a.decision - b.decision).at(-1)?.value
  if (anywhere != null) return anywhere
  return s.values[th.topic] ?? null
}

const CAP_TEXT = /\b(max_price_[a-z]+) (\d+(?:\.\d+)?)/

/**
 * Our cap for this card: the views carry no cap, only the denials' text (`price 31 > max_price_uncommon 26`). A denial
 * in this thread wins; else the latest denial naming the cap of the card's rarity, from any card.
 */
export function capOf(s: State, th: Thread, own: DecisionRow[] = threadDecisions(s, th)): Cap | null {
  const read = (d: DecisionRow): { rule: string; cap: number } | null => {
    const m = d.text?.match(CAP_TEXT)
    return m?.[1] && m[2] ? { rule: m[1], cap: Number(m[2]) } : null
  }
  for (const d of [...own].reverse()) {
    const c = d.verdict === 'denied' ? read(d) : null
    if (c) return { ...c, own: true }
  }
  const rarity = rarityOf(th.topic)
  if (!rarity) return null
  const rule = `max_price_${rarity}`
  const all = decisionsOf(s).sort((a, b) => b.decision - a.decision)
  for (const d of all) {
    const c = read(d)
    if (c?.rule === rule) return { ...c, own: false }
  }
  return null
}

const ACTION: Readonly<Record<string, Next['action']>> = {
  dealer_bid: 'bid', dealer_ask: 'ask', dealer_accept: 'accept', dealer_walk: 'walk', dealer_open: 'open',
  accept_ask: 'accept', accept_bid: 'accept', post_ask: 'ask', post_bid: 'bid',
}

/** The latest real choice of our agent in this thread (not a bookkeeping row). */
export function nextOf(own: DecisionRow[]): Next | null {
  const d = own.filter((r) => !BOOKKEEPING.test(r.kind)).at(-1)
  if (!d) return null
  return { action: ACTION[d.kind] ?? 'other', kind: d.kind, price: d.price, status: d.status, rule: d.rule, text: d.text, tick: d.tick }
}

// ---------------------------------------------------------------- trend, end, status

/** Per-round move from first to last, signed so positive is towards the other side. */
const stepOf = (prices: number[], towards: 1 | -1): number | null =>
  prices.length < 2 ? null : round1((((prices.at(-1) as number) - (prices[0] as number)) * towards) / (prices.length - 1))

export function trendOf(th: Thread): Trend {
  const theirs = th.offers.filter((o) => o.side === 'them' && o.price != null).map((o) => o.price as number)
  const ours = th.offers.filter((o) => o.side === 'us' && o.price != null).map((o) => o.price as number)
  const buying = th.side === 'buy'
  // buying: their ask comes down, our bid goes up; selling the other way round. The pace is the recent one (the
  // last two moves): a dealer who came down fast and now holds is holding.
  const theirStep = stepOf(theirs.slice(-3), buying ? -1 : 1)
  const ourStep = stepOf(ours.slice(-3), buying ? 1 : -1)
  const gap = gapOf(th.theirPrice, th.ourPrice)
  const pace = Math.max(0, theirStep ?? 0) + Math.max(0, ourStep ?? 0)
  const roundsToMeet = gap == null ? null : gap === 0 ? 0 : pace > 0 ? Math.ceil(gap / pace) : null
  return { theirStep, ourStep, roundsToMeet, theirs, ours }
}

/** How a thread ended, or null while it is live. Its scored outcome (`thread:<id>`) is a direct join. */
export function endedOf(s: State, th: Thread, value: number | null, own: DecisionRow[] = threadDecisions(s, th)): Ended | null {
  const outcome = s.agents.outcomes.find((o) => o.subject === `thread:${th.id}`)
  const price = th.dealPrice ?? outcome?.price ?? null
  const firstAsk = th.offers.find((o) => o.side === 'them' && o.price != null)?.price ?? null
  if (price != null) {
    const edge = value == null ? null : round1(th.side === 'buy' ? value - price : price - value)
    return { how: 'deal', price, edge, firstAsk }
  }
  const walked = own.some((d) => d.kind === 'dealer_walk' && d.status !== 'rejected')
  const lapsed = th.expiresTick != null && th.expiresTick < s.tick
  if (!outcome && th.status !== 'closed' && !lapsed) return null
  const how: Ended['how'] = walked ? 'walked' : th.closedReason === 'idle' ? 'idle' : th.status === 'closed' || outcome ? 'closed' : 'expired'
  return { how, price: null, edge: null, firstAsk }
}

/** A gap this small closes on the next move or two. */
const smallGap = (gap: number, their: number): boolean => gap <= Math.max(2, Math.round(their * 0.1))

export function statusOf(r: {
  side: 'buy' | 'sell'
  theirPrice: number | null
  gap: number | null
  cap: Cap | null
  ended: Ended | null
  trend: Pick<Trend, 'roundsToMeet'>
  ticksLeft: number | null
  quiet: number | null
  /** Our value: a price on the wrong side of it is not about to close, however small the gap. */
  value?: number | null
}): NegStatus {
  if (r.ended) return r.ended.how === 'deal' ? 'won' : 'lost'
  if (r.side === 'buy' && r.cap && r.theirPrice != null && r.theirPrice > r.cap.cap) return 'stuck'
  const worth = r.value == null || r.theirPrice == null || (r.side === 'buy' ? r.theirPrice <= r.value : r.theirPrice >= r.value)
  if (worth && r.gap != null && r.theirPrice != null && (smallGap(r.gap, r.theirPrice) || (r.trend.roundsToMeet != null && r.trend.roundsToMeet <= 2))) return 'closing'
  // quiet for two ticks with at most one left: it lapses unless someone moves
  if (r.ticksLeft != null && r.ticksLeft <= 1 && (r.quiet ?? 0) >= 2) return 'expiring'
  return 'haggling'
}

export function verdictOf(r: Pick<NegRow, 'state' | 'side' | 'theirPrice' | 'gap' | 'cap' | 'value' | 'trend' | 'ended'>): Verdict {
  if (r.ended) {
    return r.ended.how === 'deal' && r.ended.price != null
      ? { kind: 'won', price: r.ended.price, value: r.value, edge: r.ended.edge }
      : { kind: 'lost', how: r.ended.how }
  }
  const ask = r.theirPrice
  if (r.state === 'stuck' && r.cap && ask != null) {
    const step = r.trend.theirStep
    const roundsToCap = step != null && step > 0 ? Math.ceil((ask - r.cap.cap) / step) : null
    return { kind: 'capBelow', cap: r.cap.cap, ask, own: r.cap.own, roundsToCap }
  }
  if (r.side === 'buy' && ask != null && r.value != null && ask > r.value) return { kind: 'overValue', value: r.value, ask }
  if (r.gap == null) return { kind: 'waiting' }
  if (r.state === 'closing') return { kind: 'closing', gap: r.gap }
  const step = r.trend.theirStep
  if (step != null && step > 0) return { kind: 'pace', step, gap: r.gap, rounds: r.trend.roundsToMeet }
  // one price of theirs says nothing yet about whether they move
  return step == null ? { kind: 'apart', gap: r.gap } : { kind: 'holding', gap: r.gap }
}

// ---------------------------------------------------------------- rows

const lastEvent = (th: Thread): number => th.offers.at(-1)?.eventId ?? th.id

function row(s: State, th: Thread, ended: boolean): ThreadRow {
  const last = th.offers.at(-1)
  const buying = th.side === 'buy'
  return {
    id: th.id, with: th.with, topic: th.topic, set: setOf(th.topic), side: th.side,
    theirPrice: th.theirPrice, ourPrice: th.ourPrice,
    theirLabel: buying ? 'ask' : 'bid', ourLabel: buying ? 'bid' : 'ask',
    gap: gapOf(th.theirPrice, th.ourPrice), rounds: th.rounds, final: th.final,
    expiresIn: !ended && th.expiresTick != null ? th.expiresTick - s.tick : null,
    status: ended ? 'closed' : 'open', lastText: th.lastText, suspicious: isSuspicious(th.lastText),
    lastEventId: last?.eventId ?? null, lastTick: last?.tick ?? null, tactics: tacticsOf(th),
  }
}

const tacticsOf = (th: Thread): string[] => [...new Set(th.offers.flatMap((o) => (o.side === 'us' && o.tactic ? [o.tactic] : [])))]

export function negRow(s: State, th: Thread): NegRow {
  const own = threadDecisions(s, th)
  const value = valueOf(s, th, own)
  const ended = endedOf(s, th, value, own)
  const base = row(s, th, ended != null)
  const cap = th.side === 'buy' ? capOf(s, th, own) : null
  const trend = trendOf(th)
  const quiet = base.lastTick == null ? null : s.tick - base.lastTick
  const state = statusOf({ ...base, cap, ended, trend, ticksLeft: base.expiresIn, quiet, value })
  const partial = { ...base, state, value, cap, ticksLeft: base.expiresIn, trend, next: ended ? null : nextOf(own), ended }
  return { ...partial, verdict: verdictOf(partial) }
}

/**
 * Every thread of ours: the live ones newest first, in a stable order (a card that jumps on every move cannot
 * be watched), then the ended ones by their last activity.
 */
export function negRows(s: State): NegRow[] {
  const rows = Object.values(s.threads).map((th) => negRow(s, th))
  const live = rows.filter((r) => r.status === 'open').sort((a, b) => b.id - a.id)
  const last = (r: NegRow) => (s.threads[r.id] ? lastEvent(s.threads[r.id] as Thread) : r.id)
  const ended = rows.filter((r) => r.status !== 'open').sort((a, b) => last(b) - last(a) || b.id - a.id)
  return [...live, ...ended]
}

export function threadList(s: State): ThreadRow[] {
  return negRows(s)
}

export function selectedThreadId(s: State, requested: string | null): number | null {
  const n = requested ? Number(requested) : NaN
  if (Number.isInteger(n) && s.threads[n]) return n
  return negRows(s)[0]?.id ?? null
}

export function conversation(s: State, id: number): Conversation | null {
  const th = s.threads[id]
  if (!th) return null
  const bubbles = th.offers.map((o, i): Bubble => {
    const raw = s.byId.get(o.eventId)?.payload?.text
    const text = typeof raw === 'string' && raw ? raw : null
    return {
      round: i + 1, eventId: o.eventId, tick: o.tick ?? null, side: o.side, price: o.price,
      offerId: o.offerId, messageId: o.messageId, maker: o.maker, to: o.to,
      createdTick: o.createdTick, expiresTick: o.expiresTick, final: o.final, assets: o.assets,
      text, tactic: o.side === 'us' ? o.tactic : null, suspicious: o.side === 'them' && isSuspicious(text),
    }
  })
  return { thread: negRow(s, th), bubbles, lastText: th.lastText }
}

// ---------------------------------------------------------------- what worked, per dealer

export type TacticTally = { readonly tactic: string; readonly threads: number; readonly deals: number }

/** Per counterparty, the tactics of our ended threads: in how many we used each, and how many of those closed a deal. */
export type DealerTactics = { readonly with: string; readonly threads: number; readonly deals: number; readonly tactics: TacticTally[] }

/**
 * What worked with whom: the ended threads that used any tactic, grouped by counterparty (most threads first), each
 * tactic with its threads and deals (most deals, then most used, first). A thread counts once per tactic it used.
 */
export function dealerTactics(s: State, rows: readonly NegRow[] = negRows(s)): DealerTactics[] {
  const by = new Map<string, { threads: number; deals: number; tactics: Map<string, { threads: number; deals: number }> }>()
  for (const r of rows) {
    if (r.ended == null || !r.tactics.length) continue
    const deal = r.ended.how === 'deal' ? 1 : 0
    const d = by.get(r.with) ?? { threads: 0, deals: 0, tactics: new Map() }
    d.threads += 1
    d.deals += deal
    for (const tactic of r.tactics) {
      const t = d.tactics.get(tactic) ?? { threads: 0, deals: 0 }
      t.threads += 1
      t.deals += deal
      d.tactics.set(tactic, t)
    }
    by.set(r.with, d)
  }
  return [...by]
    .map(([who, d]) => ({
      with: who, threads: d.threads, deals: d.deals,
      tactics: [...d.tactics].map(([tactic, t]) => ({ tactic, ...t })).sort((a, b) => b.deals - a.deals || b.threads - a.threads || a.tactic.localeCompare(b.tactic)),
    }))
    .sort((a, b) => b.threads - a.threads || a.with.localeCompare(b.with))
}

// ---------------------------------------------------------------- duels

const ticksLeftOf = (d: Duel, tick: number): number | null =>
  d.status === 'open' && d.deadlineTick !== null && tick > 0 ? Math.max(0, d.deadlineTick - tick) : null

const toneOf = (d: Duel): DuelRow['tone'] => (d.status === 'deal' ? 'good' : d.status === 'no deal' ? 'bad' : 'neutral')

export function duelRows(s: State): DuelRow[] {
  const all = Object.values(s.duels)
  const order = (a: Duel, b: Duel) => b.id - a.id
  return [...all.filter((d) => d.status === 'open').sort(order), ...all.filter((d) => d.status !== 'open').sort(order)]
    .map((d) => ({ ...d, gap: gapOf(d.ourPrice, d.theirPrice), tone: toneOf(d), ticksLeft: ticksLeftOf(d, s.tick) }))
}

/** The optional duel columns worth a column: not when every row is empty (days and points from our database) or the same. */
export type DuelColumns = { readonly role: boolean; readonly days: boolean; readonly points: boolean }

export function duelColumns(rows: DuelRow[]): DuelColumns {
  return {
    role: new Set(rows.map((d) => d.role)).size > 1,
    days: rows.some((d) => d.ourDays != null || d.theirDays != null),
    points: rows.some((d) => d.points != null),
  }
}

export type RivalRow = {
  /** The rival's alias; null groups the duels whose rival we never heard. */
  rival: string | null
  duels: number
  open: number
  finished: number
  deals: number
  noDeals: number
  /** Points won against it, summed over the results that carry them; null when none does (our database never has them). */
  points: number | null
}

/** Who we duel: one row per rival, the ones with a live duel first, then the most duelled, then by name (unknown last). */
export function rivalSummary(s: State): RivalRow[] {
  const by = new Map<string | null, RivalRow>()
  for (const d of Object.values(s.duels)) {
    const r = by.get(d.rival) ?? { rival: d.rival, duels: 0, open: 0, finished: 0, deals: 0, noDeals: 0, points: null }
    r.duels += 1
    if (d.status === 'open') r.open += 1
    else r.finished += 1
    if (d.status === 'deal') r.deals += 1
    if (d.status === 'no deal') r.noDeals += 1
    if (d.points != null) r.points = Math.round(((r.points ?? 0) + d.points) * 100) / 100
    by.set(d.rival, r)
  }
  const byName = (a: RivalRow, b: RivalRow) => (a.rival === null ? 1 : b.rival === null ? -1 : a.rival.localeCompare(b.rival))
  return [...by.values()].sort((a, b) => b.open - a.open || b.duels - a.duels || byName(a, b))
}
