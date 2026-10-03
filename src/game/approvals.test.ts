import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTRACT_LIMITS, type PendingRequest } from '../../shared/approvals.ts'
import {
  albumLineOf, approvalLimitOf, approve, liveApprovalFor, prefillPrice, sessionOutcomeOf, approveInputFrom, checkPrice, checkTtl, confirmClickCounts, CONFIRM_DELAY_MS, denyInput, login, loginOutcomeOf, orderActive, orderPending, priceBounds, priceWarningOf,
  readOutcomeOf, readSession, revoke, staleness, writeOutcomeOf,
} from './approvals.ts'
import { APPROVALS_STRINGS } from './approvalsStrings.ts'
import { probeOutcomeOf } from '../ui/approver.ts'

const row = (over: Partial<PendingRequest> = {}): PendingRequest => ({
  card: 'SAL-09', side: 'buy', price: 260, asked_tick: 905, stale_after_tick: 1145, state: 'waiting', counterparty: 'chato', asked_by: 'accept_buy',
  why: 'price 260 ≥ human_approval_above 250', official_value: 177.1, our_value: 150, score_impact: -4.3,
  album: { set: 'SAL', held: 1, page_card: true, last_copy: true }, cap: null, ...over,
})

describe('orderPending', () => {
  it('puts waiting first (soonest stale first), then approved, then denied (newest first)', () => {
    const rows = [
      row({ card: 'LAV-01', state: 'denied', asked_tick: 900 }),
      row({ card: 'LAV-02', state: 'approved', asked_tick: 901 }),
      row({ card: 'LAV-03', state: 'waiting', stale_after_tick: 1200 }),
      row({ card: 'LAV-04', state: 'denied', asked_tick: 950 }),
      row({ card: 'LAV-05', state: 'waiting', stale_after_tick: 1000 }),
      row({ card: 'LAV-06', state: 'waiting', stale_after_tick: null }),
    ]
    expect(orderPending(rows).map((r) => r.card)).toEqual(['LAV-05', 'LAV-03', 'LAV-06', 'LAV-02', 'LAV-04', 'LAV-01'])
    expect(rows[0]!.card).toBe('LAV-01')
  })

  it('orders active approvals by the tick they end', () => {
    const a = { card: 'SAL-09', side: 'buy' as const, max_price: 260, min_price: null, until_tick: 1200, by: null, reason: null, created_at: null }
    expect(orderActive([a, { ...a, card: 'LAV-01', until_tick: 1000 }]).map((r) => r.card)).toEqual(['LAV-01', 'SAL-09'])
  })
})

describe('staleness', () => {
  it('counts the ticks left, and says stale once past', () => {
    expect(staleness(row(), 1000)).toEqual({ stale: false, left: 145 })
    expect(staleness(row(), 1145)).toEqual({ stale: false, left: 0 })
    expect(staleness(row(), 1146)).toEqual({ stale: true, left: -1 })
    expect(staleness(row({ stale_after_tick: null }), 1146)).toEqual({ stale: false, left: null })
  })
})

