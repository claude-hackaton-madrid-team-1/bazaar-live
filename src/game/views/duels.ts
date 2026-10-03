/**
 * What the Duels screen answers. Per live duel: is their price inside our limit (the key question), how far apart we
 * are, what the rounds have cost already, how long is left, and what the duels agent did last. Then the record per
 * rival and per session, every finished duel in one line, and whether the duels agent is alive.
 *
 * The rules are the duels agent's (bazaar GUARDRAILS.md, duel_policy v2): a deal outside our limit loses points, so
 * `duel_inside_limit` refuses any offer or accept not STRICTLY inside it; every round of talk keeps (1 − decay) of
 * the deal's value; v2 plans its one accept per tick by the deadline − 2 (`duel_accept_margin_ticks` = 1).
 */
import type { DecisionStatus } from '../../../shared/decisions.ts'
import { setOfName } from '../cards.ts'
import type { DecisionRow } from '../decisions.ts'
import type { Duel, State } from '../state.ts'
import { agentStatuses, isWrite, nowTick, type AgentStatus } from './decisions.ts'

/** v2 plans every accept by the deadline minus 1 minus `duel_accept_margin_ticks` (1). */
export const ACCEPT_BY_TICKS = 2

/** A live duel this close to its deadline, outside our limit, will end with no deal unless they jump. */
export const EXPIRING_TICKS = 2

/**
 * The pill. `inside`: their price is strictly inside our limit, the agent can take it (v2 plans the accept by the
 * deadline − 2); `haggling`: outside, but they are coming our way fast enough to cross it in time (or have not priced
 * yet); `outside`: outside and they hold, or cannot cross it before the deadline at their pace; `expiring`: outside
 * with two ticks or fewer left.
 */
export type DuelState = 'inside' | 'haggling' | 'outside' | 'expiring'

export type DuelAction = 'offer' | 'accept' | 'hold' | 'other'

export type DuelDecision = {
  readonly action: DuelAction
  readonly kind: string
  /** Our priced message at that tick (an offer carries no price in the decisions view: it would print our limit). */
  readonly price: number | null
  readonly status: DecisionStatus
  readonly rule: string | null
  readonly error: string | null
  readonly tick: number
}

export type LiveDuel = {
  readonly id: number
  readonly rival: string | null
  readonly side: 'buy' | 'sell'
  readonly item: string | null
  readonly set: { name: string; color: string } | null
  readonly session: number | null
  readonly theirPrice: number | null
  readonly ourPrice: number | null
  readonly gap: number | null
  /** Their days and ours, in a two-issue duel (price and delivery day); null otherwise. */
  readonly theirDays: number | null
  readonly ourDays: number | null
  readonly limit: number | null
  /** Strictly inside our limit (price only: the days weight stays private); null without their price or our limit. */
  readonly inside: boolean | null
  /** Their price against our limit: positive is what a deal now would make us before decay, negative how far outside. */
  readonly margin: number | null
  /** The game's rounds so far: the fewer priced messages of the two sides. */
  readonly rounds: number
  readonly decay: number | null
  /** The share of a deal's value the rounds have cost already (1 − (1 − decay)^rounds). */
  readonly decayShare: number | null
  /** What that share costs at their price, in P (only when their price is inside). */
  readonly decayCost: number | null
  /** What we would keep if we accepted their price now. */
  readonly keepNow: number | null
  readonly deadlineTick: number | null
  readonly ticksLeft: number | null
  /** When v2 plans to accept (deadline − 2), for a duel inside our limit. */
  readonly acceptBy: number | null
  /** Their move per message towards us (down when we buy, up when we sell), over their last three prices. */
  readonly theirStep: number | null
  /** Messages until their price crosses our limit at that pace; null when it is inside already or they hold. */
  readonly roundsToLimit: number | null
  readonly decision: DuelDecision | null
  readonly state: DuelState
}

export type FinishedDuel = {
  readonly id: number
  readonly rival: string | null
  readonly side: 'buy' | 'sell'
  readonly item: string | null
  readonly set: { name: string; color: string } | null
  readonly session: number | null
  readonly deal: boolean
  readonly price: number | null
  readonly limit: number | null
  /** The deal's price against our limit, before decay: positive is good for us. */
  readonly edge: number | null
  /** What the deal kept for us after decay (the game's result). */
  readonly gain: number | null
  /** Points, when the game gives them per duel (the simulator does; the real game scores only in /me). */
  readonly points: number | null
  readonly rounds: number
  readonly tick: number | null
}

