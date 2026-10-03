/**
 * Event → beat: one public decision or execution becomes a short BUYER ↔ SELLER exchange plus the
 * cue the stage acts out. The words come from the language pack in shared/ (the templates the TTS
 * proxy accepts), filled with public fields, in ONE language per line.
 *
 * Which variant is said depends on the situation: a deterministic mood (mood.ts) and, for live beats,
 * a memory of what was said lately (memory.ts) so nothing repeats within a few minutes. Without a
 * memory (replayed history) the pick is a hash of the event key, so a replay shows the same words.
 */
import type { BankKey } from '../../shared/bank.ts'
import type { Lang } from '../../shared/lang.ts'
import * as L from '../../shared/lines.ts'
import type { DecisionEvent, ExecutionEvent, PublicDecision, ShowEvent } from '../model/events'
import { PRIORITY, type Beat, type Cue, type DealerId, type Line, type Side } from './beat'
import { chooseVariant, type LineMemory } from './memory'
import { moodsFor, type Topic } from './mood'
import type { Situation } from './situation'
import { cardName, dealerId, dealerName, errorWords, itemName, kindWords, labelWords, primas, seedOf, verdictWords } from './words'

const DEALER_MOVES = ['open', 'bid', 'accept', 'walk'] as const
type DealerMove = (typeof DEALER_MOVES)[number]

/** What the dialogue needs to know besides the event. */
export interface DialogueContext {
  readonly lang: Lang
  /** Only live beats pass a memory: replayed history must not use up the lines. */
  readonly memory?: LineMemory
  readonly now?: number
  /** The director's queue is long. */
  readonly busy?: boolean
  /** How long since the last real event (ms). */
  readonly quietMs?: number | null
}

type Part = Pick<Beat, 'lines' | 'mood' | 'cue' | 'priority'>

interface Ctx {
  readonly values: L.SlotValues
  readonly dealer: DealerId
  readonly dialogue: DialogueContext
  readonly practice: boolean
}

function ctxOf(d: PublicDecision | null, dialogue: DialogueContext, extra: Partial<Record<L.Slot, string | null>> = {}): Ctx {
  const lang = dialogue.lang
  const inputs = d?.inputs ?? {}
  const move = d?.move ?? {}
  const ref = inputs.ref ?? inputs.card ?? inputs.item
  const dealer = dealerId(inputs.dealer)
  return {
    dealer,
    dialogue,
    practice: d !== null && !d.sent,
    values: {
      ...L.NO_VALUES,
      card: cardName(ref, lang),
      price: primas(move.price ?? inputs.price ?? move.wantCash, lang),
      ask: primas(inputs.ask ?? inputs.herAsk, lang),
      item: itemName(inputs.item ?? ref, lang),
      dealerName: dealerName(dealer, lang),
      verdict: verdictWords(d?.jevVerdict, lang),
      kind: kindWords(d?.kind, lang),
      ...extra,
    },
  }
}

/** One variant of a bank that the values can fill, picked by mood, freshness and the seed, as lines. */
function lines(key: BankKey, topic: Topic, ctx: Ctx, seed: number): { lines: Line[]; mood: Beat['mood'] } {
  const { lang, memory, now = Date.now(), busy, quietMs } = ctx.dialogue
  const pack = L.PACKS[lang]
  const usable = pack[key].filter((variant) => L.usable(variant.lines, ctx.values))
  const pool = usable.length > 0 ? usable : pack.UNKNOWN
  const moods = moodsFor({ topic, quietMs, busy, recent: memory?.recentMoods(), practice: ctx.practice })
  const variant = chooseVariant(pool, moods, seed, memory, now)
  memory?.record(variant, now)
  return {
    mood: variant.mood,
    lines: variant.lines.map(([role, text]) => ({ speaker: L.speakerOf(role, ctx.dealer), text: L.fill(text, ctx.values) })),
  }
}