describe('the approve form', () => {
  it('caps a buy at its hard cap, never a sell', () => {
    const capped = row({ cap: { max_price: 95, rule: 'max_price_rare' } })
    expect(priceBounds(capped)).toEqual({ min: 1, max: 95, cap: { max: 95, rule: 'max_price_rare' } })
    expect(priceBounds({ ...capped, side: 'sell' })).toEqual({ min: 1, max: 1000, cap: null })
    expect(priceBounds(row())).toEqual({ min: 1, max: 1000, cap: null })
    expect(checkPrice('260', priceBounds(capped))).toEqual({ ok: false, error: 'above_cap' })
    expect(checkPrice('95', priceBounds(capped))).toEqual({ ok: true, price: 95 })
  })

  it('takes whole primas and ticks inside the contract only', () => {
    const b = priceBounds(row())
    expect(checkPrice('1.5', b)).toEqual({ ok: false, error: 'not_integer' })
    expect(checkPrice('', b)).toEqual({ ok: false, error: 'not_integer' })
    expect(checkPrice('0', b)).toEqual({ ok: false, error: 'below' })
    expect(checkPrice('1001', b)).toEqual({ ok: false, error: 'above_max' })
    expect(checkTtl('240')).toEqual({ ok: true, ttl: 240 })
    expect(checkTtl('481')).toEqual({ ok: false, error: 'range' })
    expect(checkTtl('0')).toEqual({ ok: false, error: 'range' })
  })

  it('builds the approve body, or nothing while a field is wrong', () => {
    expect(approveInputFrom(row(), { price: '260', ttl: '240', reason: '  page bonus ' })).toEqual({ card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240, reason: 'page bonus' })
    expect(approveInputFrom(row(), { price: '260', ttl: '240', reason: '' })).toEqual({ card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240 })
    expect(approveInputFrom(row(), { price: '260', ttl: '240', reason: 'x'.repeat(301) })).toBeNull()
    expect(approveInputFrom(row(), { price: '260', ttl: '999', reason: '' })).toBeNull()
    expect(approveInputFrom(row({ cap: { max_price: 95, rule: 'max_price_rare' } }), { price: '260', ttl: '240', reason: '' })).toBeNull()
  })

  it('counts a confirm click only on its own and not too soon after Approve', () => {
    expect(confirmClickCounts(1, CONFIRM_DELAY_MS)).toBe(true)
    expect(confirmClickCounts(0, CONFIRM_DELAY_MS + 1)).toBe(true)
    expect(confirmClickCounts(2, 5000)).toBe(false)
    expect(confirmClickCounts(1, CONFIRM_DELAY_MS - 1)).toBe(false)
  })

  it('warns on a buy above the official value and a sell below our value', () => {
    expect(priceWarningOf(row(), 260)).toEqual({ kind: 'above_official', value: 177.1 })
    expect(priceWarningOf(row(), 170)).toBeNull()
    expect(priceWarningOf(row({ side: 'sell' }), 140)).toEqual({ kind: 'below_ours', value: 150 })
    expect(priceWarningOf(row({ side: 'sell' }), 160)).toBeNull()
    expect(priceWarningOf(row({ official_value: null }), 999)).toBeNull()
  })

  it('denies with the contract\'s reason', () => {
    expect(denyInput(row())).toEqual({ card: 'SAL-09', side: 'buy', reason: 'denied from Bazaar Live' })
  })

  it('reads an approval as up to (buy) or down to (sell)', () => {
    expect(approvalLimitOf({ side: 'buy', max_price: 260, min_price: null })).toEqual({ side: 'buy', price: 260 })
    expect(approvalLimitOf({ side: 'sell', max_price: null, min_price: 300 })).toEqual({ side: 'sell', price: 300 })
  })
})

describe('the probe and the session', () => {
  it('turns approvals off only on a 404; anything else is asked again', () => {
    expect(probeOutcomeOf(200, null)).toEqual({ kind: 'on' })
    expect(probeOutcomeOf(404, null)).toEqual({ kind: 'off' })
    expect(probeOutcomeOf(429, '30')).toEqual({ kind: 'retry', retryS: 30 })
    expect(probeOutcomeOf(429, '900')).toEqual({ kind: 'retry', retryS: 60 })
    expect(probeOutcomeOf(502, null)).toEqual({ kind: 'retry', retryS: 5 })
    expect(probeOutcomeOf(null, null)).toEqual({ kind: 'retry', retryS: 5 })
    expect(sessionOutcomeOf(404, null, null)).toEqual({ kind: 'unknown', retryS: 5 })
  })
})

