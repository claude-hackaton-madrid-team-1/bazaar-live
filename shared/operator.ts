/** Exact operator actions. Free text is never interpreted as permission to send a trade. */
export type OperatorAction =
  | { kind: 'sell_list'; target: string; price: number; venue: string; expires: number }
  | { kind: 'sell_bid'; ref: string; price: number; venue: string; expires: number }
  | { kind: 'sell_cancel'; offer_id: number }
  | { kind: 'offer_accept'; offer_id: number; venue?: string }
  | { kind: 'team_offer'; side: 'buy' | 'sell'; thread_id: number; target: string; price: number; text: string }
  | { kind: 'team_open'; team_id: string; venue: string }
  | { kind: 'team_say'; thread_id: number; text: string }
  | { kind: 'team_close'; thread_id: number }

export const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const whole = (v: unknown, max = 10_000_000): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const keys = (v: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(v).every((k) => allowed.includes(k))

export function actionOf(v: unknown): OperatorAction | null {
  if (!record(v)) return null
  const { kind } = v
  if (kind === 'sell_list' || kind === 'sell_bid') {
    const key = kind === 'sell_list' ? 'target' : 'ref'
    if (!keys(v, ['kind', key, 'price', 'venue', 'expires']) || !whole(v.price) || !text(v.venue, 64) || !whole(v.expires, 480)) return null
    if (kind === 'sell_list' && text(v.target, 100)) return { kind, target: v.target, price: v.price, venue: v.venue, expires: v.expires }
    if (kind === 'sell_bid' && text(v.ref, 16) && /^[A-Z]{3}-\d{2}$/.test(v.ref)) return { kind, ref: v.ref, price: v.price, venue: v.venue, expires: v.expires }
  }
  if (kind === 'sell_cancel' && keys(v, ['kind', 'offer_id']) && whole(v.offer_id)) return { kind, offer_id: v.offer_id }
  if (kind === 'offer_accept' && keys(v, ['kind', 'offer_id', 'venue']) && whole(v.offer_id) && (v.venue === undefined || text(v.venue, 64))) return { kind, offer_id: v.offer_id, venue: v.venue ?? 'rastro' }
  if (kind === 'team_offer' && keys(v, ['kind', 'side', 'thread_id', 'target', 'price', 'text']) && (v.side === 'buy' || v.side === 'sell') && whole(v.thread_id) && text(v.target, 100) && whole(v.price) && typeof v.text === 'string' && v.text.length <= 1200) return { kind, side: v.side, thread_id: v.thread_id, target: v.target, price: v.price, text: v.text }
  if (kind === 'team_open' && keys(v, ['kind', 'team_id', 'venue']) && text(v.team_id, 16) && /^t\d{1,3}$/.test(v.team_id) && text(v.venue, 64)) return { kind, team_id: v.team_id, venue: v.venue }
  if (kind === 'team_say' && keys(v, ['kind', 'thread_id', 'text']) && whole(v.thread_id) && text(v.text, 1200)) return { kind, thread_id: v.thread_id, text: v.text }
  if (kind === 'team_close' && keys(v, ['kind', 'thread_id']) && whole(v.thread_id)) return { kind, thread_id: v.thread_id }
  return null
}

export interface OperatorProposal {
  proposal_id: string
  created_tick: number
  expires_tick: number
  status: string
  action: OperatorAction
  allowed: boolean
  reason: string
  summary: string
  world: string
  terms: Record<string, Term>
}
export const proposalIdOf = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(v)
export function proposalOf(v: unknown): OperatorProposal | null {
  if (!record(v) || !proposalIdOf(v.proposal_id)) return null
  const action = actionOf(v.action)
  const terms = termsOf(v.terms)
  if (!action || !terms || !(typeof v.created_tick === 'number' && Number.isSafeInteger(v.created_tick) && v.created_tick >= 0) || !whole(v.expires_tick) || typeof v.status !== 'string' || typeof v.allowed !== 'boolean' || typeof v.reason !== 'string' || typeof v.summary !== 'string' || typeof v.world !== 'string') return null
  if (v.allowed && !completeTerms(action, terms)) return null
  return { proposal_id: v.proposal_id, created_tick: Number(v.created_tick), expires_tick: v.expires_tick, status: v.status, action, allowed: v.allowed, reason: v.reason.slice(0, 2000), summary: v.summary.slice(0, 2000), world: v.world.slice(0, 50), terms }
}
export interface OperatorResult { proposal_id: string; status: string; sent: boolean | null; reason: string }
export function resultOf(v: unknown): OperatorResult | null {
  if (!record(v) || !proposalIdOf(v.proposal_id) || typeof v.status !== 'string' || (v.sent !== null && typeof v.sent !== 'boolean') || (v.reason !== undefined && typeof v.reason !== 'string')) return null
  return { proposal_id: v.proposal_id, status: v.status, sent: v.sent, reason: typeof v.reason === 'string' ? v.reason.slice(0, 2000) : v.sent === null ? 'Outcome unknown. Check status before taking any further action.' : v.sent ? 'Submitted to the game; settlement is not yet confirmed.' : 'No confirmed game submission.' }
}

/** Small private readout; never forward raw strategy inputs or nested API bodies. */
export interface OperatorSnapshot { facts: [string, string][]; incidents: string[]; evidence: string }
export function snapshotOf(v: unknown): OperatorSnapshot | null {
  if (!record(v) || typeof v.world !== 'string' || !record(v.clock) || !record(v.budget)) return null
  const facts: [string, string][] = [['World', v.world]]
  for (const [group, fields] of [['clock', ['tick', 'tick_seconds', 'doors', 'paused']], ['budget', ['action_seconds', 'accepts_used', 'listings_used']], ['context', ['round', 'service', 'deploy']], ['account', ['team', 'cash']], ['score_components', ['rank', 'negotiating', 'market', 'neg_points', 'ladder_points', 'duel_points', 'bench_points', 'organic_points']], ['activity', ['state', 'reason']]] as const) {
    const source = v[group]
    if (!record(source)) continue
    for (const key of fields) { const value = source[key]; if (['string', 'number', 'boolean'].includes(typeof value)) facts.push([key.replaceAll('_', ' '), String(value).slice(0, 100)]) }
  }
  const incidents = Array.isArray(v.incidents) ? v.incidents.slice(0, 6).filter(record).map((row) => [row.tick, row.kind, row.status, row.reason].filter((x) => ['string', 'number'].includes(typeof x)).join(' · ').slice(0, 300)) : []
  return { facts, incidents, evidence: typeof v.evidence === 'string' ? v.evidence.slice(0, 300) : 'Some sources may be unavailable.' }
}

export type Term = string | number | boolean | null | Term[] | { [key: string]: Term }
/** Canonical, bounded JSON keeps every reviewed term visible and comparable. */
export function termsOf(v: unknown): Record<string, Term> | null {
  function clean(value: unknown, depth: number): Term {
    if (depth > 5) throw new Error('terms too deep')
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string' && value.length <= 1200) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (Array.isArray(value) && value.length <= 30) return value.map((x) => clean(x, depth + 1))
    if (record(value) && Object.keys(value).length <= 30) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, x]) => { if (key.length > 80) throw new Error('term key too long'); return [key, clean(x, depth + 1)] }))
    throw new Error('invalid term')
  }
  try { return record(v) ? clean(v, 0) as Record<string, Term> : null } catch { return null }
}

