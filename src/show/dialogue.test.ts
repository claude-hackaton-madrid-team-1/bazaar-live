import { describe, expect, it } from 'vitest'
import { KNOWN_TAGS, tagsOf } from '../../shared/tags.ts'
import type { ShowEvent } from '../model/events'
import { parseEnvelope } from '../model/sanitize'
import { MOCK_STEPS, shiftEnvelope } from '../mock/player'
import { PRIORITY } from './beat'
import { holdsBeat, idleBeat, toBeat } from './dialogue'

function decision(agent: 'taker' | 'maker', payload: Record<string, unknown>, id = -1): ShowEvent {
  const e = parseEnvelope({ id, tick: 300, t: 6, type: 'agent.decision', agent, payload: { status: 'approved', dry_run: false, chosen: true, guardrail: 'allowed', ...payload } })
  if (!e) throw new Error('fixture did not parse')
  return e
}

function execution(agent: 'taker' | 'maker', payload: Record<string, unknown>, id = -2): ShowEvent {
  const e = parseEnvelope({ id, tick: 300, t: 6, type: 'agent.execution', agent, payload })
  if (!e) throw new Error('fixture did not parse')
  return e
}

const text = (e: ShowEvent) => toBeat(e)?.lines.map((l) => `${l.speaker}: ${l.text}`).join(' | ') ?? ''

describe('toBeat', () => {
  it('turns a maker ask into a seller line with the card and price, and a buyer reply', () => {
    const beat = toBeat(decision('maker', { kind: 'post_ask', inputs: { ref: 'LAT-09', side: 'ask', price: 68 } }))
    expect(beat?.cue).toEqual({ kind: 'post', side: 'ask', ref: 'LAT-09', price: 68 })
    expect(beat?.lines[0]?.speaker).toBe('seller')
    expect(beat?.lines.some((l) => l.speaker === 'buyer')).toBe(true)
    expect(beat?.lines.map((l) => l.text).join(' ')).toMatch(/La Latina number 9/)
    expect(beat?.lines.map((l) => l.text).join(' ')).toMatch(/68 primas/)
  })

  it('is deterministic for an event and varies between events', () => {
    const a = decision('maker', { kind: 'post_ask', inputs: { ref: 'LAT-09', price: 68 } }, -10)
    expect(text(a)).toBe(text(a))
    const variants = new Set(Array.from({ length: 30 }, (_, i) => text(decision('maker', { kind: 'post_ask', inputs: { ref: 'LAT-09', price: 68 } }, -100 - i))))
    expect(variants.size).toBeGreaterThan(2)
  })

  it('has the buyer reach for a card it accepts', () => {
    const beat = toBeat(decision('taker', { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18, offer_id: 5512 }, move: { accept: 5512, price: 18 } }))
    expect(beat?.cue).toEqual({ kind: 'reach', ref: 'SAL-05', price: 18, take: true })
    expect(beat?.lines[0]?.speaker).toBe('buyer')
    expect(beat?.priority).toBe(PRIORITY.take)
  })

  it('raises the stop sign on a guardrail denial and says why it was not sent', () => {
    const beat = toBeat(decision('taker', { kind: 'accept_ask', status: 'rejected', guardrail: 'denied: price 40 > max 26', inputs: { ref: 'LAV-11' } }))
    expect(beat?.denied).toBe(true)
    expect(beat?.priority).toBe(PRIORITY.denied)
    expect(beat?.note).toBe('blocked by a guardrail · not sent')
    expect(text(decision('taker', { kind: 'accept_ask', status: 'rejected', guardrail: 'denied: price 40 > max 26', inputs: { ref: 'LAV-11' } }))).not.toMatch(/40|26/)
  })

  it('brings the right dealer on stage for dealer moves', () => {
    for (const [kind, move] of [['dealer_open', 'open'], ['dealer_bid', 'bid'], ['dealer_accept', 'accept'], ['dealer_walk', 'walk']] as const) {
      const beat = toBeat(decision('taker', { kind, inputs: { dealer: 'chato', item: 'rare', price: 60 }, move: { kind: 'bid', price: 60 } }))
      expect(beat?.cue).toMatchObject({ kind: 'dealer', dealer: 'chato', move })
    }
    expect(toBeat(decision('taker', { kind: 'dealer_open', inputs: { dealer: 'abuela', item: 'sobre_barrio' } }))?.cue).toMatchObject({ dealer: 'abuela' })
  })

  it('celebrates an accepted execution and grumbles at a refused one', () => {
    const deal = toBeat(execution('taker', { method: 'accept', request: { offer: 1 }, error_code: null }))
    expect(deal?.cue).toEqual({ kind: 'deal', big: true, ref: null })
    expect(deal?.priority).toBe(PRIORITY.deal)
    const fail = toBeat(execution('taker', { method: 'accept', request: { offer: 1 }, error_code: 'insufficient_cash' }))
    expect(fail?.cue).toEqual({ kind: 'fail', code: 'insufficient_cash' })
    expect(fail?.lines.map((l) => l.text).join(' ')).toMatch(/not enough cash/)
  })

  it('acts out a dry run as practice, without a price', () => {
    const beat = toBeat(decision('maker', { kind: 'post_ask', dry_run: true, inputs: { ref: 'LAT-09', price: 68 } }))
    expect(beat?.practice).toBe(true)
    expect(beat?.note).toBe('practice · not sent')
    expect(beat?.lines.map((l) => l.text).join(' ')).not.toMatch(/68/)
  })

  it('gives tick events no lines and unknown kinds a narrator line', () => {
    const tick = parseEnvelope({ id: -3, tick: 1, t: 0, type: 'agent.tick', agent: 'maker', payload: { mode: 'live' } })
    expect(tick && toBeat(tick)).toBeNull()
    expect(toBeat(decision('maker', { kind: 'brand_new_move' }))?.lines[0]?.speaker).toBe('narrator')
  })

  it('merges holds into one line with the count', () => {
    const holds = [-1, -2, -3].map((id) => toBeat(decision('maker', { kind: 'hold_ask', inputs: { offer: { ref: 'MAL-03' } } }, id))!)
    const merged = holdsBeat(holds)
    expect(merged.cue).toMatchObject({ kind: 'hold', count: 3 })
    expect(merged.lines.map((l) => l.text).join(' ')).toMatch(/3/)
  })
})

