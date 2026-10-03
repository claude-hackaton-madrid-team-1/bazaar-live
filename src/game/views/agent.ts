/**
 * The Agent screen's timeline: only the ticks where something happened, newest first.
 *
 * With our agents' decision log (db/agent_decisions.sql, or the mock) it is that log: each agent's runs of
 * identical decisions folded into one line (×N, tick range), the scored deals, a small marker where an agent
 * restarted, and every stretch of ticks with none of those folded into one "no decisions" line. Without the
 * log (the game API alone) it falls back to what the feed says we did: our settlements, duel results,
 * listings and threads, with the same folding of quiet ticks. Never the per-tick snapshots: the header has them.
 */
import { AGENTS, type AgentName } from '../../../shared/decisions.ts'
import type { OutcomeRow } from '../decisions.ts'
import { LOG_ICON, fmtP, topicText } from '../game.ts'
import { priceOf, topicOf, type GameEvent, type Payload, type State } from '../state.ts'
import { dealOf, hasDecisions, isRestart, nowTick, runsOf, type Deal, type Run } from './decisions.ts'

export type Lane = 'observe' | 'decide' | 'act' | 'result'

export type Filter = 'all' | 'blocked' | 'deals'

export type Tone = 'us' | 'them' | 'good' | 'bad' | 'neutral'

/** A line of the feed fallback: something we did, or what came of it. */
export type Line = {
  eventId: number
  type: string
  lane: Lane
  icon: string
  text: string
  tone: Tone
  who: string | null
  price: number | null
  gain: number | null
  deal: boolean
  /** A duel's start or result, for the screen to say in its language (`text` is the English fallback). */
  duel?: { readonly start: boolean; readonly rival: string | null; readonly role: string | null; readonly item: string | null; readonly deadline: number | null; readonly deal: boolean; readonly price: number | null }
}

/** One line of the timeline; `tick` is where it sorts (a run's or an idle stretch's newest tick). */
export type Entry =
  | { readonly kind: 'run'; readonly tick: number; readonly run: Run }
  | { readonly kind: 'restart'; readonly tick: number; readonly agent: AgentName; readonly eventId: number }
  | { readonly kind: 'outcome'; readonly tick: number; readonly row: OutcomeRow; readonly deal: Deal }
  | { readonly kind: 'line'; readonly tick: number; readonly line: Line }
  | { readonly kind: 'idle'; readonly tick: number; readonly from: number; readonly to: number }

export type TimelineOptions = { limit?: number; filter?: Filter; upToTick?: number | null }

const signedNum = (v: number) => `${v >= 0 ? '+' : '−'}${String(Math.round(Math.abs(v) * 10) / 10)}`

const toneOf = (gain: number | null): Tone => (gain == null || gain === 0 ? 'neutral' : gain > 0 ? 'good' : 'bad')

/** Our board offers seen so far in the walk, by id: a cancel or a failure names only the offer id. */
type Listed = { ref: string; side: string; price: number | null; venue: string }

const line = (e: GameEvent, lane: Lane, text: string, extra: Partial<Line> = {}): Line => ({
  eventId: e.id, type: e.type, lane, icon: '•', text, tone: 'neutral', who: null, price: null, gain: null, deal: false, ...extra,
})

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
    return line(e, 'result', text, { icon: LOG_ICON.accept, tone: toneOf(gain), who: bought ? seller : buyer, price, gain, deal: true })
  })
}

/** An event id as the page shows it: feed ids are real (`#21888`); the server's own events count down from -1 and are not. */
export const eventLabel = (id: number): string | null => (id > 0 ? `#${id}` : null)