export type Tally = {
  readonly duels: number
  readonly live: number
  readonly deals: number
  readonly noDeals: number
  /** Summed over the finished duels that carry it; null when none does. */
  readonly gain: number | null
  readonly points: number | null
}

export type RivalTally = Tally & { readonly rival: string | null }

export type SessionTally = Tally & { readonly session: number | null }

export type DuelRecord = {
  /** score.duel_points from our /me: what the game counts. */
  readonly scorePoints: number | null
  readonly total: Tally
  readonly rivals: RivalTally[]
  readonly sessions: SessionTally[]
}

export type DuelHealth = {
  readonly status: AgentStatus | null
  /** The tick of its last decision on any duel. */
  readonly lastTick: number | null
  readonly live: number
}

const round1 = (v: number): number => Math.round(v * 10) / 10

const round2 = (v: number): number => Math.round(v * 100) / 100

const sideOf = (d: Duel): 'buy' | 'sell' => (d.role === 'seller' ? 'sell' : 'buy')

/** Positive when `price` is good for us against `limit`: under our value when we buy, over our cost when we sell. */
const marginOf = (side: 'buy' | 'sell', price: number | null, limit: number | null): number | null =>
  price == null || limit == null ? null : round1(side === 'buy' ? limit - price : price - limit)

/** The game's rounds: the fewer priced messages of the two sides. */
export function roundsOf(d: Duel): number {
  if (d.finalRounds != null) return d.finalRounds
  const priced = d.offers.filter((o) => o.price != null)
  return Math.min(priced.filter((o) => o.side === 'us').length, priced.filter((o) => o.side === 'them').length)
}

const decisionsOf = (s: State, id: number): DecisionRow[] => s.agents.decisions.duels.filter((r) => r.item === `duel:${id}` && isWrite(r.kind))

const ACTION: Readonly<Record<string, DuelAction>> = { duel_offer: 'offer', duel_accept: 'accept', duel_hold: 'hold' }

/** The duels agent's last call on this duel, with the price we sent at that tick (or our last one before it). */
export function lastDecision(s: State, d: Duel): DuelDecision | null {
  const r = decisionsOf(s, d.id).at(-1)
  if (!r) return null
  const action = ACTION[r.kind] ?? 'other'
  const ours = d.offers.filter((o) => o.side === 'us' && o.price != null && o.tick != null && o.tick <= r.tick)
  const price = action === 'offer' && r.status !== 'rejected' ? (ours.find((o) => o.tick === r.tick) ?? ours.at(-1))?.price ?? null : null
  return { action, kind: r.kind, price, status: r.status, rule: r.rule, error: r.error, tick: r.tick }
}

/** Their recent move per message towards us, signed so positive is towards us. */
function theirStepOf(d: Duel, side: 'buy' | 'sell'): number | null {
  const theirs = d.offers.filter((o) => o.side === 'them' && o.price != null).map((o) => o.price as number).slice(-3)
  if (theirs.length < 2) return null
  const move = ((theirs.at(-1) as number) - (theirs[0] as number)) / (theirs.length - 1)
  return round1(side === 'buy' ? -move : move)
}

export function stateOf(r: Pick<LiveDuel, 'inside' | 'ticksLeft' | 'theirPrice' | 'roundsToLimit'>): DuelState {
  if (r.inside) return 'inside'
  if (r.ticksLeft != null && r.ticksLeft <= EXPIRING_TICKS) return 'expiring'
  if (r.theirPrice == null) return 'haggling'
  if (r.roundsToLimit == null) return 'outside'
  return r.ticksLeft != null && r.roundsToLimit > r.ticksLeft ? 'outside' : 'haggling'
}

