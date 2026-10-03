import { describe, expect, it } from 'vitest'
import { parseEnvelope, parseHealth, parseState, publicDecision, publicExecution } from './sanitize'

/** A taker row as the agents published it before bazaar PR #69: private numbers everywhere. */
const PRIVATE_ROW = {
  decision_id: 77,
  tick: 155,
  kind: 'dealer_bid',
  line: 'bid 26 to abuela (worth 56.1, surplus 34.1, ladder 17→26)',
  reason: 'worth 25×1.6 + bonus share 16.1 = 56.1; ladder 17→26',
  strategy: 'ladder',
  inputs: { dealer: 'abuela', thread: 101, item: 'LAV-08', her_ask: 30, value: 56.1, max: 26, our_bids: [17, 21], surplus: 34.1, plan: '17→26 step 1', price: 26 },
  guardrail: 'denied: cash 301 - 40 < cash_floor 270',
  chosen: true,
  status: 'approved',
  dry_run: false,
  jev: { verdict: 'accept', value: 0.87, probabilities: { accept: 0.87, walk: 0.13 }, reason: null, digest: '6914f933' },
  thread_id: 101,
  move: { kind: 'bid', price: 26, secret: 'x' },
}

const PRIVATE_NUMBERS = [56.1, 34.1, 0.87, 0.13, 301, 270, 1.6, 17, 21]

describe('publicDecision (mirror of bazaar PR #69)', () => {
  it('keeps what the agent did and drops values, limits, reasons and Jev numbers', () => {
    const d = publicDecision(PRIVATE_ROW)
    expect(d).not.toBeNull()
    const text = JSON.stringify(d)
    for (const n of PRIVATE_NUMBERS) expect(text).not.toContain(String(n))
    for (const word of ['reason', 'line', 'strategy', 'value', 'max', 'our_bids', 'surplus', 'plan', 'cash_floor', 'probabilities', 'digest', 'secret']) {
      expect(text).not.toContain(word)
    }
    expect(d).toMatchObject({
      kind: 'dealer_bid',
      sent: true,
      guardrail: 'denied',
      jevVerdict: 'accept',
      threadId: 101,
      inputs: { dealer: 'abuela', thread: 101, item: 'LAV-08', herAsk: 30, price: 26 },
      move: { kind: 'bid', price: 26 },
    })
  })

  it('cuts a row that was not sent down to its card, place and status', () => {
    const rejected = publicDecision({
      kind: 'accept_ask',
      tick: 9,
      status: 'rejected',
      dry_run: false,
      decision_id: 5,
      guardrail: 'denied: price 40 > max_price_uncommon 26',
      inputs: { offer_id: 5512, maker: 't07', ref: 'LAV-11', ask: 40, venue: 'rastro', price: 40 },
      jev: { verdict: 'yes' },
      move: { accept: 5512, price: 40 },
    })
    expect(rejected).toEqual({
      decisionId: null,
      tick: 9,
      kind: 'accept_ask',
      chosen: null,
      status: 'rejected',
      dryRun: false,
      sent: false,
      threadId: null,
      guardrail: 'denied',
      jevVerdict: null,
      inputs: { ref: 'LAV-11', venue: 'rastro' },
      move: {},
    })
  })

  it('treats a dry-run or unlabelled row as not sent, even when approved', () => {
    const dry = publicDecision({ kind: 'post_ask', status: 'approved', dry_run: true, inputs: { ref: 'LAT-09', price: 68 }, move: { want: { cash: 68 } } })
    const unknown = publicDecision({ kind: 'post_ask', status: 'approved', inputs: { ref: 'LAT-09', price: 68 } })
    expect(dry?.sent).toBe(false)
    expect(dry?.inputs.price).toBeUndefined()
    expect(dry?.move).toEqual({})
    expect(unknown?.sent).toBe(false)
    expect(unknown?.inputs.price).toBeUndefined()
  })

  it('reads the card from a maker Jev state nested under offer or listing', () => {
    const d = publicDecision({
      kind: 'hold_ask',
      status: 'approved',
      dry_run: false,
      inputs: { offer: { ref: 'MAL-03', side: 'ask', value_to_us: 41 }, cash: 300, cash_floor: 270 },
    })
    expect(d?.inputs).toEqual({ ref: 'MAL-03', side: 'ask' })
  })

  it('rejects non-objects, missing kinds and non-scalar inputs', () => {
    expect(publicDecision(null)).toBeNull()
    expect(publicDecision({ status: 'approved' })).toBeNull()
    const d = publicDecision({ kind: 'post_ask', status: 'approved', dry_run: false, inputs: { ref: ['x'], price: Number.NaN } })
    expect(d?.inputs).toEqual({})
  })
})