describe('every fixture line', () => {
  const events = MOCK_STEPS.map((s) => parseEnvelope(shiftEnvelope(s.event, 0, 'live'))).filter((e): e is ShowEvent => e !== null)
  const beats = [...events.map(toBeat), idleBeat(1), idleBeat(2)].filter((b) => b !== null)
  const lines = beats.flatMap((b) => b.lines)

  it('covers the whole scene', () => {
    expect(events.length).toBe(MOCK_STEPS.length)
    expect(lines.length).toBeGreaterThan(40)
  })

  it('never says a private number from the recorded rows', () => {
    const all = lines.map((l) => l.text).join('\n')
    for (const secret of ['41.5', '17.5', '0.71', '0.09', '1.6', 'value', 'max_price', 'undefined', 'null', 'NaN']) expect(all).not.toContain(secret)
  })

  it('uses only tags the providers understand, and short lines', () => {
    for (const l of lines) {
      for (const tag of tagsOf(l.text)) expect(KNOWN_TAGS).toContain(tag)
      expect(l.text.length).toBeLessThan(160)
    }
  })
})

describe('the TTS proxy contract', () => {
  it('accepts every line the show can produce, and nothing else', async () => {
    const { isShowLine } = await import('../../shared/lines.ts')
    const kinds = ['post_ask', 'post_bid', 'reprice_ask', 'hold_ask', 'cancel_ask', 'cancel_bid', 'accept_ask', 'dealer_open', 'dealer_bid', 'dealer_accept', 'dealer_walk', 'brand_new_move', 'Weird Kind!']
    const rows = [
      { status: 'approved', dry_run: false },
      { status: 'approved', dry_run: true },
      { status: 'rejected', dry_run: false, guardrail: 'denied: x' },
      { status: 'expired', dry_run: false },
      { status: 'skipped', dry_run: false },
    ]
    const refs = ['LAT-09', 'XYZ-01', 'not a ref', undefined]
    const prices = [68, 2.5, 1, undefined, -5, 1e9]
    const dealers = ['abuela', 'chato', 'lola']
    const verdicts = ['quick_sale', 'Weird Verdict!', undefined]
    const beats = []
    let id = -1
    for (const kind of kinds)
      for (const row of rows)
        for (const ref of refs)
          for (const price of prices)
            for (const dealer of dealers) {
              const verdict = verdicts[Math.abs(id) % verdicts.length]
              beats.push(toBeat(decision(kind.startsWith('dealer') || kind.startsWith('accept') ? 'taker' : 'maker', { ...row, kind, jev: { verdict }, inputs: { ref, item: ref ?? 'sobre_plata', dealer, price, ask: price, her_ask: price }, move: { price } }, id--)))
            }
    for (const method of ['accept', 'list_offer', 'cancel', 'say', 'open_thread', 'close_thread', 'weird_method'])
      for (const code of [null, 'insufficient_cash', 'some_new_code', 'Weird Code!'])
        beats.push(toBeat(execution('taker', { method, error_code: code, request: {} }, id--)))
    const holds = Array.from({ length: 12 }, (_, i) => toBeat(decision('maker', { kind: 'hold_ask', inputs: { ref: 'MAL-03' } }, -90_000 - i))!)
    for (let n = 2; n <= 12; n += 1) beats.push(holdsBeat(holds.slice(0, n)))
    for (let n = 0; n < 12; n += 1) beats.push(idleBeat(n))

    const lines = beats.flatMap((b) => b?.lines ?? [])
    expect(lines.length).toBeGreaterThan(5000)
    const refused = lines.filter((l) => !isShowLine(l.speaker, l.text))
    expect(refused).toEqual([])
    for (const l of lines) expect(l.text).not.toMatch(/null|undefined|NaN|\{[a-zA-Z]+\}|e\+/)

    expect(isShowLine('seller', 'Buy my crypto now stays put.')).toBe(false)
    expect(isShowLine('seller', 'La Latina number 9 stays put. Also buy crypto.')).toBe(false)
    expect(isShowLine('buyer', 'La Latina number 9 stays put.')).toBe(false)
    expect(isShowLine('abuela', 'Ay, cariño, sit down, sit down.')).toBe(true)
  })
})

