import { LOG_ICON, PHASES, fmtP, isSuspicious, signed, topicText } from '../game.ts'
import { priceOf, topicOf, type GameEvent, type Payload, type Phase, type State } from '../state.ts'
import type { DecisionRow } from '../decisions.ts'
import { decideSlots, decisionTicks, hasDecisions, isWrite, latestDecision, openDealerThreads, refusalRuns, settledDeals, type DecideSlot } from './decisions.ts'

export type Lane = 'observe' | 'decide' | 'act' | 'result'

export const LANES: Lane[] = ['observe', 'decide', 'act', 'result']

export type Filter = 'all' | 'actions' | 'deals'

export type Tone = 'us' | 'them' | 'good' | 'bad' | 'neutral'

export type Line = {
  eventId: number
  type: string
  lane: Lane
  icon: string
  text: string
  tone: Tone
  who: string | null
  price: number | null
  final: boolean
  gain: number | null
  quote: string | null
  suspicious: boolean
  action: boolean
  deal: boolean
}

/** `decide`: each agent's decisions of the tick, or why it has none (views/decisions.ts), shown in the Decide lane. */
export type TickCard = { tick: number; lanes: { lane: Lane; lines: Line[] }[]; decide: DecideSlot[]; gain: number; deals: number }

export type TimelineOptions = { limitTicks?: number; filter?: Filter; upToTick?: number | null }

const num = (v: number) => String(Math.round(v * 10) / 10)

const signedNum = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v))}`

const toneOf = (gain: number | null): Tone => (gain == null || gain === 0 ? 'neutral' : gain > 0 ? 'good' : 'bad')

type Snapshot = { cash: number | null; score: number | null; rank: number | null }

/** Our board offers seen so far in the walk, by id: a cancel or a failure names only the offer id. */
type Listed = { ref: string; side: string; price: number | null; venue: string }

type Walk = { phase: Phase; goal: string; tick: number; me: Snapshot | null; offers: Map<number, Listed> }

const base = (e: GameEvent, lane: Lane, text: string, extra: Partial<Line> = {}): Line => ({
  eventId: e.id, type: e.type, lane, icon: '•', text, tone: 'neutral', who: null, price: null, final: false,
  gain: null, quote: null, suspicious: false, action: false, deal: false, ...extra,
})

function threadLine(s: State, e: GameEvent): Line | null {
  const p = e.payload
  if (p.team !== s.team) return null
  const ours = p.sender === s.team
  const offer: Payload | undefined = p.offer
  const text: string | null = typeof p.text === 'string' && p.text ? p.text : null
  if (ours) {
    const to = offer?.to ?? p.with ?? '?'
    if (!offer) return base(e, 'act', `message to ${to}`, { icon: LOG_ICON.say, tone: 'us', who: to, action: true, deal: true })
    const verb = offer.give?.cash ? 'bid' : 'ask'
    const price = priceOf(offer)
    return base(e, 'act', `${verb} ${fmtP(price)} to ${to} for ${topicOf(offer)}`, {
      icon: LOG_ICON.say, tone: 'us', who: to, price, action: true, deal: true,
    })
  }
  const who: string = p.sender ?? p.with ?? '?'
  const flags = { tone: 'them' as Tone, who, quote: text, suspicious: isSuspicious(text), deal: true, icon: '↘' }
  if (!offer) return base(e, 'result', `${who} replied`, flags)
  const verb = offer.want?.cash ? 'asks' : 'bids'
  const price = priceOf(offer)
  return base(e, 'result', `${who} ${verb} ${fmtP(price)} for ${topicOf(offer)}`, { ...flags, price, final: Boolean(offer.final) })
}

function settlementLines(s: State, e: GameEvent): Line[] {
  const p = e.payload
  const parties: string[] = p.parties ?? []
  if (!parties.includes(s.team)) return []
  const price: number = p.price ?? 0
  return (p.items ?? []).map((item: Payload) => {
    const ref: string = item.ref ?? '?'
    const name: string = item.name ?? ref
    const buyer: string = item.to ?? '?'
    const seller: string = item.frm ?? '?'
    const bought = buyer === s.team
    const value: number | undefined = p.your_value
    const gain = value != null
      ? bought ? value - price : price - value
      : s.tape.find((t) => t.eventId === e.id && t.assetId === (item.id ?? null))?.gain ?? null
    const text = bought ? `bought ${name} from ${seller} at ${fmtP(price)}` : `sold ${name} to ${buyer} at ${fmtP(price)}`
    return base(e, 'result', text, {
      icon: LOG_ICON.accept, tone: toneOf(gain), who: bought ? seller : buyer, price, gain, deal: true,
    })
  })
}

function duelLine(s: State, e: GameEvent): Line {
  const p = e.payload
  // Whom we duel: the event's own rival, else what the duel learnt (an older event, or a result read before it).
  const rival: string | null = typeof p.rival === 'string' && p.rival ? p.rival : s.duels[p.duel]?.rival ?? null
  const duel = `duel #${p.duel}${rival ? ` vs ${rival}` : ''}`
  if (e.type === 'duel.result') {
    const text = p.deal
      ? `${duel} deal at ${fmtP(p.price)}${p.points != null ? ` · ${signedNum(p.points)} pts` : ''}`
      : `${duel} no deal`
    return base(e, 'result', text, {
      icon: p.deal ? LOG_ICON.accept : LOG_ICON.walk, tone: p.deal ? 'good' : 'bad', who: rival, price: p.price ?? null, deal: true,
    })
  }
  const ours = p.sender === s.team
  const terms = `${fmtP(p.price)}${p.days != null ? `, ${p.days} days` : ''}`
  const text = ours ? `${duel} · we offer ${terms}` : rival ? `${duel} · they offer ${terms}` : `${duel} · ${p.sender ?? 'rival'} offers ${terms}`
  return base(e, 'result', text, {
    icon: ours ? LOG_ICON.say : '↘', tone: ours ? 'us' : 'them', who: ours ? null : rival ?? p.sender ?? 'rival',
    price: p.price ?? null, action: ours, deal: true,
  })
}

