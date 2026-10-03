/**
 * The Approvals screen's source and its pure rules. Every request goes to our own server (/api/approver/*) with the
 * session cookie (same-origin) and, for a write, the CSRF token the login gave, held in memory only: never in
 * storage, the URL or the console. The server calls bazaar-mcp; the page never sees a token.
 */
import {
  approvalsOf, approveResultOf, CONTRACT_LIMITS, DENY_REASON, REASON_MAX, revokeResultOf,
  type ActiveApproval, type ApprovalLimits, type ApprovalsSnapshot, type ApproveInput, type ApproveResult, type PendingRequest, type PendingState,
  type RevokeInput, type RevokeResult, type Side,
} from '../../shared/approvals.ts'

export const REFRESH_MS = 10_000

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

async function jsonOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}

const send = (path: string, body: unknown, csrf?: string): Promise<Response> =>
  fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    body: JSON.stringify(body),
  })

// ── the session ─────────────────────────────────────────────────────────────────────────────────

export type LoginOutcome =
  | { readonly kind: 'in'; readonly csrf: string }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly minutes: number }
  | { readonly kind: 'error' }

/** The login's answer → what the screen does next. */
export function loginOutcomeOf(status: number, body: unknown, retryAfter: string | null): LoginOutcome {
  if (status === 200 && isObject(body) && typeof body.csrf === 'string' && body.csrf) return { kind: 'in', csrf: body.csrf }
  if (status === 401) return { kind: 'wrong' }
  if (status === 429) {
    const seconds = Number(retryAfter)
    return { kind: 'locked', minutes: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : 15 }
  }
  return { kind: 'error' }
}

/** The CSRF token of a live session, null when there is none; undefined when the server could not say. */
export async function readSession(signal?: AbortSignal): Promise<string | null | undefined> {
  try {
    const res = await fetch('/api/approver/session', { credentials: 'same-origin', cache: 'no-store', signal })
    const body = await jsonOf(res)
    if (res.status !== 200 || !isObject(body)) return undefined
    return body.authenticated === true && typeof body.csrf === 'string' ? body.csrf : null
  } catch {
    return undefined
  }
}

export async function login(password: string): Promise<LoginOutcome> {
  try {
    const res = await send('/api/approver/login', { password })
    return loginOutcomeOf(res.status, await jsonOf(res), res.headers.get('retry-after'))
  } catch {
    return { kind: 'error' }
  }
}

export async function logout(): Promise<void> {
  await send('/api/approver/logout', {}).catch(() => undefined)
}

// ── reading ────────────────────────────────────────────────────────────────────────────────────

export type ReadOutcome =
  | { readonly kind: 'live'; readonly snapshot: ApprovalsSnapshot }
  | { readonly kind: 'expired' }
  | { readonly kind: 'unavailable' }

export function readOutcomeOf(status: number, body: unknown): ReadOutcome {
  if (status === 401) return { kind: 'expired' }
  const snapshot = status === 200 ? approvalsOf(body) : null
  return snapshot ? { kind: 'live', snapshot } : { kind: 'unavailable' }
}

export async function readApprovals(signal?: AbortSignal): Promise<ReadOutcome> {
  const res = await fetch('/api/approver/approvals', { credentials: 'same-origin', cache: 'no-store', signal })
  return readOutcomeOf(res.status, await jsonOf(res))
}

// ── writing ────────────────────────────────────────────────────────────────────────────────────

export type WriteError = 'expired' | 'csrf' | 'rate_limited' | 'bad_request' | 'unavailable' | 'tool' | 'network'

export type WriteOutcome =
  | { readonly kind: 'approve'; readonly result: ApproveResult }
  | { readonly kind: 'revoke'; readonly result: RevokeResult }
  | { readonly kind: 'error'; readonly error: WriteError }

/** A write's answer → what the row shows. Never the server's own words: only which kind of failure. */
export function writeOutcomeOf(tool: 'approve' | 'revoke', status: number, body: unknown): WriteOutcome {
  if (status === 200) {
    if (tool === 'approve') {
      const result = approveResultOf(body)
      if (result) return { kind: 'approve', result }
    } else {
      const result = revokeResultOf(body)
      if (result) return { kind: 'revoke', result }
    }
    return { kind: 'error', error: 'unavailable' }
  }
  const code = isObject(body) ? body.error : null
  if (status === 401) return { kind: 'error', error: 'expired' }
  if (status === 403) return { kind: 'error', error: code === 'csrf' ? 'csrf' : 'expired' }
  if (status === 429) return { kind: 'error', error: 'rate_limited' }
  if (status === 400 || status === 413 || status === 415) return { kind: 'error', error: 'bad_request' }
  if (status === 502 && code === 'tool_error') return { kind: 'error', error: 'tool' }
  return { kind: 'error', error: 'unavailable' }
}

export async function approve(csrf: string, input: ApproveInput): Promise<WriteOutcome> {
  try {
    const res = await send('/api/approver/approve', input, csrf)
    return writeOutcomeOf('approve', res.status, await jsonOf(res))
  } catch {
    return { kind: 'error', error: 'network' }
  }
}

