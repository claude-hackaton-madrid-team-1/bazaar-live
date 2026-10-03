/**
 * The Approvals screen's contract (HA2): what bazaar-mcp's human tools answer (`approvals`, `approve`, `revoke`),
 * checked field by field, and what a human may send. The server checks the MCP's reply with these guards and passes
 * on only the fields named here; the page checks its form with the same ranges before it sends anything.
 *
 * Field names stay as the MCP writes them (snake_case), so nothing is renamed on the way to the page.
 */

export const CARD_PATTERN = /^[A-Z]{3}-\d{2}$/
export const PRICE_MIN = 1
export const PRICE_MAX = 1000
export const TTL_MIN = 1
export const TTL_MAX = 480
export const TTL_DEFAULT = 240
export const REASON_MAX = 300
/** Who asked, as bazaar-mcp records it beside `human:`. */
export const VIA = 'bazaar-live'
/** The reason a Deny sends (a deny is a `revoke` with no active approval: bazaar-mcp records a denial). */
export const DENY_REASON = 'denied from Bazaar Live'

/** Most rows the page is ever handed: a reply longer than this is cut, never rendered whole. */
const MAX_ROWS = 200
const MAX_NOTES = 10
const MAX_TEXT = 300

export type Side = 'buy' | 'sell'
export type PendingState = 'waiting' | 'approved' | 'denied'

export interface AlbumImpact {
  readonly set: string
  readonly held: number
  readonly page_card: boolean
  readonly last_copy: boolean
}

export interface PriceCap {
  readonly max_price: number
  readonly rule: string
}

/** A buy or sell our agents refused until a human says yes. */
export interface PendingRequest {
  readonly card: string
  readonly side: Side
  readonly price: number
  readonly asked_tick: number | null
  readonly stale_after_tick: number | null
  readonly state: PendingState
  readonly counterparty: string | null
  /** The write kind that asked: accept_buy, bid, buy, sell, dealer_sell... */
  readonly asked_by: string | null
  readonly why: string | null
  readonly official_value: number | null
  readonly our_value: number | null
  readonly score_impact: number | null
  readonly album: AlbumImpact | null
  readonly cap: PriceCap | null
}

/** A human's yes, live until `until_tick`: a buy up to `max_price`, a sell down to `min_price`. */
export interface ActiveApproval {
  readonly card: string
  readonly side: Side
  readonly max_price: number | null
  readonly min_price: number | null
  readonly until_tick: number
  readonly by: string | null
  readonly reason: string | null
  readonly created_at: string | null
}

export interface ApprovalLimits {
  readonly price_min: number
  readonly price_max: number
  readonly ttl_min: number
  readonly ttl_max: number
  readonly ttl_default: number
  readonly writes_per_minute: number
}

export interface ApprovalsSnapshot {
  readonly tick: number
  readonly threshold: number
  readonly pending: readonly PendingRequest[]
  readonly active: readonly ActiveApproval[]
  readonly limits: ApprovalLimits
  readonly notes: readonly string[]
  /** Rows the server could not read and left out (0 normally). */
  readonly skipped: number
}

export type ApproveResult =
  | {
      readonly status: 'approved'
      readonly card: string
      readonly side: Side
      readonly max_price: number | null
      readonly min_price: number | null
      readonly until_tick: number | null
      readonly tick: number | null
      readonly by: string | null
      readonly notes: readonly string[]
    }
  | {
      readonly status: 'refused'
      readonly card: string
      readonly side: Side
      readonly price: number | null
      readonly reasons: readonly string[]
    }

export interface RevokeResult {
  readonly status: 'revoked' | 'denied'
  readonly card: string
  readonly side: Side
  readonly tick: number | null
  readonly by: string | null
}

export interface ApproveInput {
  readonly card: string
  readonly side: Side
  readonly price: number
  readonly ttl_ticks: number
  readonly reason?: string
}

export interface RevokeInput {
  readonly card: string
  readonly side: Side
  readonly reason?: string
}

