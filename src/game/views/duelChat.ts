/**
 * One duel as a conversation, for the Duels screen's live chat: who said what, tick by tick, the way the show's
 * transcript reads. The stream carries each priced message (price and delivery day) but never its words, so a line
 * is the offer itself; our side also says what our duels agent decided (offer, wait, accept), with Jev's verdict.
 *
 * - A rival's offer is marked inside or outside our limit on its price (the days weight is private: never counted
 *   here), only when the page may show our limits (`limits`).
 * - Rounds are the game's: the fewer priced messages of the two sides. A message that adds one says how much of the
 *   deal's value the decay has taken so far.
 * - Our holds in a row collapse into one "we wait" line: silence costs no round.
 */
import type { DecisionRow } from '../decisions.ts'
import type { Duel } from '../state.ts'
import { isWrite } from './decisions.ts'

export type ChatSide = 'us' | 'them'

export type ChatLine =
  | {
      readonly kind: 'start'
      readonly tick: number | null
      readonly side: 'buy' | 'sell'
      readonly item: string | null
      readonly rival: string | null
      readonly limit: number | null
      readonly deadlineTick: number | null
      readonly decay: number | null
    }
  | {
      readonly kind: 'msg'
      readonly tick: number | null
      readonly from: ChatSide
      readonly price: number | null
      readonly days: number | null
      /** A rival's price against our limit: true inside, false outside, null unknown or hidden. */
      readonly inside: boolean | null
      /** Set when this message added a round: the round's number and the share of the value the decay has taken. */
      readonly round: { readonly n: number; readonly taken: number | null } | null
      /** Our message only: Jev's verdict at that tick (`counter`, `undecided`…), when it was asked. */
      readonly jev: string | null
    }
  | { readonly kind: 'wait'; readonly fromTick: number; readonly toTick: number; readonly ticks: number; readonly jev: string | null }
  | { readonly kind: 'accept'; readonly tick: number; readonly done: boolean; readonly jev: string | null }
  | { readonly kind: 'refused'; readonly tick: number; readonly action: 'offer' | 'accept' | 'other'; readonly error: string | null; readonly rule: string | null }
  | { readonly kind: 'end'; readonly tick: number | null; readonly deal: boolean; readonly price: number | null; readonly gain: number | null; readonly rounds: number | null }

const round2 = (v: number): number => Math.round(v * 100) / 100

export const sideOfDuel = (d: Pick<Duel, 'role'>): 'buy' | 'sell' => (d.role === 'seller' ? 'sell' : 'buy')

/** Strictly inside our limit, on price: under our value when we buy, over our cost when we sell. */
export function insideLimit(side: 'buy' | 'sell', price: number | null, limit: number | null): boolean | null {
  if (price == null || limit == null) return null
  return side === 'buy' ? price < limit : price > limit
}

/** The duels agent's write decisions on this duel, oldest first. */
export const duelDecisions = (decisions: readonly DecisionRow[], id: number): DecisionRow[] =>
  decisions.filter((r) => r.item === `duel:${id}` && isWrite(r.kind))

type Ordered = { readonly tick: number; readonly seq: number; readonly line: ChatLine }

/** The conversation of one duel. `limits`: whether the page may show our limit (GAME_VIEW_TOKEN, or the mock). */
export function duelChat(d: Duel, decisions: readonly DecisionRow[], { limits }: { limits: boolean }): ChatLine[] {
  const side = sideOfDuel(d)
  const limit = limits ? d.limit : null
  const rows = duelDecisions(decisions, d.id)
  // our offers take their decision's Jev verdict; the other decisions are lines of their own
  const offerRows = rows.filter((r) => r.kind === 'duel_offer' && r.status !== 'rejected' && r.status !== 'failed')
  const used = new Set<number>()
  const out: Ordered[] = []
  let ours = 0
  let theirs = 0
  let rounds = 0
  d.offers.forEach((o, i) => {
    if (o.price != null) {
      if (o.side === 'us') ours += 1
      else theirs += 1
    }
    const now = Math.min(ours, theirs)
    const added = now > rounds
    rounds = now
    let jev: string | null = null
    if (o.side === 'us') {
      const r = offerRows.find((x) => !used.has(x.decision) && x.tick === o.tick)
      if (r) {
        used.add(r.decision)
        jev = r.jev
      }
    }
    out.push({
      tick: o.tick ?? -1,
      seq: 1000 + i,
      line: {
        kind: 'msg', tick: o.tick, from: o.side, price: o.price, days: o.days,
        inside: o.side === 'them' ? insideLimit(side, o.price, limit) : null,
        round: added ? { n: rounds, taken: d.decay == null ? null : round2(1 - (1 - d.decay) ** rounds) } : null,
        jev,
      },
    })
  })
  rows.forEach((r, i) => {
    if (used.has(r.decision)) return
    // after the tick's messages: a decision answers what was on the table at that tick
    const seq = 1_000_000 + i
    if (r.status === 'rejected' || r.status === 'failed') {
      const action = r.kind === 'duel_offer' ? 'offer' : r.kind === 'duel_accept' ? 'accept' : 'other'
      out.push({ tick: r.tick, seq, line: { kind: 'refused', tick: r.tick, action, error: r.error, rule: r.rule } })
    } else if (r.kind === 'duel_accept') {
      out.push({ tick: r.tick, seq, line: { kind: 'accept', tick: r.tick, done: r.status === 'done', jev: r.jev } })
    } else if (r.kind === 'duel_hold') {
      out.push({ tick: r.tick, seq, line: { kind: 'wait', fromTick: r.tick, toTick: r.tick, ticks: 1, jev: r.jev } })
    }
    // an offer decision with no message seen yet is shown once its message arrives
  })
  out.sort((a, b) => a.tick - b.tick || a.seq - b.seq)
  const lines: ChatLine[] = []
  for (const { line } of out) {
    const prev = lines.at(-1)
    if (line.kind === 'wait' && prev?.kind === 'wait') {
      lines[lines.length - 1] = { ...prev, toTick: line.toTick, ticks: prev.ticks + 1, jev: line.jev ?? prev.jev }
      continue
    }
    lines.push(line)
  }
  if (d.item != null || d.deadlineTick != null || d.startTick != null) {
    lines.unshift({ kind: 'start', tick: d.startTick, side, item: d.item, rival: d.rival, limit, deadlineTick: d.deadlineTick, decay: d.decay })
  }
  if (d.status !== 'open') {
    lines.push({ kind: 'end', tick: d.closedTick, deal: d.status === 'deal', price: d.dealPrice, gain: limits ? d.gain : null, rounds: d.finalRounds })
  }
  return lines
}

/** The duels to pick from: the live ones first (the latest move first), then the finished ones, newest first. */
export function chatDuels(duels: Readonly<Record<number, Duel>>, max = 24): Duel[] {
  const all = Object.values(duels)
  const lastTick = (d: Duel): number => d.offers.at(-1)?.tick ?? d.closedTick ?? d.startTick ?? -1
  const live = all.filter((d) => d.status === 'open').sort((a, b) => lastTick(b) - lastTick(a) || b.id - a.id)
  const done = all.filter((d) => d.status !== 'open').sort((a, b) => (b.closedTick ?? -1) - (a.closedTick ?? -1) || b.id - a.id)
  return [...live, ...done].slice(0, max)
}