/** Revoke an approval, or (no approval live) deny a request: bazaar-mcp records a denial. */
export async function revoke(csrf: string, input: RevokeInput): Promise<WriteOutcome> {
  try {
    const res = await send('/api/approver/revoke', input, csrf)
    return writeOutcomeOf('revoke', res.status, await jsonOf(res))
  } catch {
    return { kind: 'error', error: 'network' }
  }
}

export const denyInput = (row: Pick<PendingRequest, 'card' | 'side'>): RevokeInput => ({ card: row.card, side: row.side, reason: DENY_REASON })

// ── the rules the screen shows ─────────────────────────────────────────────────────────────────

const STATE_ORDER: Readonly<Record<PendingState, number>> = { waiting: 0, approved: 1, denied: 2 }

/** Waiting requests first (the one that goes stale soonest first), then approved, then denied (newest first). */
export function orderPending(rows: readonly PendingRequest[]): PendingRequest[] {
  const staleKey = (r: PendingRequest) => r.stale_after_tick ?? Number.POSITIVE_INFINITY
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state]
    if (byState !== 0) return byState
    if (a.state === 'waiting') return staleKey(a) - staleKey(b)
    return (b.asked_tick ?? 0) - (a.asked_tick ?? 0)
  })
}

/** Active approvals by the tick they end, soonest first. */
export function orderActive(rows: readonly ActiveApproval[]): ActiveApproval[] {
  return [...rows].sort((a, b) => a.until_tick - b.until_tick)
}

export const rowKey = (r: Pick<PendingRequest, 'card' | 'side' | 'price' | 'asked_tick'>): string => `${r.card}|${r.side}|${r.price}|${r.asked_tick ?? ''}`

/** Ticks until `until` from `now` (negative once past). */
export const ticksLeft = (until: number, now: number): number => until - now

/** Whether a request has gone stale at `tick`: its ticks left, or null when it has no stale tick. */
export function staleness(row: Pick<PendingRequest, 'stale_after_tick'>, tick: number): { readonly stale: boolean; readonly left: number | null } {
  if (row.stale_after_tick === null) return { stale: false, left: null }
  const left = ticksLeft(row.stale_after_tick, tick)
  return { stale: left < 0, left }
}

export interface PriceBounds {
  readonly min: number
  readonly max: number
  /** The guardrail cap a buy's approval can never lift, when it is the lower bound. */
  readonly cap: { readonly max: number; readonly rule: string } | null
}

/** The prices the form accepts: the contract's range, and for a buy never above its hard cap. */
export function priceBounds(row: Pick<PendingRequest, 'side' | 'cap'>, limits: ApprovalLimits = CONTRACT_LIMITS): PriceBounds {
  const capMax = row.side === 'buy' && row.cap ? Math.floor(row.cap.max_price) : null
  if (capMax !== null && row.cap && capMax < limits.price_max) return { min: limits.price_min, max: capMax, cap: { max: capMax, rule: row.cap.rule } }
  return { min: limits.price_min, max: limits.price_max, cap: null }
}

export type PriceError = 'not_integer' | 'below' | 'above_cap' | 'above_max'
export type TtlError = 'range'

const wholeNumber = (raw: string): number | null => (/^\s*\d+\s*$/.test(raw) ? Number(raw) : null)

export function checkPrice(raw: string, bounds: PriceBounds): { readonly ok: true; readonly price: number } | { readonly ok: false; readonly error: PriceError } {
  const price = wholeNumber(raw)
  if (price === null) return { ok: false, error: 'not_integer' }
  if (price < bounds.min) return { ok: false, error: 'below' }
  if (price > bounds.max) return { ok: false, error: bounds.cap ? 'above_cap' : 'above_max' }
  return { ok: true, price }
}

export function checkTtl(raw: string, limits: ApprovalLimits = CONTRACT_LIMITS): { readonly ok: true; readonly ttl: number } | { readonly ok: false; readonly error: TtlError } {
  const ttl = wholeNumber(raw)
  return ttl !== null && ttl >= limits.ttl_min && ttl <= limits.ttl_max ? { ok: true, ttl } : { ok: false, error: 'range' }
}

export const reasonTooLong = (reason: string): boolean => reason.trim().length > REASON_MAX

/** The approve body from the form, or null while a field is wrong. */
export function approveInputFrom(row: Pick<PendingRequest, 'card' | 'side' | 'cap'>, form: { price: string; ttl: string; reason: string }, limits: ApprovalLimits = CONTRACT_LIMITS): ApproveInput | null {
  const price = checkPrice(form.price, priceBounds(row, limits))
  const ttl = checkTtl(form.ttl, limits)
  if (!price.ok || !ttl.ok || reasonTooLong(form.reason)) return null
  const reason = form.reason.trim()
  return { card: row.card, side: row.side, price: price.price, ttl_ticks: ttl.ttl, ...(reason ? { reason } : {}) }
}

/** An approval's price as the human reads it: a buy up to its max, a sell down to its min. */
export function approvalLimitOf(a: Pick<ActiveApproval, 'side' | 'max_price' | 'min_price'>): { readonly side: Side; readonly price: number | null } {
  return { side: a.side, price: a.side === 'buy' ? a.max_price : a.min_price }
}