export const CONTRACT_LIMITS: ApprovalLimits = {
  price_min: PRICE_MIN,
  price_max: PRICE_MAX,
  ttl_min: TTL_MIN,
  ttl_max: TTL_MAX,
  ttl_default: TTL_DEFAULT,
  writes_per_minute: 10,
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// C0 and C1 controls, DEL, and the bidi overrides and isolates that could make a line read as something else.
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

/** A string with its control characters made spaces and trimmed, or null when it is not a string. */
export function stripControls(v: unknown): string | null {
  return typeof v === 'string' ? v.replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim() : null
}

/** A string for display: cleaned and cut at `max` characters; null when absent or empty. */
function text(v: unknown, max = MAX_TEXT): string | null {
  const clean = stripControls(v)
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const isSide = (v: unknown): v is Side => v === 'buy' || v === 'sell'
const isState = (v: unknown): v is PendingState => v === 'waiting' || v === 'approved' || v === 'denied'
const isCard = (v: unknown): v is string => typeof v === 'string' && CARD_PATTERN.test(v)
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.slice(0, MAX_NOTES).flatMap((s) => text(s) ?? []) : [])

function albumOf(v: unknown): AlbumImpact | null {
  if (!isObject(v)) return null
  const held = int(v.held)
  const set = text(v.set, 8)
  if (held === null || set === null || typeof v.page_card !== 'boolean' || typeof v.last_copy !== 'boolean') return null
  return { set, held, page_card: v.page_card, last_copy: v.last_copy }
}

function capOf(v: unknown): PriceCap | null {
  if (!isObject(v)) return null
  const max = num(v.max_price)
  const rule = text(v.rule, 60)
  return max === null || rule === null ? null : { max_price: max, rule }
}

export function pendingOf(v: unknown): PendingRequest | null {
  if (!isObject(v) || !isCard(v.card) || !isSide(v.side) || !isState(v.state)) return null
  const price = num(v.price)
  if (price === null || price <= 0) return null
  return {
    card: v.card,
    side: v.side,
    price,
    asked_tick: int(v.asked_tick),
    stale_after_tick: int(v.stale_after_tick),
    state: v.state,
    counterparty: text(v.counterparty, 40),
    asked_by: text(v.asked_by, 40),
    why: text(v.why),
    official_value: num(v.official_value),
    our_value: num(v.our_value),
    score_impact: num(v.score_impact),
    album: albumOf(v.album),
    cap: capOf(v.cap),
  }
}

export function activeOf(v: unknown): ActiveApproval | null {
  if (!isObject(v) || !isCard(v.card) || !isSide(v.side)) return null
  const until = int(v.until_tick)
  if (until === null) return null
  return {
    card: v.card,
    side: v.side,
    max_price: num(v.max_price),
    min_price: num(v.min_price),
    until_tick: until,
    by: text(v.by, 60),
    reason: text(v.reason),
    created_at: text(v.created_at, 40),
  }
}

function limitsOf(v: unknown): ApprovalLimits {
  if (!isObject(v)) return CONTRACT_LIMITS
  // a value outside the contract's own range is not trusted: the contract's bound stays
  const pick = (key: keyof ApprovalLimits, lo: number, hi: number): number => {
    const n = int(v[key])
    return n !== null && n >= lo && n <= hi ? n : CONTRACT_LIMITS[key]
  }
  const price_min = pick('price_min', PRICE_MIN, PRICE_MAX)
  const price_max = pick('price_max', price_min, PRICE_MAX)
  const ttl_min = pick('ttl_min', TTL_MIN, TTL_MAX)
  const ttl_max = pick('ttl_max', ttl_min, TTL_MAX)
  return {
    price_min,
    price_max,
    ttl_min,
    ttl_max,
    ttl_default: pick('ttl_default', ttl_min, ttl_max),
    writes_per_minute: pick('writes_per_minute', 1, 600),
  }
}

/** The `approvals` tool's answer, or null when its shape is not the contract's. A row that is not is left out and counted. */
export function approvalsOf(body: unknown): ApprovalsSnapshot | null {
  if (!isObject(body) || !Array.isArray(body.pending) || !Array.isArray(body.active)) return null
  const tick = int(body.tick)
  const threshold = num(body.threshold)
  if (tick === null || threshold === null) return null
  const pending = body.pending.slice(0, MAX_ROWS).map(pendingOf)
  const active = body.active.slice(0, MAX_ROWS).map(activeOf)
  const kept = <T>(rows: (T | null)[]): T[] => rows.filter((r): r is T => r !== null)
  const skipped = pending.length + active.length - kept(pending).length - kept(active).length
  return {
    tick,
    threshold,
    pending: kept(pending),
    active: kept(active),
    limits: limitsOf(body.limits),
    notes: texts(body.notes),
    skipped,
  }
}

/** The `approve` tool's answer, or null. */
export function approveResultOf(body: unknown): ApproveResult | null {
  if (!isObject(body) || !isCard(body.card) || !isSide(body.side)) return null
  if (body.status === 'approved') {
    return {
      status: 'approved',
      card: body.card,
      side: body.side,
      max_price: num(body.max_price),
      min_price: num(body.min_price),
      until_tick: int(body.until_tick),
      tick: int(body.tick),
      by: text(body.by, 60),
      notes: texts(body.notes),
    }
  }
  if (body.status === 'refused') {
    return { status: 'refused', card: body.card, side: body.side, price: num(body.price), reasons: texts(body.reasons) }
  }
  return null
}

/** The `revoke` tool's answer, or null. */
export function revokeResultOf(body: unknown): RevokeResult | null {
  if (!isObject(body) || !isCard(body.card) || !isSide(body.side)) return null
  if (body.status !== 'revoked' && body.status !== 'denied') return null
  return { status: body.status, card: body.card, side: body.side, tick: int(body.tick), by: text(body.by, 60) }
}

/** An optional reason: undefined when absent or blank, the cleaned text, or an error when it is not text or too long. */
function reasonOf(v: unknown): { ok: true; reason: string | undefined } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, reason: undefined }
  const clean = stripControls(v)
  if (clean === null) return { ok: false, error: 'reason must be text' }
  if (clean.length > REASON_MAX) return { ok: false, error: `reason must be at most ${REASON_MAX} characters` }
  return { ok: true, reason: clean || undefined }
}