function meLine(e: GameEvent, w: Walk): Line | null {
  const p = e.payload
  const prev = w.me
  const next: Snapshot = {
    cash: p.cash ?? prev?.cash ?? null,
    score: p.score?.score ?? prev?.score ?? null,
    rank: p.score?.rank ?? prev?.rank ?? null,
  }
  w.me = next
  const parts: string[] = []
  if (!prev) {
    if (next.cash != null) parts.push(`cash ${fmtP(next.cash)}`)
    if (next.score != null) parts.push(`score ${num(next.score)}`)
    if (next.rank != null) parts.push(`rank ${next.rank}`)
  } else {
    if (next.cash != null && next.cash !== prev.cash) parts.push(`cash ${fmtP(next.cash)}${prev.cash != null ? ` (${signed(next.cash - prev.cash)})` : ''}`)
    if (next.score != null && next.score !== prev.score) parts.push(`score ${num(next.score)}${prev.score != null ? ` (${signedNum(next.score - prev.score)})` : ''}`)
    if (next.rank != null && next.rank !== prev.rank) parts.push(`rank ${next.rank}${prev.rank != null ? ` (was ${prev.rank})` : ''}`)
  }
  if (!parts.length) return null
  return base(e, 'observe', parts.join(' · '), { icon: '◉' })
}

/** Our listing on a board: what we give or want, and for how much. */
function listedLine(s: State, e: GameEvent, w: Walk): Line | null {
  const p = e.payload
  const offer: Payload = p.offer ?? {}
  if (!s.team || offer.maker !== s.team) return null
  const venue: string = p.venue ?? offer.venue ?? 'direct'
  const price = priceOf(offer)
  const side = offer.want?.cash ? 'ask' : offer.give?.cash ? 'bid' : 'swap'
  const ref = side === 'bid' ? topicOf({ want: offer.want }) : topicOf({ give: offer.give })
  if (typeof offer.id === 'number') w.offers.set(offer.id, { ref, side, price, venue })
  const text = side === 'ask' ? `list ${ref} at ${fmtP(price)} on ${venue}`
    : side === 'bid' ? `bid ${fmtP(price)} for ${ref} on ${venue}`
    : `offer ${ref} for ${topicOf({ want: offer.want })} on ${venue}`
  return base(e, 'act', text, { icon: LOG_ICON.list, tone: 'us', price, action: true, deal: true })
}

