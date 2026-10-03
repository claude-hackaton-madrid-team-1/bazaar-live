/**
 * Event → beat: one public decision or execution becomes a short BUYER ↔ SELLER exchange plus the
 * cue the stage acts out. Deterministic: the line is picked by a hash of the event key, so a replay
 * shows the same words, while two different moves rarely sound alike.
 */
import type { DecisionEvent, ExecutionEvent, PublicDecision, ShowEvent } from '../model/events'
import { PRIORITY, type Beat, type Cue, type Side } from './beat'
import * as S from './scripts'
import type { Ctx, Template } from './scripts'
import { cardName, DEALER_NAMES, dealerId, errorWords, itemName, pick, primas, seedOf } from './words'

const DEALER_MOVES = ['open', 'bid', 'accept', 'walk'] as const
type DealerMove = (typeof DEALER_MOVES)[number]

function ctxOf(d: PublicDecision | null, extra: Partial<Ctx> = {}): Ctx {
  const inputs = d?.inputs ?? {}
  const move = d?.move ?? {}
  const ref = inputs.ref ?? inputs.card ?? inputs.item
  const dealer = dealerId(inputs.dealer)
  return {
    card: cardName(ref),
    price: primas(move.price ?? inputs.price ?? move.wantCash),
    ask: primas(inputs.ask ?? inputs.herAsk),
    item: itemName(inputs.item ?? ref),
    dealer,
    dealerName: DEALER_NAMES[dealer],
    verdict: d?.jevVerdict ?? null,
    error: '',
    kind: d?.kind ?? '',
    count: 1,
    ...extra,
  }
}

function lines(bank: readonly Template[], ctx: Ctx, seed: number) {
  return pick(bank, seed)(ctx)
}

function sideOf(kind: string): Side {
  return kind.endsWith('_bid') ? 'bid' : 'ask'
}

function refOf(d: PublicDecision): string {
  return d.inputs.ref ?? d.inputs.card ?? d.inputs.item ?? '?'
}

function priceOf(d: PublicDecision): number | null {
  return d.move.price ?? d.inputs.price ?? d.move.wantCash ?? null
}

/** What a sent decision looks like on stage, by kind. */
function sentDecision(d: PublicDecision, ctx: Ctx, seed: number, isTaker: boolean): Pick<Beat, 'lines' | 'cue' | 'priority'> {
  const side = sideOf(d.kind)
  const ref = refOf(d)
  const hasPrice = ctx.price !== null
  const [verb] = d.kind.split('_')
  switch (verb) {
    case 'post': {
      const bank = side === 'bid' ? (hasPrice ? S.POST_BID : S.POST_BID_NO_PRICE) : hasPrice ? S.POST_ASK : S.POST_ASK_NO_PRICE
      return { lines: lines(bank, ctx, seed), cue: { kind: 'post', side, ref, price: priceOf(d) }, priority: PRIORITY.post }
    }
    case 'reprice':
      return {
        lines: lines(hasPrice ? S.REPRICE : S.REPRICE_NO_PRICE, ctx, seed),
        cue: { kind: 'reprice', side, ref, price: priceOf(d) },
        priority: PRIORITY.reprice,
      }
    case 'hold':
      return { lines: lines(S.HOLD, ctx, seed), cue: { kind: 'hold', side, ref, count: 1 }, priority: PRIORITY.hold }
    case 'cancel':
      return {
        lines: lines(isTaker ? S.CANCEL_BUYER : S.CANCEL_SELLER, ctx, seed),
        cue: { kind: 'cancel', side, ref },
        priority: PRIORITY.cancel,
      }
    case 'accept':
      return {
        lines: lines(S.TAKE, ctx, seed),
        cue: { kind: 'reach', ref, price: d.inputs.ask ?? priceOf(d), take: true },
        priority: PRIORITY.take,
      }
    case 'dealer':
      return dealerBeat(d, ctx, seed)
    default:
      return { lines: lines(S.UNKNOWN, ctx, seed), cue: { kind: 'talk' }, priority: PRIORITY.other }
  }
}

function dealerBeat(d: PublicDecision, ctx: Ctx, seed: number): Pick<Beat, 'lines' | 'cue' | 'priority'> {
  const raw = d.kind.slice('dealer_'.length)
  const move: DealerMove = (DEALER_MOVES as readonly string[]).includes(raw) ? (raw as DealerMove) : 'bid'
  const cue: Cue = { kind: 'dealer', dealer: ctx.dealer, move, price: priceOf(d) }
  switch (move) {
    case 'open':
      return { lines: lines(S.DEALER_OPEN, ctx, seed), cue, priority: PRIORITY.dealer }
    case 'accept':
      return { lines: lines(S.DEALER_ACCEPT, ctx, seed), cue, priority: PRIORITY.dealerAccept }
    case 'walk':
      return { lines: lines(S.DEALER_WALK, ctx, seed), cue, priority: PRIORITY.dealer }
    case 'bid':
      return { lines: lines(ctx.price ? S.DEALER_BID : S.DEALER_BID_NO_PRICE, ctx, seed), cue, priority: PRIORITY.dealerBid }
  }
}