describe('publicExecution', () => {
  it('keeps the request we sent and the outcome, never the game answer body', () => {
    const x = publicExecution({
      decision_id: 3,
      tick: 10,
      sdk_method: 'accept',
      request: { offer: 5512, note: 'private' },
      response: { id: 42, cash_after: 199 },
      error_code: null,
    })
    expect(x).toEqual({ decisionId: 3, tick: 10, method: 'accept', ok: true, errorCode: null, createdId: 42, request: { offer: 5512 } })
    expect(JSON.stringify(x)).not.toContain('199')
  })

  it('reports a refusal', () => {
    expect(publicExecution({ method: 'accept', ok: false, error_code: 'insufficient_cash' })).toMatchObject({ ok: false, errorCode: 'insufficient_cash' })
  })
})

describe('parseEnvelope', () => {
  const envelope = { id: -7, tick: 300, t: 6.1, type: 'agent.decision', scope: 'team', actor: 't01', agent: 'maker', payload: { kind: 'post_ask', status: 'approved', dry_run: false, inputs: { ref: 'LAT-09', price: 68 } } }

  it('types a decision and builds a dedupe key from agent, id, type, tick and t', () => {
    const e = parseEnvelope(envelope)
    expect(e?.type).toBe('agent.decision')
    expect(e?.key).toBe('maker|-7|agent.decision|300|6.1')
  })

  it('keeps taker and maker events with the same id apart', () => {
    const maker = parseEnvelope(envelope)
    const taker = parseEnvelope({ ...envelope, agent: 'taker' })
    expect(maker?.key).not.toBe(taker?.key)
  })

  it('parses ticks and ignores unknown types and agents', () => {
    expect(parseEnvelope({ id: -1, tick: 1, t: 0, type: 'agent.tick', agent: 'taker', payload: { mode: 'live' } })).toMatchObject({ type: 'agent.tick', mode: 'live' })
    expect(parseEnvelope({ ...envelope, type: 'agent.thought' })).toBeNull()
    expect(parseEnvelope({ ...envelope, agent: 'duels' })).toBeNull()
    expect(parseEnvelope('nope')).toBeNull()
  })
})

describe('parseHealth and parseState', () => {
  it('reads /health as services.md documents it', () => {
    const h = parseHealth({ ok: true, agent: 'taker', mode: 'live', tick: null, last_tick_at: null, doors: 'closed', paused: true, next_opens: '2026-10-03T09:00:00+02:00', tick_seconds: 60, server_tick: 159 })
    expect(h).toEqual({ ok: true, agent: 'taker', mode: 'live', tick: null, doors: 'closed', paused: true, nextOpens: '2026-10-03T09:00:00+02:00', tickSeconds: 60, serverTick: 159, target: null })
    expect(parseHealth({ ok: true, agent: 'maker', target: { mode: 'simulator', url: 'x' } })?.target).toBe('simulator')
    expect(parseHealth({ ok: true, agent: 'maker', target: { mode: 'real', url: 'x' } })?.target).toBe('real')
    expect(parseHealth({ ok: true, agent: 'maker', target: { mode: 'moon' } })?.target).toBeNull()
  })

  it('keeps only the public fields of the maker open offers', () => {
    const s = parseState({ agent: 'maker', mode: 'live', tick: 3, team: 't01', open_offers: [{ id: 1, side: 'ask', ref: 'LAT-09', price: 68, venue: 'rastro', value_to_us: 90 }, { nope: true }] })
    expect(s?.openOffers).toEqual([{ id: 1, side: 'ask', ref: 'LAT-09', price: 68, venue: 'rastro' }])
    expect(parseState({ agent: 'taker', threads: [] })?.openOffers).toBeNull()
  })
})
