import { salesLine, salesThread, sentSalesQuote } from '../../shared/sales.ts'
import { detectLang } from '../../shared/detect-lang.ts'
import { activityLine, type ActivityLine } from '../../shared/activity-lines.ts'
import { jevLine } from '../../shared/jev-lines.ts'
import type { Lang } from '../../shared/lang.ts'
import { duelOfferLine } from '../../shared/real-lines.ts'
import { guestSpeaker } from '../../shared/tags.ts'
import type { Beat, Line } from './beat'
import { PRIORITY } from './beat'

export type ActivityCategory = 'duel' | 'team' | 'trade' | 'jev' | 'incident' | 'market' | 'clock' | 'dealer'
export interface Activity {
  readonly id: string
  readonly tick: number | null
  readonly category: ActivityCategory
  readonly text: string
  readonly reference: string
  readonly history: boolean
}
export interface BroadcastItem { readonly activity: Activity; readonly beat: Beat; readonly speak: boolean }
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const teamId = (v: unknown): v is string => typeof v === 'string' && /^t\d{2,4}$/.test(v)
const label = (v: unknown): string => typeof v === 'string' && /^[\p{L}\p{N} _.-]{1,64}$/u.test(v) ? v : ''

/** Reads only an authorized game stream. Reconnect backfills are visible but never spoken. */
export class Broadcast {
  tick: number | null = null
  seconds: number | null = null
  private day = ''
  private team = ''
  private readonly threads = new Set<number>()
  private readonly salesThreads = new Set<number>()
  private readonly pendingQuotes = new Map<number, { event: Record<string, unknown>; history: boolean }>()
  private readonly voicedQuotes = new Set<number>()
  private readonly counterparts = new Map<number, string>()
  private readonly offers = new Set<number>()
  private readonly seen = new Set<string>()
  private readonly spokenAt = new Map<string, number>()