/** A row that did not reach the game: denied, late, skipped, or a dry run. */
function unsentDecision(d: PublicDecision, ctx: Ctx, seed: number, isTaker: boolean): Pick<Beat, 'lines' | 'cue' | 'priority'> {
  const ref = refOf(d)
  const talk: Cue = { kind: 'talk' }
  if (d.guardrail === 'denied') {
    return {
      lines: lines(isTaker ? S.DENIED_BUYER : S.DENIED_SELLER, ctx, seed),
      cue: isTaker ? { kind: 'reach', ref, price: null, take: false } : talk,
      priority: PRIORITY.denied,
    }
  }
  if (d.status === 'expired') return { lines: lines(S.LATE, ctx, seed), cue: talk, priority: PRIORITY.pass }
  if (d.status === 'approved') {
    // Approved but not live: a dry run acts the move out as a rehearsal.
    const rehearsal = sentDecision(d, ctx, seed, isTaker)
    return { ...rehearsal, lines: lines(S.PRACTICE, ctx, seed), priority: Math.min(rehearsal.priority, PRIORITY.post) - 10 }
  }
  return { lines: lines(isTaker ? S.PASS : S.SKIP_SELLER, ctx, seed), cue: talk, priority: PRIORITY.pass }
}

function decisionBeat(event: DecisionEvent): Beat {
  const d = event.decision
  const seed = seedOf(event.key)
  const ctx = ctxOf(d)
  const isTaker = event.agent === 'taker'
  const part = d.sent ? sentDecision(d, ctx, seed, isTaker) : unsentDecision(d, ctx, seed, isTaker)
  return {
    id: event.key,
    agent: event.agent,
    tick: event.tick,
    ...part,
    denied: d.guardrail === 'denied',
    jev: d.jevVerdict,
    practice: !d.sent,
    note: d.sent ? null : noteOf(d),
  }
}

function noteOf(d: PublicDecision): string {
  if (d.guardrail === 'denied') return 'blocked by a guardrail · not sent'
  if (d.status === 'expired') return 'too late · not sent'
  if (d.status === 'approved') return 'practice · not sent'
  return `${d.status} · not sent`
}

function executionBeat(event: ExecutionEvent): Beat {
  const x = event.execution
  const seed = seedOf(event.key)
  const base = { id: event.key, agent: event.agent, tick: event.tick, denied: false, jev: null, practice: false, note: null }
  if (!x.ok) {
    const ctx = ctxOf(null, { error: errorWords(x.errorCode ?? 'error') })
    return { ...base, lines: lines(S.FAIL, ctx, seed), cue: { kind: 'fail', code: x.errorCode ?? 'error' }, priority: PRIORITY.fail }
  }
  const ctx = ctxOf(null)
  if (x.method === 'accept') {
    return { ...base, lines: lines(S.DEAL, ctx, seed), cue: { kind: 'deal', big: true, ref: null }, priority: PRIORITY.deal }
  }
  const bank = S.SENT[x.method] ?? S.SENT.other ?? []
  return { ...base, lines: lines(bank, ctx, seed), cue: { kind: 'deal', big: false, ref: null }, priority: PRIORITY.sent }
}

/** The beat for one event, or null for events that are not dialogue (ticks). */
export function toBeat(event: ShowEvent): Beat | null {
  switch (event.type) {
    case 'agent.decision':
      return decisionBeat(event)
    case 'agent.execution':
      return executionBeat(event)
    case 'agent.tick':
      return null
  }
}

/** Banter for a quiet stage; `n` counts the idle beats so far. */
export function idleBeat(n: number): Beat {
  const seed = seedOf(`idle-${n}`)
  return {
    id: `idle-${n}`,
    agent: n % 2 === 0 ? 'maker' : 'taker',
    tick: null,
    priority: PRIORITY.other,
    lines: lines(S.IDLE, ctxOf(null), seed),
    cue: { kind: 'talk' },
    denied: false,
    jev: null,
    practice: false,
    note: null,
  }
}

/** Several holds in a row become one line: "Holding 5 prices". */
export function holdsBeat(holds: readonly Beat[]): Beat {
  const first = holds[0]
  if (!first) throw new Error('holdsBeat() needs at least one hold')
  if (holds.length === 1) return first
  const seed = seedOf(first.id)
  const cue = first.cue.kind === 'hold' ? { ...first.cue, count: holds.length } : first.cue
  return {
    ...first,
    lines: lines(S.HOLD_MANY, ctxOf(null, { count: holds.length }), seed),
    cue,
    jev: holds.find((h) => h.jev)?.jev ?? null,
  }
}