const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

/** A body for `approve`, or why not (the message names the field and its range, never echoes the value). */
export function approveInputOf(body: unknown): ApproveInput | string {
  if (!isObject(body)) return 'body must be an object'
  if (!isCard(body.card)) return 'card must look like SAL-09'
  if (!isSide(body.side)) return 'side must be buy or sell'
  if (!inRange(body.price, PRICE_MIN, PRICE_MAX)) return `price must be an integer from ${PRICE_MIN} to ${PRICE_MAX}`
  const ttl = body.ttl_ticks === undefined ? TTL_DEFAULT : body.ttl_ticks
  if (!inRange(ttl, TTL_MIN, TTL_MAX)) return `ttl_ticks must be an integer from ${TTL_MIN} to ${TTL_MAX}`
  const reason = reasonOf(body.reason)
  if (!reason.ok) return reason.error
  return { card: body.card, side: body.side, price: body.price, ttl_ticks: ttl, ...(reason.reason ? { reason: reason.reason } : {}) }
}

/** A body for `revoke`, or why not. */
export function revokeInputOf(body: unknown): RevokeInput | string {
  if (!isObject(body)) return 'body must be an object'
  if (!isCard(body.card)) return 'card must look like SAL-09'
  if (!isSide(body.side)) return 'side must be buy or sell'
  const reason = reasonOf(body.reason)
  if (!reason.ok) return reason.error
  return { card: body.card, side: body.side, ...(reason.reason ? { reason: reason.reason } : {}) }
}