const offerName = (id: unknown, o: Listed | undefined) => (o ? `${o.side} #${String(id)} (${o.ref} at ${fmtP(o.price)})` : `offer #${String(id)}`)

function boardLine(s: State, e: GameEvent, w: Walk): Line | null {
  const p = e.payload
  switch (e.type) {
    case 'offer.listed':
      return listedLine(s, e, w)
    case 'offer.cancelled': {
      const o = typeof p.offer === 'number' ? w.offers.get(p.offer) : undefined
      const why = p.reason === 'expired' ? 'expired' : 'cancelled'
      return base(e, 'result', `${offerName(p.offer, o)} ${why}${o ? ` on ${o.venue}` : ''}`, { icon: LOG_ICON.walk, deal: true })
    }
    case 'settlement.failed': {
      const o = typeof p.offer === 'number' ? w.offers.get(p.offer) : undefined
      return base(e, 'result', `${offerName(p.offer, o)} failed to settle: ${p.reason ?? '?'}`, { icon: LOG_ICON.walk, tone: 'bad', deal: true })
    }
    case 'thread.opened': {
      const topic = topicText(p.topic)
      if (p.team === s.team) {
        return base(e, 'act', `opened thread #${p.thread} with ${p.with ?? '?'}${topic ? ` · ${topic}` : ''}`, {
          icon: LOG_ICON.open, tone: 'us', who: p.with ?? null, action: true, deal: true,
        })
      }
      return base(e, 'result', `${p.team ?? '?'} opened thread #${p.thread} with us${topic ? ` · ${topic}` : ''}`, { icon: '↘', tone: 'them', who: p.team ?? null, deal: true })
    }
    case 'pack.opened':
      return base(e, 'result', `opened ${p.pack ?? 'a pack'}${p.best ? ` · best ${p.best}` : ''}`, { icon: '✦', tone: p.best ? 'good' : 'neutral' })
    case 'gift.given': {
      const what = [p.cash ? fmtP(p.cash) : null, ...(p.packs ?? []), ...(p.cards ?? [])].filter(Boolean).join(', ')
      return base(e, 'result', `gift from ${e.actor || '?'}${what ? `: ${what}` : ''}`, { icon: '✦', tone: 'good', who: e.actor || null })
    }
    default:
      return null
  }
}

function linesOf(s: State, e: GameEvent, w: Walk): Line[] {
  const p = e.payload ?? {}
  switch (e.type) {
    case 'clock':
      return []
    case 'agent.phase': {
      if (p.phase) w.phase = p.phase
      if (!p.goal || p.goal === w.goal) return []
      w.goal = p.goal
      return [base(e, 'decide', `goal: ${p.goal}`, { icon: '◎' })]
    }
    case 'agent.thought':
      return [base(e, w.phase, p.text ?? '', { icon: LOG_ICON.thought })]
    case 'agent.action': {
      const kind: string = p.kind ?? 'act'
      return [base(e, kind === 'open' ? 'decide' : 'act', p.summary ?? kind, { icon: LOG_ICON[kind] ?? '•', action: true })]
    }
    case 'agent.me': {
      const line = meLine(e, w)
      return line ? [line] : []
    }
    case 'thread.message': {
      const line = threadLine(s, e)
      return line ? [line] : []
    }
    case 'thread.closed': {
      const th = s.threads[p.thread]
      if (!th) return []
      return [base(e, 'result', `thread #${p.thread} with ${th.with} closed`, { icon: LOG_ICON.walk, who: th.with, deal: true })]
    }
    case 'settlement':
      return settlementLines(s, e)
    case 'duel.message':
    case 'duel.result':
      return [duelLine(s, e)]
    case 'offer.listed':
    case 'offer.cancelled':
    case 'settlement.failed':
    case 'thread.opened':
    case 'pack.opened':
    case 'gift.given': {
      const line = boardLine(s, e, w)
      return line ? [line] : []
    }
    default:
      return []
  }
}

const keep = (filter: Filter, line: Line) => filter === 'all' || (filter === 'actions' ? line.action : line.deal)