export function liveDuel(s: State, d: Duel, now = nowTick(s)): LiveDuel {
  const side = sideOf(d)
  const margin = marginOf(side, d.theirPrice, d.limit)
  const inside = margin == null ? null : margin > 0
  const rounds = roundsOf(d)
  const decayShare = d.decay == null ? null : round2(1 - (1 - d.decay) ** rounds)
  const keepNow = margin != null && margin > 0 && decayShare != null ? round1(margin * (1 - decayShare)) : null
  const decayCost = margin != null && margin > 0 && decayShare != null ? round1(margin * decayShare) : null
  const ticksLeft = d.deadlineTick == null || now <= 0 ? null : Math.max(0, d.deadlineTick - now)
  const theirStep = theirStepOf(d, side)
  const roundsToLimit = margin == null || margin > 0 || theirStep == null || theirStep <= 0 ? null : Math.ceil((-margin + 1) / theirStep)
  const base = {
    id: d.id, rival: d.rival, side, item: d.item, set: setOfName(d.item), session: d.session,
    theirPrice: d.theirPrice, ourPrice: d.ourPrice,
    gap: d.theirPrice == null || d.ourPrice == null ? null : Math.abs(d.theirPrice - d.ourPrice),
    theirDays: d.theirDays, ourDays: d.ourDays, limit: d.limit, inside, margin, rounds, decay: d.decay, decayShare, decayCost, keepNow,
    deadlineTick: d.deadlineTick, ticksLeft,
    acceptBy: inside && d.deadlineTick != null ? d.deadlineTick - ACCEPT_BY_TICKS : null,
    theirStep, roundsToLimit, decision: lastDecision(s, d),
  }
  return { ...base, state: stateOf(base) }
}

/** The live duels, the soonest deadline first (then by id, so the cards do not jump). */
export function liveDuels(s: State): LiveDuel[] {
  const now = nowTick(s)
  return Object.values(s.duels)
    .filter((d) => d.status === 'open')
    .map((d) => liveDuel(s, d, now))
    .sort((a, b) => (a.deadlineTick ?? Infinity) - (b.deadlineTick ?? Infinity) || a.id - b.id)
}

export function finishedDuel(d: Duel): FinishedDuel {
  const side = sideOf(d)
  const deal = d.status === 'deal'
  return {
    id: d.id, rival: d.rival, side, item: d.item, set: setOfName(d.item), session: d.session, deal,
    price: deal ? d.dealPrice : null, limit: d.limit, edge: deal ? marginOf(side, d.dealPrice, d.limit) : null,
    gain: d.gain, points: d.points, rounds: roundsOf(d), tick: d.closedTick,
  }
}

/** The finished duels, the most recent first. */
export function finishedDuels(s: State): FinishedDuel[] {
  return Object.values(s.duels)
    .filter((d) => d.status !== 'open')
    .sort((a, b) => (b.closedTick ?? -1) - (a.closedTick ?? -1) || b.id - a.id)
    .map(finishedDuel)
}

const addTo = (t: { duels: number; live: number; deals: number; noDeals: number; gain: number | null; points: number | null }, d: Duel) => {
  t.duels += 1
  if (d.status === 'open') t.live += 1
  if (d.status === 'deal') t.deals += 1
  if (d.status === 'no deal') t.noDeals += 1
  if (d.status !== 'open' && d.gain != null) t.gain = round1((t.gain ?? 0) + d.gain)
  if (d.status !== 'open' && d.points != null) t.points = round2((t.points ?? 0) + d.points)
}

const empty = () => ({ duels: 0, live: 0, deals: 0, noDeals: 0, gain: null as number | null, points: null as number | null })

/** Per rival (live ones first, then the most duelled, then by name, unknown last), per session (newest first), and in all. */
export function duelRecord(s: State): DuelRecord {
  const total = empty()
  const rivals = new Map<string | null, RivalTally & ReturnType<typeof empty>>()
  const sessions = new Map<number | null, SessionTally & ReturnType<typeof empty>>()
  for (const d of Object.values(s.duels)) {
    addTo(total, d)
    const r = rivals.get(d.rival) ?? { rival: d.rival, ...empty() }
    addTo(r, d)
    rivals.set(d.rival, r)
    const n = sessions.get(d.session) ?? { session: d.session, ...empty() }
    addTo(n, d)
    sessions.set(d.session, n)
  }
  const byName = (a: RivalTally, b: RivalTally) => (a.rival === null ? 1 : b.rival === null ? -1 : a.rival.localeCompare(b.rival))
  const points = s.score.duel_points
  return {
    scorePoints: typeof points === 'number' && Number.isFinite(points) ? points : null,
    total,
    rivals: [...rivals.values()].sort((a, b) => b.live - a.live || b.duels - a.duels || byName(a, b)),
    sessions: [...sessions.values()].sort((a, b) => (b.session ?? -1) - (a.session ?? -1)),
  }
}

export function duelHealth(s: State): DuelHealth {
  const status = agentStatuses(s).find((a) => a.agent === 'duels') ?? null
  const live = Object.values(s.duels).filter((d) => d.status === 'open').length
  return { status, lastTick: status?.last?.toTick ?? null, live }
}

/** Live duels, for the one-line link on the Negotiations screen. */
export const liveDuelCount = (s: State): number => Object.values(s.duels).filter((d) => d.status === 'open').length