export function termFacts(terms: Record<string, Term>): [string, string][] {
  const facts: [string, string][] = []
  function visit(value: Term, path: string): void {
    if (record(value)) for (const [key, v] of Object.entries(value)) visit(v as Term, path ? `${path} / ${key}` : key)
    else facts.push([path.replaceAll('_', ' '), Array.isArray(value) ? JSON.stringify(value) : String(value ?? 'none')])
  }
  visit(terms, '')
  const offer = terms.offer
  if (record(offer) && typeof offer.price === 'number' && typeof terms.fee === 'number') {
    if (offer.side === 'ask') facts.push(['Total cash debit (price + fee)', String(offer.price + terms.fee)])
    if (offer.side === 'bid') facts.push(['Net cash received (price − fee)', String(offer.price - terms.fee)])
  }
  return facts
}

function completeTerms(action: OperatorAction, terms: Record<string, Term>): boolean {
  if (action.kind === 'offer_accept') {
    const offer = terms.offer
    return record(offer) && offer.id === action.offer_id && text(offer.ref, 16) && text(offer.maker, 100) && text(offer.venue, 64) && (offer.side === 'ask' || offer.side === 'bid') && whole(offer.price) && typeof terms.fee === 'number' && Number.isSafeInteger(terms.fee) && terms.fee >= 0 && Array.isArray(terms.assets)
  }
  if (action.kind === 'sell_list' || action.kind === 'sell_bid' || action.kind === 'team_offer') return text(terms.ref, 16) && terms.price === action.price && text(terms.venue, 64) && record(terms.give) && record(terms.want)
  return true
}