/** A duel's start (what is at stake, by when: a live duel and its deadline) or its result. */
function duelLine(s: State, e: GameEvent): Line {
  const p = e.payload
  const rival: string | null = typeof p.rival === 'string' && p.rival ? p.rival : s.duels[p.duel]?.rival ?? null
  const duel = `duel #${p.duel}${rival ? ` vs ${rival}` : ''}`
  if (e.type === 'duel.started') {
    const stake = [p.role, p.item].filter((v) => typeof v === 'string' && v).join(' · ')
    const text = `${duel} starts${stake ? ` · ${stake}` : ''}${typeof p.deadline_tick === 'number' ? ` · ends by tick ${p.deadline_tick}` : ''}`
    const duelOf = { start: true, rival, role: typeof p.role === 'string' ? p.role : null, item: typeof p.item === 'string' ? p.item : null, deadline: typeof p.deadline_tick === 'number' ? p.deadline_tick : null, deal: false, price: null }
    return line(e, 'result', text, { icon: LOG_ICON.open, who: rival, deal: true, duel: duelOf })
  }
  const text = p.deal ? `${duel} deal at ${fmtP(p.price)}${p.points != null ? ` · ${signedNum(p.points)} pts` : ''}` : `${duel} no deal`
  return line(e, 'result', text, {
    icon: p.deal ? LOG_ICON.accept : LOG_ICON.walk, tone: p.deal ? 'good' : 'bad', who: rival, price: p.price ?? null, deal: true,
    duel: { start: false, rival, role: null, item: null, deadline: null, deal: Boolean(p.deal), price: typeof p.price === 'number' ? p.price : null },
  })
}

const offerName = (id: unknown, o: Listed | undefined) => (o ? `${o.side} #${String(id)} (${o.ref} at ${fmtP(o.price)})` : `offer #${String(id)}`)

/** What the feed says we did or got, as a line (never their chatter or our snapshots). */
function feedLines(s: State, e: GameEvent, offers: Map<number, Listed>): Line[] {
  const p = e.payload ?? {}
  switch (e.type) {
    case 'settlement':
      return settlementLines(s, e)
    case 'duel.started':
    case 'duel.result':
      return [duelLine(s, e)]
    case 'offer.listed': {
      const offer: Payload = p.offer ?? {}
      if (!s.team || offer.maker !== s.team) return []
      const venue: string = p.venue ?? offer.venue ?? 'direct'
      const price = priceOf(offer)
      const side = offer.want?.cash ? 'ask' : offer.give?.cash ? 'bid' : 'swap'
      const ref = side === 'bid' ? topicOf({ want: offer.want }) : topicOf({ give: offer.give })
      if (typeof offer.id === 'number') offers.set(offer.id, { ref, side, price, venue })
      const text = side === 'ask' ? `list ${ref} at ${fmtP(price)} on ${venue}`
        : side === 'bid' ? `bid ${fmtP(price)} for ${ref} on ${venue}`
        : `offer ${ref} for ${topicOf({ want: offer.want })} on ${venue}`
      return [line(e, 'act', text, { icon: LOG_ICON.list, tone: 'us', price, deal: true })]
    }
    case 'settlement.failed': {
      const o = typeof p.offer === 'number' ? offers.get(p.offer) : undefined
      if (!o) return []
      return [line(e, 'result', `${offerName(p.offer, o)} failed to settle: ${p.reason ?? '?'}`, { icon: LOG_ICON.walk, tone: 'bad', deal: true })]
    }
    case 'thread.opened': {
      if (p.team !== s.team) return []
      const topic = topicText(p.topic)
      return [line(e, 'act', `opened thread #${p.thread} with ${p.with ?? '?'}${topic ? ` · ${topic}` : ''}`, { icon: LOG_ICON.open, tone: 'us', who: p.with ?? null })]
    }
    case 'pack.opened':
      if (p.team !== s.team) return []
      return [line(e, 'result', `opened ${p.pack ?? 'a pack'}${p.best ? ` · best ${p.best}` : ''}`, { icon: '✦', tone: p.best ? 'good' : 'neutral' })]
    case 'gift.given': {
      const what = [p.cash ? fmtP(p.cash) : null, ...(p.packs ?? []), ...(p.cards ?? [])].filter(Boolean).join(', ')
      return [line(e, 'result', `gift from ${e.actor || '?'}${what ? `: ${what}` : ''}`, { icon: '✦', tone: 'good', who: e.actor || null })]
    }
    default:
      return []
  }
}