describe('what a request does', () => {
  const active = { card: 'SAL-09', side: 'buy' as const, max_price: 270, min_price: null, until_tick: 1000, by: null, reason: null, created_at: null }

  it('finds the live approval a Deny would revoke too', () => {
    expect(liveApprovalFor(row(), [active], 912)).toBe(active)
    expect(liveApprovalFor(row(), [active], 1001)).toBeNull()
    expect(liveApprovalFor(row({ side: 'sell' }), [active], 912)).toBeNull()
    expect(liveApprovalFor(row({ card: 'LAV-01' }), [active], 912)).toBeNull()
  })

  it('prefills whole primas that still cover the request: a buy rounded up, a sell down', () => {
    expect(prefillPrice(row({ price: 260.2 }))).toBe(261)
    expect(prefillPrice(row({ side: 'sell', price: 280.8 }))).toBe(280)
    expect(prefillPrice(row())).toBe(260)
  })

  it('says LAST COPY only for a sell, and duplicate or a page slot for a buy', () => {
    const album = { set: 'SAL', held: 1, page_card: true, last_copy: true }
    expect(albumLineOf(row({ side: 'sell', album }))).toEqual({ kind: 'last_copy', held: 1 })
    expect(albumLineOf(row({ side: 'buy', album }))).toEqual({ kind: 'duplicate', held: 1 })
    expect(albumLineOf(row({ side: 'buy', album: { ...album, held: 0, last_copy: false } }))).toEqual({ kind: 'fills_slot' })
    expect(albumLineOf(row({ side: 'sell', album: { ...album, held: 2, last_copy: false } }))).toEqual({ kind: 'held', held: 2 })
    expect(albumLineOf(row({ album: null }))).toBeNull()
    const en = APPROVALS_STRINGS.en
    expect(en.album({ kind: 'duplicate', held: 1 }, 'SAL-09', album)).toBe('duplicate: we already hold 1 of SAL-09')
    expect(en.album({ kind: 'fills_slot' }, 'SAL-09', album)).toBe('fills a page slot in SAL')
    expect(en.album({ kind: 'last_copy', held: 1 }, 'SAL-09', album)).toBe('we hold 1 of SAL-09 · a page card')
    expect(en.liveApproval('buy', 270)).toBe('a live approval up to 270 P exists: revoke it below')
  })
})

describe('the server\'s answers', () => {
  it('reads a login', () => {
    expect(loginOutcomeOf(200, { csrf: 'abc' }, null)).toEqual({ kind: 'in', csrf: 'abc' })
    expect(loginOutcomeOf(200, {}, null)).toEqual({ kind: 'error' })
    expect(loginOutcomeOf(401, { error: 'unauthorized' }, null)).toEqual({ kind: 'wrong' })
    expect(loginOutcomeOf(429, { error: 'locked' }, '840')).toEqual({ kind: 'locked', minutes: 14 })
    expect(loginOutcomeOf(429, { error: 'locked' }, null)).toEqual({ kind: 'locked', minutes: 15 })
    expect(loginOutcomeOf(404, { error: 'not_found' }, null)).toEqual({ kind: 'error' })
  })

  it('reads the approvals, a lapsed session and an unavailable service', () => {
    expect(readOutcomeOf(401, null)).toEqual({ kind: 'expired' })
    expect(readOutcomeOf(502, { error: 'approvals unavailable' })).toEqual({ kind: 'unavailable' })
    expect(readOutcomeOf(200, { nope: 1 })).toEqual({ kind: 'unavailable' })
    expect(readOutcomeOf(200, { tick: 1, threshold: 250, pending: [], active: [] })).toMatchObject({ kind: 'live', snapshot: { tick: 1, limits: CONTRACT_LIMITS } })
  })

  it('reads a write by its kind of failure, never by the server\'s words', () => {
    expect(writeOutcomeOf('approve', 200, { status: 'refused', card: 'SAL-09', side: 'buy', price: 260, reasons: ['cap'] })).toMatchObject({ kind: 'approve', result: { status: 'refused' } })
    expect(writeOutcomeOf('revoke', 200, { status: 'denied', card: 'SAL-09', side: 'buy' })).toMatchObject({ kind: 'revoke', result: { status: 'denied' } })
    expect(writeOutcomeOf('revoke', 200, { status: 'approved', card: 'SAL-09', side: 'buy' })).toEqual({ kind: 'error', error: 'unavailable' })
    expect(writeOutcomeOf('approve', 401, null)).toEqual({ kind: 'error', error: 'expired' })
    expect(writeOutcomeOf('approve', 403, { error: 'csrf' })).toEqual({ kind: 'error', error: 'csrf' })
    expect(writeOutcomeOf('approve', 429, null)).toEqual({ kind: 'error', error: 'rate_limited' })
    expect(writeOutcomeOf('approve', 400, { error: 'bad_request', message: '<b>x</b>' })).toEqual({ kind: 'error', error: 'bad_request' })
    expect(writeOutcomeOf('approve', 502, { error: 'tool_error' })).toEqual({ kind: 'error', error: 'tool' })
    expect(writeOutcomeOf('approve', 502, { error: 'approvals unavailable' })).toEqual({ kind: 'error', error: 'unavailable' })
  })
})

