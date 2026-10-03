import { isSuspicious, setOf } from '../game.ts'
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
  status: 'open' | 'closed'
  lastText: string | null
  suspicious: boolean
  lastEventId: number | null
  lastTick: number | null
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
  suspicious: boolean
}

export type Conversation = { thread: ThreadRow; bubbles: Bubble[]; lastText: string | null }

export type RailPoint = { x: number; y: number; price: number; round: number; final: boolean; eventId: number }

export type Rail = { us: RailPoint[]; them: RailPoint[]; grid: { y: number; label: number }[]; lo: number; hi: number }

export type Box = { w: number; h: number; pad: { l: number; r: number; t: number; b: number } }

/** `ticksLeft`: until the deadline, for a live duel whose deadline we know; null otherwise. */
export type DuelRow = Duel & { gap: number | null; tone: 'neutral' | 'good' | 'bad'; ticksLeft: number | null }

const lastEvent = (th: Thread): number => th.offers.at(-1)?.eventId ?? th.id

const byActivity = (a: Thread, b: Thread): number => lastEvent(b) - lastEvent(a) || b.id - a.id

const sorted = (s: State): Thread[] => {
  const all = Object.values(s.threads)
  return [
    ...all.filter((t) => t.status === 'open').sort(byActivity),
    ...all.filter((t) => t.status !== 'open').sort(byActivity),
  ]
}

const gapOf = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : Math.abs(a - b))

function row(s: State, th: Thread): ThreadRow {
  const last = th.offers.at(-1)
  const buying = th.side === 'buy'
  return {
    id: th.id, with: th.with, topic: th.topic, set: setOf(th.topic), side: th.side,
    theirPrice: th.theirPrice, ourPrice: th.ourPrice,
    theirLabel: buying ? 'ask' : 'bid', ourLabel: buying ? 'bid' : 'ask',
    gap: gapOf(th.theirPrice, th.ourPrice), rounds: th.rounds, final: th.final,
    expiresIn: th.status === 'open' && th.expiresTick != null ? th.expiresTick - s.tick : null,
    status: th.status, lastText: th.lastText, suspicious: isSuspicious(th.lastText),
    lastEventId: last?.eventId ?? null, lastTick: last?.tick ?? null,
  }
}

export function threadList(s: State): ThreadRow[] {
  return sorted(s).map((th) => row(s, th))
}

export function selectedThreadId(s: State, requested: string | null): number | null {
  const n = requested ? Number(requested) : NaN
  if (Number.isInteger(n) && s.threads[n]) return n
  return sorted(s)[0]?.id ?? null
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
      text, suspicious: o.side === 'them' && isSuspicious(text),
    }
  })
  return { thread: row(s, th), bubbles, lastText: th.lastText }
}

export function rail(bubbles: Bubble[], box: Box): Rail {
  const priced = bubbles.filter((b) => b.price != null)
  if (!priced.length) return { us: [], them: [], grid: [], lo: 0, hi: 0 }
  const prices = priced.map((b) => b.price as number)
  const lo = Math.floor(Math.min(...prices) * 0.9)
  let hi = Math.ceil(Math.max(...prices) * 1.1)
  if (hi <= lo) hi = lo + 1
  const { w, h, pad } = box
  const n = Math.max(bubbles.length, 2)
  const x = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b)
  const points = (side: 'us' | 'them'): RailPoint[] =>
    bubbles.flatMap((b, i) => (b.side === side && b.price != null
      ? [{ x: x(i), y: y(b.price), price: b.price, round: b.round, final: b.final, eventId: b.eventId }]
      : []))
  const labels = [...new Set([lo, Math.round((lo + hi) / 2), hi])]
  return { us: points('us'), them: points('them'), grid: labels.map((label) => ({ y: y(label), label })), lo, hi }
}

const ticksLeftOf = (d: Duel, tick: number): number | null =>
  d.status === 'open' && d.deadlineTick !== null && tick > 0 ? Math.max(0, d.deadlineTick - tick) : null

const toneOf = (d: Duel): DuelRow['tone'] => (d.status === 'deal' ? 'good' : d.status === 'no deal' ? 'bad' : 'neutral')

export function duelRows(s: State): DuelRow[] {
  const all = Object.values(s.duels)
  const order = (a: Duel, b: Duel) => b.id - a.id
  return [...all.filter((d) => d.status === 'open').sort(order), ...all.filter((d) => d.status !== 'open').sort(order)]
    .map((d) => ({ ...d, gap: gapOf(d.ourPrice, d.theirPrice), tone: toneOf(d), ticksLeft: ticksLeftOf(d, s.tick) }))
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