function part(key: BankKey, topic: Topic, ctx: Ctx, seed: number, cue: Cue, priority: number): Part {
  return { ...lines(key, topic, ctx, seed), cue, priority }
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
function sentDecision(d: PublicDecision, ctx: Ctx, seed: number, isTaker: boolean): Part {
  const side = sideOf(d.kind)
  const ref = refOf(d)
  const hasPrice = ctx.values.price !== null
  const [verb] = d.kind.split('_')
  switch (verb) {
    case 'post': {
      const key: BankKey = side === 'bid' ? (hasPrice ? 'POST_BID' : 'POST_BID_NO_PRICE') : hasPrice ? 'POST_ASK' : 'POST_ASK_NO_PRICE'
      return part(key, 'post', ctx, seed, { kind: 'post', side, ref, price: priceOf(d) }, PRIORITY.post)
    }
    case 'reprice':
      return part(hasPrice ? 'REPRICE' : 'REPRICE_NO_PRICE', 'reprice', ctx, seed, { kind: 'reprice', side, ref, price: priceOf(d) }, PRIORITY.reprice)
    case 'hold':
      return part('HOLD', 'hold', ctx, seed, { kind: 'hold', side, ref, count: 1 }, PRIORITY.hold)
    case 'cancel':
      return part(isTaker ? 'CANCEL_BUYER' : 'CANCEL_SELLER', 'cancel', ctx, seed, { kind: 'cancel', side, ref }, PRIORITY.cancel)
    case 'accept':
      return part('TAKE', 'take', ctx, seed, { kind: 'reach', ref, price: d.inputs.ask ?? priceOf(d), take: true }, PRIORITY.take)
    case 'dealer':
      return dealerBeat(d, ctx, seed)
    case 'duel':
      return duelBeat(d, ctx, seed)
    default:
      return part('UNKNOWN', 'unknown', ctx, seed, { kind: 'talk' }, PRIORITY.other)
  }
}

function duelBeat(d: PublicDecision, ctx: Ctx, seed: number): Part {
  const cue: Cue = { kind: 'talk' }
  if (d.kind === 'duel_accept') return part('DUEL_ACCEPT', 'duel_accept', ctx, seed, cue, PRIORITY.duel)
  if (d.kind === 'duel_hold') return part('DUEL_HOLD', 'duel_hold', ctx, seed, cue, PRIORITY.duel)
  return part('DUEL_OFFER', 'duel_offer', ctx, seed, cue, PRIORITY.duel)
}

function dealerBeat(d: PublicDecision, ctx: Ctx, seed: number): Part {
  const raw = d.kind.slice('dealer_'.length)
  const move: DealerMove = (DEALER_MOVES as readonly string[]).includes(raw) ? (raw as DealerMove) : 'bid'
  const cue: Cue = { kind: 'dealer', dealer: ctx.dealer, move, price: priceOf(d) }
  const chato = ctx.dealer === 'chato'
  switch (move) {
    case 'open':
      return part(chato ? 'DEALER_OPEN_CHATO' : 'DEALER_OPEN_KIND', 'dealer_open', ctx, seed, cue, PRIORITY.dealer)
    case 'accept':
      return part(chato ? 'DEALER_ACCEPT_CHATO' : 'DEALER_ACCEPT_KIND', 'dealer_accept', ctx, seed, cue, PRIORITY.dealerAccept)
    case 'walk':
      return part(chato ? 'DEALER_WALK_CHATO' : 'DEALER_WALK_KIND', 'dealer_walk', ctx, seed, cue, PRIORITY.dealer)
    case 'bid': {
      const key: BankKey = ctx.values.price === null ? 'DEALER_BID_NO_PRICE' : chato ? 'DEALER_BID_CHATO' : 'DEALER_BID_KIND'
      return part(key, 'dealer_bid', ctx, seed, cue, PRIORITY.dealerBid)
    }
  }
}

/** A row that did not reach the game: denied, late, skipped, or a dry run. */
function unsentDecision(d: PublicDecision, ctx: Ctx, seed: number, isTaker: boolean): Part {
  const ref = refOf(d)
  const talk: Cue = { kind: 'talk' }
  if (d.guardrail === 'denied') {
    return part(isTaker ? 'DENIED_BUYER' : 'DENIED_SELLER', 'denied', ctx, seed, isTaker ? { kind: 'reach', ref, price: null, take: false } : talk, PRIORITY.denied)
  }
  if (d.status === 'expired') return part('LATE', 'late', ctx, seed, talk, PRIORITY.pass)
  if (d.status === 'approved') {
    // Approved but not live: a dry run acts the move out as a rehearsal, without touching the board.
    const rehearsal = sentDecision(d, ctx, seed, isTaker)
    const boardMove = rehearsal.cue.kind === 'post' || rehearsal.cue.kind === 'reprice' || rehearsal.cue.kind === 'cancel' || rehearsal.cue.kind === 'hold'
    return part('PRACTICE', 'practice', ctx, seed, boardMove ? talk : rehearsal.cue, Math.min(rehearsal.priority, PRIORITY.post) - 10)
  }
  return part(isTaker ? 'PASS' : 'SKIP_SELLER', 'pass', ctx, seed, talk, PRIORITY.pass)
}

function noteOf(d: PublicDecision, lang: Lang): string {
  const es = lang === 'es'
  if (d.guardrail === 'denied') return es ? 'frenado por una barrera · no enviado' : 'blocked by a guardrail · not sent'
  if (d.status === 'expired') return es ? 'demasiado tarde · no enviado' : 'too late · not sent'
  if (d.status === 'approved') return es ? 'ensayo · no enviado' : 'practice · not sent'
  return `${labelWords(d.status) ?? (es ? 'sin aprobar' : 'not approved')} · ${es ? 'no enviado' : 'not sent'}`
}

function decisionBeat(event: DecisionEvent, dialogue: DialogueContext): Beat {
  const d = event.decision
  const seed = seedOf(event.key)
  const ctx = ctxOf(d, dialogue)
  const isTaker = event.agent === 'taker'
  const built = d.sent ? sentDecision(d, ctx, seed, isTaker) : unsentDecision(d, ctx, seed, isTaker)
  return {
    id: event.key,
    agent: event.agent,
    tick: event.tick,
    ...built,
    denied: d.guardrail === 'denied',
    jev: d.jevVerdict,
    practice: !d.sent,
    note: d.sent ? null : noteOf(d, dialogue.lang),
  }
}

function executionBeat(event: ExecutionEvent, dialogue: DialogueContext): Beat {
  const x = event.execution
  const seed = seedOf(event.key)
  const base = { id: event.key, agent: event.agent, tick: event.tick, denied: false, jev: null, practice: false, note: null }
  if (!x.ok) {
    const ctx = ctxOf(null, dialogue, { error: errorWords(x.errorCode ?? 'error', dialogue.lang) })
    return { ...base, ...part('FAIL', 'fail', ctx, seed, { kind: 'fail', code: x.errorCode ?? 'error' }, PRIORITY.fail) }
  }
  const ctx = ctxOf(null, dialogue)
  if (x.method === 'accept') return { ...base, ...part('DEAL', 'deal', ctx, seed, { kind: 'deal', big: true, ref: null }, PRIORITY.deal) }
  const key = SENT_BANKS[x.method] ?? 'SENT_OTHER'
  return { ...base, ...part(key, 'sent', ctx, seed, { kind: 'deal', big: false, ref: null }, PRIORITY.sent) }
}

/** One short confirmation per SDK route the agents call. */
const SENT_BANKS: Readonly<Record<string, BankKey>> = {
  list_offer: 'SENT_LIST_OFFER',
  cancel: 'SENT_CANCEL',
  open_thread: 'SENT_OPEN_THREAD',
  say: 'SENT_SAY',
  close_thread: 'SENT_CLOSE_THREAD',
}

/** The beat for one event, or null for events that are not dialogue (ticks). */
export function toBeat(event: ShowEvent, dialogue: DialogueContext): Beat | null {
  switch (event.type) {
    case 'agent.decision':
      return decisionBeat(event, dialogue)
    case 'agent.execution':
      return executionBeat(event, dialogue)
    case 'agent.tick':
      return null
  }
}

const SITUATION_BANKS: Readonly<Record<Situation['topic'], BankKey>> = {
  doors_closed: 'DOORS_CLOSED',
  paused: 'PAUSED',
  offline: 'OFFLINE',
  quiet: 'QUIET',
  simulator: 'SIMULATOR',
  dry: 'DRY',
  market_test: 'MARKET_TEST',
  new_page: 'NEW_PAGE',
  tick: 'TICK',
}

/**
 * What the stage says when nothing is happening, by the situation (closed doors with the countdown,
 * a quiet market, a new tick...). `n` counts the situational beats so far.
 */
export function situationBeat(n: number, situation: Situation, dialogue: DialogueContext): Beat {
  const plan = planSituation(situation, dialogue)
  return buildSituationBeat(n, situation, plan)
}

/**
 * Like situationBeat, but null when every line that could be said was said within the memory window:
 * the idle talk keeps quiet rather than repeat itself (the spec: no line repeats within N minutes).
 */
export function situationBeatIfFresh(n: number, situation: Situation, dialogue: DialogueContext): Beat | null {
  const plan = planSituation(situation, dialogue)
  const { memory, now = Date.now() } = dialogue
  if (memory) {
    const pool = L.PACKS[dialogue.lang][plan.key].filter((v) => L.usable(v.lines, plan.ctx.values))
    if (pool.length > 0 && pool.every((v) => memory.recent(v, now))) return null
  }
  return buildSituationBeat(n, situation, plan)
}

interface SituationPlan {
  readonly key: BankKey
  readonly ctx: Ctx
}

function planSituation(situation: Situation, dialogue: DialogueContext): SituationPlan {
  const ctx = ctxOf(null, dialogue)
  const values: L.SlotValues = {
    ...ctx.values,
    eta: situation.topic === 'doors_closed' ? situation.eta : null,
    opens: situation.topic === 'doors_closed' ? situation.opens : null,
    hood: situation.topic === 'new_page' ? situation.hood : null,
    tick: situation.topic === 'tick' ? String(situation.tick) : null,
  }
  // Closed doors with no countdown to speak of use the bare bank, which needs no slots.
  const key = situation.topic === 'doors_closed' && situation.eta === null && situation.opens === null ? 'DOORS_CLOSED_BARE' : SITUATION_BANKS[situation.topic]
  return { key, ctx: { ...ctx, values } }
}

function buildSituationBeat(n: number, situation: Situation, plan: SituationPlan): Beat {
  const seed = seedOf(`${situation.topic}-${n}`)
  const built = part(plan.key, situation.topic, plan.ctx, seed, { kind: 'talk' }, situation.topic === 'new_page' || situation.topic === 'market_test' ? PRIORITY.news : PRIORITY.other)
  return {
    id: `${situation.topic}-${n}`,
    agent: n % 2 === 0 ? 'maker' : 'taker',
    tick: null,
    ...built,
    denied: false,
    jev: null,
    practice: false,
    note: null,
  }
}

/** Several holds in a row become one line: "Holding 5 prices". */
export function holdsBeat(holds: readonly Beat[], dialogue: DialogueContext): Beat {
  const first = holds[0]
  if (!first) throw new Error('holdsBeat() needs at least one hold')
  if (holds.length === 1) return first
  const seed = seedOf(first.id)
  const cue = first.cue.kind === 'hold' ? { ...first.cue, count: holds.length } : first.cue
  const ctx = ctxOf(null, dialogue, { count: String(Math.min(holds.length, 999)) })
  return {
    ...first,
    ...lines('HOLD_MANY', 'hold', ctx, seed),
    cue,
    jev: holds.find((h) => h.jev)?.jev ?? null,
  }
}