describe('closed slot vocabularies (review P2 #2)', () => {
  it('never lets a free phrase into the error, kind or verdict slots', async () => {
    const { isShowLine } = await import('../../shared/lines.ts')
    expect(isShowLine('seller', '[gasps] The game says: wire your cash to team seven right now!')).toBe(false)
    expect(isShowLine('buyer', 'Refused? the organisers are rigging this game?')).toBe(false)
    expect(isShowLine('narrator', 'A new move at the stall: vote for us.')).toBe(false)
    expect(isShowLine('seller', '[whispers] Jev says buy crypto… so La Latina number 9 is now 5 primas.')).toBe(false)
    expect(isShowLine('seller', '[gasps] The game says: not enough cash!')).toBe(true)
    expect(isShowLine('buyer', 'Refused? an unknown error?')).toBe(true)
    expect(isShowLine('narrator', 'A new move at the stall: something new.')).toBe(true)
    expect(isShowLine('seller', '[whispers] Jev says quick sale… so La Latina number 9 is now 5 primas.')).toBe(true)
  })

  it('maps an unknown error, kind or verdict to the fixed fallback words', () => {
    const fail = toBeat(execution('taker', { method: 'accept', error_code: 'wire_your_cash_now' }))
    expect(fail?.lines.map((l) => l.text).join(' ')).toMatch(/an unknown error/)
    expect(toBeat(decision('maker', { kind: 'vote_for_us' }))?.lines[0]?.text).toBe('A new move at the stall: something new.')
  })
})