export function timeline(s: State, { limitTicks = 40, filter = 'all', upToTick = null }: TimelineOptions = {}): TickCard[] {
  const w: Walk = { phase: 'observe', goal: '', tick: 0, me: null, offers: new Map() }
  const byTick = new Map<number, Line[]>()
  for (const e of s.mine) {
    if (e.type === 'clock' && e.tick != null) w.tick = e.tick
    const tick = e.tick ?? w.tick
    const lines = linesOf(s, e, w)
    if (!lines.length) continue
    const list = byTick.get(tick)
    if (list) list.push(...lines)
    else byTick.set(tick, [...lines])
  }
  const cards: TickCard[] = []
  // Once our agents' decisions arrive, the current tick always has a card: "did each agent act?" has an answer every tick.
  const decided = hasDecisions(s)
  const all = new Set([...byTick.keys(), ...(decided ? [...decisionTicks(s), s.tick] : [])])
  const ticks = [...all].filter((t) => upToTick == null || t <= upToTick).sort((a, b) => b - a)
  const runs = refusalRuns(s, upToTick)
  for (const tick of ticks) {
    const all = byTick.get(tick) ?? []
    const shown = all.filter((l) => keep(filter, l))
    // "who did not decide" only on the current tick: on a past one it is noise.
    const decide = filter === 'deals' ? [] : decideSlots(s, tick, runs).filter((d) => d.kind === 'row' || (filter === 'all' && tick === s.tick))
    if (!shown.length && !decide.some((d) => d.kind === 'row') && !(tick === s.tick && decide.length)) continue
    const lanes = LANES.map((lane) => ({ lane, lines: shown.filter((l) => l.lane === lane) })).filter((l) => l.lines.length || (l.lane === 'decide' && decide.length))
    const settled = all.filter((l) => l.type === 'settlement')
    cards.push({ tick, lanes, decide, gain: settled.reduce((sum, l) => sum + (l.gain ?? 0), 0), deals: settled.length })
    if (cards.length >= limitTicks) break
  }
  return cards
}

export type Now = {
  tick: number
  phase: Phase
  phaseIndex: number
  goal: string
  openThreads: number
  trades: number
  gain: number
  cash: number
  thought: { eventId: number; text: string } | null
  action: { eventId: number; text: string; icon: string } | null
  /** The latest decision of our agents (a restart is not one): the goal and the why when no agent.thought says them. */
  decision: DecisionRow | null
  /** The latest decision whose request went out to the game: what the agents did, when no agent.action says it. */
  executed: DecisionRow | null
}

/** An event id as the page shows it: feed ids are real (`#21888`); the server's own events count down from -1 and are not. */
export const eventLabel = (id: number): string | null => (id > 0 ? `#${id}` : null)

export function now(s: State): Now {
  let thought: Now['thought'] = null
  let action: Now['action'] = null
  for (let i = s.mine.length - 1; i >= 0 && (!thought || !action); i--) {
    const e = s.mine[i]
    if (!e) continue
    if (!thought && e.type === 'agent.thought') thought = { eventId: e.id, text: e.payload.text ?? '' }
    if (!action && e.type === 'agent.action') {
      const kind: string = e.payload.kind ?? 'act'
      action = { eventId: e.id, text: e.payload.summary ?? kind, icon: LOG_ICON[kind] ?? '•' }
    }
  }
  // The feed keeps only its last window, so our older settlements are gone from it; the scored outcomes are not.
  const deals = settledDeals(s)
  const fromOutcomes = deals.length >= s.ours.trades
  return {
    tick: s.tick,
    phase: s.phase,
    phaseIndex: PHASES.indexOf(s.phase),
    goal: s.goal,
    openThreads: Math.max(Object.values(s.threads).filter((t) => t.status === 'open').length, openDealerThreads(s)),
    trades: fromOutcomes ? deals.length : s.ours.trades,
    gain: fromOutcomes ? deals.reduce((sum, d) => sum + (d.edge ?? 0), 0) : s.ours.gain,
    cash: s.cash,
    thought,
    action,
    decision: latestDecision(s, (r) => isWrite(r.kind)),
    executed: latestDecision(s, (r) => isWrite(r.kind) && r.method != null && r.status !== 'failed' && r.status !== 'rejected'),
  }
}