/** Every stretch of ticks in [from, to] that no entry touches, as one idle entry each. */
function idleRuns(busy: Set<number>, from: number, to: number): Entry[] {
  const out: Entry[] = []
  let start: number | null = null
  for (let t = from; t <= to + 1; t++) {
    const quiet = t <= to && !busy.has(t)
    if (quiet && start == null) start = t
    if (!quiet && start != null) {
      out.push({ kind: 'idle', tick: t - 1, from: start, to: t - 1 })
      start = null
    }
  }
  return out
}

const RANK: Readonly<Record<Entry['kind'], number>> = { outcome: 0, line: 1, run: 2, restart: 3, idle: 4 }

const agentRank = (e: Entry): number => (e.kind === 'run' ? AGENTS.indexOf(e.run.agent) : e.kind === 'restart' ? AGENTS.indexOf(e.agent) : 0)

const decisionOf = (e: Entry): number => (e.kind === 'run' ? e.run.last.decision : 0)

/** Newest first; within a tick, results before decisions, agents in their order, an agent's newest decision first. */
const order = (a: Entry, b: Entry): number =>
  b.tick - a.tick || RANK[a.kind] - RANK[b.kind] || agentRank(a) - agentRank(b) || decisionOf(b) - decisionOf(a)

function fromDecisions(s: State, upTo: number, filter: Filter): Entry[] {
  const out: Entry[] = []
  const busy = new Set<number>()
  let first = Infinity
  for (const agent of AGENTS) {
    const rows = s.agents.decisions[agent].filter((r) => r.tick <= upTo)
    for (const r of rows) {
      busy.add(r.tick)
      first = Math.min(first, r.tick)
    }
    for (const run of runsOf(rows)) {
      if (isRestart(run.last)) {
        if (filter === 'all') out.push({ kind: 'restart', tick: run.toTick, agent, eventId: run.last.eventId })
      } else if (filter === 'all' || (filter === 'blocked' && run.verdict === 'denied')) {
        out.push({ kind: 'run', tick: run.toTick, run })
      }
    }
  }
  for (const row of s.agents.outcomes) {
    if (row.tick == null || row.tick > upTo) continue
    busy.add(row.tick)
    if (filter !== 'blocked') out.push({ kind: 'outcome', tick: row.tick, row, deal: dealOf(s, row) })
  }
  // A duel's start is in no decision or outcome: the feed says it (what is at stake, by when).
  for (const e of s.mine) {
    if (e.type !== 'duel.started' || e.tick == null || e.tick > upTo) continue
    busy.add(e.tick)
    if (filter !== 'blocked') out.push({ kind: 'line', tick: e.tick, line: duelLine(s, e) })
  }
  if (filter === 'all' && Number.isFinite(first)) out.push(...idleRuns(busy, first, upTo))
  return out
}

function fromFeed(s: State, upTo: number, filter: Filter): Entry[] {
  if (filter === 'blocked') return []
  const out: Entry[] = []
  const busy = new Set<number>()
  const offers = new Map<number, Listed>()
  let tick = 0
  let first = Infinity
  for (const e of s.mine) {
    if (e.type === 'clock' && e.tick != null) tick = e.tick
    const at = e.tick ?? tick
    if (at > upTo) continue
    for (const l of feedLines(s, e, offers)) {
      if (filter === 'deals' && !l.deal) continue
      busy.add(at)
      first = Math.min(first, at)
      out.push({ kind: 'line', tick: at, line: l })
    }
  }
  if (filter === 'all' && Number.isFinite(first)) out.push(...idleRuns(busy, first, upTo))
  return out
}

/** The timeline, newest first, at most `limit` entries; frozen at `upToTick` when the watcher stopped following. */
export function timeline(s: State, { limit = 60, filter = 'all', upToTick = null }: TimelineOptions = {}): Entry[] {
  const upTo = upToTick ?? nowTick(s)
  const entries = hasDecisions(s) ? fromDecisions(s, upTo, filter) : fromFeed(s, upTo, filter)
  return entries.sort(order).slice(0, limit)
}