describe('the requests the page sends', () => {
  afterEach(() => vi.unstubAllGlobals())

  const capture = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), { status, headers })
    })
    return calls
  }

  it('logs in same-origin with the password in the body only', async () => {
    const calls = capture(200, { csrf: 'tok' })
    expect(await login('a long enough password')).toEqual({ kind: 'in', csrf: 'tok' })
    expect(calls[0]!.url).toBe('/api/approver/login')
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ password: 'a long enough password' }) })
    expect(calls[0]!.url).not.toContain('password')
  })

  it('sends the CSRF token on every write', async () => {
    const calls = capture(200, { status: 'revoked', card: 'SAL-09', side: 'buy', tick: 3, by: 'human:bazaar-live' })
    await revoke('csrf-token', denyInput(row()))
    await approve('csrf-token', { card: 'SAL-09', side: 'buy', price: 260, ttl_ticks: 240 })
    for (const call of calls) {
      expect(call.init.credentials).toBe('same-origin')
      expect((call.init.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-token')
    }
    expect(calls.map((c) => c.url)).toEqual(['/api/approver/revoke', '/api/approver/approve'])
  })

  it('reads a session: its token, none, or unknown (retry) on a 429, a 5xx or no answer, never the lock for those', async () => {
    capture(200, { authenticated: true, csrf: 'tok' })
    expect(await readSession()).toEqual({ kind: 'in', csrf: 'tok' })
    capture(200, { authenticated: false })
    expect(await readSession()).toEqual({ kind: 'out' })
    capture(429, { error: 'rate_limited' }, { 'Retry-After': '12' })
    expect(await readSession()).toEqual({ kind: 'unknown', retryS: 12 })
    capture(503, null)
    expect(await readSession()).toEqual({ kind: 'unknown', retryS: 5 })
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('offline')))
    expect(await readSession()).toEqual({ kind: 'unknown', retryS: 5 })
    expect(await approve('t', { card: 'SAL-09', side: 'buy', price: 1, ttl_ticks: 1 })).toEqual({ kind: 'error', error: 'network' })
  })
})

describe('the words', () => {
  it('asks for the confirm in both languages', () => {
    expect(APPROVALS_STRINGS.en.confirm('SAL-09', 'buy', 260)).toBe('Confirm approve SAL-09 buy up to 260?')
    expect(APPROVALS_STRINGS.en.confirm('LAV-10', 'sell', 300)).toBe('Confirm approve LAV-10 sell down to 300?')
    expect(APPROVALS_STRINGS.es.confirm('SAL-09', 'buy', 260)).toBe('¿Confirmas aprobar la compra de SAL-09 hasta 260?')
    expect(APPROVALS_STRINGS.en.scope('SAL-09', 'buy', 240)).toBe('It covers any counterparty for the next 240 ticks, and replaces any live approval for SAL-09 buy.')
  })

  it('names who asked, the cap and the time left', () => {
    expect(APPROVALS_STRINGS.en.askedBy('accept_buy', 'chato')).toBe('asked by the taker, accepting an ask · with chato')
    expect(APPROVALS_STRINGS.en.askedBy('something_new', null)).toBe('asked by something_new')
    expect(APPROVALS_STRINGS.en.cap(95, 'max_price_rare')).toBe('never above 95: max_price_rare')
    expect(APPROVALS_STRINGS.en.until(1150, 1)).toBe('until tick 1150 (1 tick left)')
    expect(APPROVALS_STRINGS.es.staleIn(1145, 233)).toBe('caduca tras el turno 1145 (quedan 233 turnos)')
    expect(APPROVALS_STRINGS.en.priceError('above_cap', 1, 95, 'max_price_rare')).toBe('never above 95 (max_price_rare): an approval cannot lift it')
  })
})