  receive(raw: unknown, history: boolean, lang: Lang): BroadcastItem | null {
    if (!record(raw) || typeof raw.type !== 'string' || typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || !record(raw.payload)) return null
    const p = raw.payload
    const tick = integer(raw.tick) ? raw.tick : null
    if (raw.type === 'agent.hello' && teamId(p.team)) this.team = p.team
    if (this.team && raw.type === 'offer.listed' && record(p.offer) && p.offer.maker === this.team && integer(p.offer.id)) {
      this.offers.add(p.offer.id)
      while (this.offers.size > 500) this.offers.delete(this.offers.values().next().value ?? -1)
    }
    if ((raw.type === 'thread.message' || raw.type === 'thread.message.quote') && integer(p.thread)) {
      const quote = sentSalesQuote(raw, this.team, new Set([p.thread]))
      if (quote && !this.salesThreads.has(p.thread)) {
        this.pendingQuotes.set(p.thread, { event: { ...raw, payload: { ...p, text: quote } }, history })
        while (this.pendingQuotes.size > 100) this.pendingQuotes.delete(this.pendingQuotes.keys().next().value ?? -1)
        if (raw.type === 'thread.message.quote') return null
      }
    }
    const sales = salesThread(raw)
    if (sales !== null) {
      this.salesThreads.add(sales)
      while (this.salesThreads.size > 100) this.salesThreads.delete(this.salesThreads.values().next().value ?? -1)
      if (teamId(p.counterparty)) this.counterparts.set(sales, p.counterparty)
      while (this.counterparts.size > 100) this.counterparts.delete(this.counterparts.keys().next().value ?? -1)
      const pending = this.pendingQuotes.get(sales)
      if (pending) {
        this.pendingQuotes.delete(sales)
        const quote = this.receive({ ...pending.event, type: 'thread.message.quote' }, history || pending.history, lang)
        if (quote) return quote
      }
    }
    // Decision rows may be re-emitted with a new status; never hash or retain their private fields.
    const id = `broadcast:${raw.type}:${raw.id}:${label(p.status)}:${label(p.jev)}`
    if (this.seen.has(id)) return null
    this.seen.add(id)
    while (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value ?? '')
    let category: ActivityCategory
    let kind: ActivityLine
    let reference = ''
    let line: Line | null = null
    let urgent = false
    let quoteGroup: string | null = null
    switch (raw.type) {
      case 'clock': {
        if (tick === null || (this.tick !== null && tick < this.tick)) return null
        this.tick = tick
        this.seconds = typeof p.tick_seconds === 'number' && p.tick_seconds > 0 && p.tick_seconds <= 60 ? p.tick_seconds : null
        const day = label(p.day)
        const changed = Boolean(this.day && day && this.day !== day)
        if (day) this.day = day
        category = 'clock'; kind = changed ? 'round' : 'tick'; urgent = changed
        reference = `Tick ${tick}${this.seconds === null ? '' : ` · ${this.seconds}s`}${day ? ` · ${day}` : ''}`
        break
      }
      case 'agent.phase':
        if (p.phase !== 'observe' && p.phase !== 'decide' && p.phase !== 'act') return null
        category = 'clock'; kind = p.phase; reference = p.phase
        break
      case 'duel.started':
      case 'duel.message':
      case 'duel.result': {
        if (!integer(p.duel) || raw.scope !== 'team') return null
        category = 'duel'; reference = `Duel ${p.duel}`
        if (raw.type === 'duel.result') {
          if (typeof p.deal !== 'boolean') return null
          kind = p.deal ? 'duel_deal' : 'duel_no_deal'; urgent = true
        } else if (raw.type === 'duel.started') { kind = 'duel_start'; urgent = true }
        else {
          kind = 'duel_offer'
          if (integer(p.price) && p.price <= 10_000_000 && this.team) {
            const ours = p.sender === this.team
            line = { speaker: ours ? (p.role === 'seller' ? 'seller' : 'buyer') : guestSpeaker('duel-rival'), text: duelOfferLine(ours ? 'us' : 'them', p.price, lang), lang, ...(ours ? {} : { dealer: 'duel-rival' }) }
            reference += ` · ${ours ? 'our offer' : 'rival offer'} · ${p.price} P`
          }
        }
        break
      }
      case 'thread.opened':
        if (!integer(p.thread) || !teamId(p.team) || !teamId(p.with) || (p.team !== this.team && p.with !== this.team)) return null
        this.threads.add(p.thread)
        this.counterparts.set(p.thread, p.team === this.team ? p.with : p.team)
        while (this.counterparts.size > 100) this.counterparts.delete(this.counterparts.keys().next().value ?? -1)
        while (this.threads.size > 100) this.threads.delete(this.threads.values().next().value ?? -1)
        category = 'team'; kind = 'team_open'; reference = `Thread ${p.thread} · ${this.counterparts.get(p.thread)}`
        break
      case 'thread.message':
      case 'thread.message.quote':
      case 'thread.closed':
        if (!integer(p.thread) || (!this.threads.has(p.thread) && !this.salesThreads.has(p.thread))) return null
        category = 'team'; kind = raw.type === 'thread.closed' ? 'team_close' : 'team_message'; reference = `Thread ${p.thread} · ${this.counterparts.get(p.thread) ?? ''}`
        {
          const quote = sentSalesQuote(raw, this.team, this.salesThreads)
          if (quote) {
            const messageId = integer(p.feed_id) ? p.feed_id : raw.id
            if (this.voicedQuotes.has(messageId)) return null
            this.voicedQuotes.add(messageId)
            while (this.voicedQuotes.size > 500) this.voicedQuotes.delete(this.voicedQuotes.values().next().value ?? -1)
            quoteGroup = `sales-quote:${p.thread}`
            const language = detectLang(quote)
            line = { speaker: 'seller', dealer: 'sales', text: quote, lang: language === 'unknown' ? lang : language, silent: language === 'unknown' || language !== lang }
          }
        }
        if (raw.type === 'thread.closed') this.threads.delete(p.thread)
        break
      case 'settlement':
        if (!this.team || !Array.isArray(p.parties) || !p.parties.includes(this.team)) return null
        category = 'trade'; kind = 'trade'; urgent = true
        break
      case 'settlement.failed':
        if (!this.team || (!(Array.isArray(p.parties) && p.parties.includes(this.team)) && !(integer(p.offer) && this.offers.has(p.offer)) && raw.actor !== this.team)) return null
        category = 'incident'; kind = 'failure'; urgent = true
        if (integer(p.offer)) reference = `Offer ${p.offer}`
        break
      case 'bench.started':
      case 'bench.finished':
        category = 'market'; kind = raw.type === 'bench.started' ? 'bench_start' : 'bench_finish'; urgent = true
        if (integer(p.session)) reference = `Market Test ${p.session}`
        break
      case 'agent.decision': {
        if (!integer(p.decision)) return null
        reference = `Decision ${p.decision} · ${label(p.agent)}`
        if (p.status === 'failed') { category = 'incident'; kind = 'failure'; urgent = true; break }
        const verdict = typeof p.jev === 'string' ? jevLine(p.jev, lang) : null
        if (verdict) { category = 'jev'; kind = 'decide'; line = { speaker: 'jev', text: verdict, lang }; break }
        // DB decisions fill gaps when the public thread feed did not include a team conversation.
        if (p.status !== 'done') return null
        if (p.kind === 'team_cash_accept' || p.kind === 'team_accept') { category = 'team'; kind = 'team_accept' }
        else if (p.kind === 'team_open' || p.kind === 'sales_open') { category = 'team'; kind = 'team_open' }
        else if (p.kind === 'team_offer' || p.kind === 'team_cash_offer' || p.kind === 'sales_offer') { category = 'team'; kind = 'team_offer' }
        else if (p.kind === 'team_walk') { category = 'team'; kind = 'team_close' }
        else return null
        if (p.agent === 'sales' && teamId(p.counterparty) && (kind === 'team_open' || kind === 'team_offer')) {
          const text = salesLine(p.counterparty, kind === 'team_offer', lang)
          if (text) line = { speaker: 'seller', dealer: 'sales', text, lang }
          reference += ` · ${p.counterparty}`
        }
        break
      }
      default: return null
    }
    line ??= { speaker: 'narrator', text: activityLine(kind, lang), lang }
    const cadence = category === 'clock' ? 8 : category === 'jev' ? 4 : 2
    const group = quoteGroup ?? (urgent ? `${category}:${kind}` : category)
    const last = this.spokenAt.get(group)
    // No unclocked or historical voice, no repeated per-tick crowd chatter.
    const old = history || (tick !== null && this.tick !== null && tick < this.tick - 2)
    const speak = !old && tick !== null && (last === undefined || tick - last >= (urgent || quoteGroup ? 1 : cadence))
    if (speak && tick !== null) this.spokenAt.set(group, tick)
    while (this.spokenAt.size > 128) this.spokenAt.delete(this.spokenAt.keys().next().value ?? '')
    const activity: Activity = { id, tick, category, text: line.text, reference, history: old }
    return { activity, speak, beat: {
      id, tick, agent: 'taker', priority: urgent ? PRIORITY.dealer : category === 'clock' ? PRIORITY.other : PRIORITY.duel,
      lines: [line], mood: 'calm', cue: { kind: 'talk' }, denied: false,
      jev: category === 'jev' ? String(p.jev) : null, practice: false, note: reference || null,
    } }
  }
}
