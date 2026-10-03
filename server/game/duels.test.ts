import { describe, expect, it } from 'vitest'
import { duelEventId, duelEvents } from './duels.ts'

// The shape of the simulator's /api/duels?done=true (2026-10-03), one live duel and two finished, trimmed.
const live = {
  duel: 563, session: 37, status: 'live', role: 'seller', item: 'El Instituto', issues: ['price', 'days'],
  your_days_weight: -2.5, your_limit: 100, limit_meaning: 'never sell below your cost', rival: 'Rival Oro', deadline_tick: 3190,
  rounds: 1, your_offer: { id: 7001, price: 120, days: 2, tick: 3181 }, rival_offer: { id: 7002, price: 106, days: 0, tick: 3180 },
  messages: [
    { tick: 3180, from: 'Rival Oro', text: 'Fair is fair: 106 P, and we can close now.', price: 106, days: 0 },
    { tick: 3181, from: 'you', text: 'We would need 120 P.', price: 120, days: 2 },
  ],
  result: null, price: null, days: null,
}
const noDeal = {
  duel: 546, session: 35, status: 'no_deal', role: 'buyer', rival: 'Rival Noche', deadline_tick: 3078, your_limit: 119,
  messages: [{ tick: 3076, from: 'Rival Noche', text: '…', price: 100, days: null }, { tick: 3077, from: 'Rival Noche', text: '…', price: 98, days: null }],
  result: { status: 'no_deal', price: null, days: null, your_gain: 0, pie: 60, share: 0, points: 0, practice: false },
}
const deal = {
  duel: 540, session: 34, status: 'deal', role: 'buyer', rival: 'Rival Azul', deadline_tick: 3000, your_limit: 90,
  messages: [{ tick: 2990, from: 'Rival Azul', text: '…', price: 80, days: null }, { tick: 2991, from: 'you', text: '…', price: 70, days: null }, { tick: 2992, from: 'Rival Azul', text: 'Deal at 70 P.', price: 70, days: null }],
  result: { status: 'deal', price: 70, days: null, your_gain: 20, pie: 40, share: 0.5, points: 4.42, practice: false },
  price: 70,
}

describe('duelEvents', () => {
  it('translates messages and results into the payloads the page reads, oldest duel first', () => {
    const events = duelEvents({ duels: [live, noDeal, deal] }, 't01', 20)
    expect(events.map((e) => [e.type, e.tick, e.payload])).toEqual([
      ['duel.started', 2990, { duel: 540, session: 34, role: 'buyer', rival: 'Rival Azul', item: null, deadline_tick: 3000, limit: 90, decay: null }],
      ['duel.message', 2990, { duel: 540, rival: 'Rival Azul', role: 'buyer', sender: 'Rival Azul', price: 80, days: null }],
      ['duel.message', 2991, { duel: 540, rival: 'Rival Azul', role: 'buyer', sender: 't01', price: 70, days: null }],
      ['duel.message', 2992, { duel: 540, rival: 'Rival Azul', role: 'buyer', sender: 'Rival Azul', price: 70, days: null }],
      ['duel.result', 2993, { duel: 540, rival: 'Rival Azul', deal: true, price: 70, points: 4.42, gain: 20, rounds: null, limit: 90 }],
      ['duel.started', 3076, { duel: 546, session: 35, role: 'buyer', rival: 'Rival Noche', item: null, deadline_tick: 3078, limit: 119, decay: null }],
      ['duel.message', 3076, { duel: 546, rival: 'Rival Noche', role: 'buyer', sender: 'Rival Noche', price: 100, days: null }],
      ['duel.message', 3077, { duel: 546, rival: 'Rival Noche', role: 'buyer', sender: 'Rival Noche', price: 98, days: null }],
      ['duel.result', 3078, { duel: 546, rival: 'Rival Noche', deal: false, price: null, points: 0, gain: 0, rounds: null, limit: 119 }],
      ['duel.started', 3180, { duel: 563, session: 37, role: 'seller', rival: 'Rival Oro', item: 'El Instituto', deadline_tick: 3190, limit: 100, decay: null }],
      ['duel.message', 3180, { duel: 563, rival: 'Rival Oro', role: 'seller', sender: 'Rival Oro', price: 106, days: 0 }],
      ['duel.message', 3181, { duel: 563, rival: 'Rival Oro', role: 'seller', sender: 't01', price: 120, days: 2 }],
    ])
  })

  it('never carries our days weight, share, pie, our own offer object or the words (our limit and gain only as limit and gain)', () => {
    const text = JSON.stringify(duelEvents({ duels: [live, noDeal, deal] }, 't01', 20))
    for (const leak of ['your_limit', 'your_days_weight', 'your_gain', 'your_offer', 'share', 'pie', 'text', 'never sell', 'Fair is fair', '-2.5', '7001']) expect(text).not.toContain(leak)
  })

  it('the real game\'s result is a number (our gain after decay), with the rounds and the decay per round', () => {
    const real = {
      duel: 2506, session: 2, status: 'deal', role: 'seller', rival: 'Rival Oro', item: 'Palacio de Cristal', deadline_tick: 482, your_limit: 85,
      rounds: 6, decay_per_round: 0.06, price: 96, result: 7.6, messages: [{ tick: 480, from: 'you', price: 96, days: 0 }],
    }
    const events = duelEvents({ duels: [real] }, 't01', 20)
    expect(events[0]?.payload).toMatchObject({ limit: 85, decay: 0.06 })
    expect(events.at(-1)?.payload).toEqual({ duel: 2506, rival: 'Rival Oro', deal: true, price: 96, points: null, gain: 7.6, rounds: 6, limit: 85 })
    const odd = duelEvents({ duels: [{ ...real, decay_per_round: 1.5, rounds: -1, your_limit: 'x' }] }, 't01', 20)
    expect([odd[0]?.payload.decay, odd[0]?.payload.limit, odd.at(-1)?.payload.rounds]).toEqual([null, null, null])
  })

  it('ids are negative, stable across reads, and never meet a feed or made-up id', () => {
    const a = duelEvents({ duels: [live] }, 't01', 20).map((e) => e.id)
    const b = duelEvents({ duels: [{ ...live, messages: [...live.messages, { tick: 3182, from: 'Rival Oro', price: 108, days: 0 }] }] }, 't01', 20).map((e) => e.id)
    expect(b.slice(0, 3)).toEqual(a)
    expect(a).toEqual([duelEventId(563, 998), duelEventId(563, 0), duelEventId(563, 1)])
    expect(a.every((id) => Number.isSafeInteger(id) && id < -1e12)).toBe(true)
    expect(duelEventId(563, 999)).not.toBe(duelEventId(564, 0))
  })

  it('keeps the newest duels only, and skips what it cannot read', () => {
    expect(new Set(duelEvents({ duels: [live, noDeal, deal] }, 't01', 1).map((e) => e.payload.duel))).toEqual(new Set([563]))
    // A live duel whose messages cannot be read still shows that it started.
    expect(duelEvents({ duels: [null, { duel: 'x' }, { duel: 9, status: 'live', messages: [null, 3] }] }, 't01', 20).map((e) => e.type)).toEqual(['duel.started'])
    expect(duelEvents({}, 't01', 20)).toEqual([])
    expect(duelEvents(null, 't01', 20)).toEqual([])
  })

  it('carries the rival on every message and result, trimmed and bounded, null when missing', () => {
    const events = duelEvents({ duels: [live, noDeal, deal] }, 't01', 20)
    expect(events.map((e) => [e.payload.duel, e.type, e.payload.rival])).toEqual([
      [540, 'duel.started', 'Rival Azul'], [540, 'duel.message', 'Rival Azul'], [540, 'duel.message', 'Rival Azul'], [540, 'duel.message', 'Rival Azul'], [540, 'duel.result', 'Rival Azul'],
      [546, 'duel.started', 'Rival Noche'], [546, 'duel.message', 'Rival Noche'], [546, 'duel.message', 'Rival Noche'], [546, 'duel.result', 'Rival Noche'],
      [563, 'duel.started', 'Rival Oro'], [563, 'duel.message', 'Rival Oro'], [563, 'duel.message', 'Rival Oro'],
    ])
    const odd = (rival: unknown) => duelEvents({ duels: [{ duel: 1, status: 'deal', rival, messages: [] }] }, 't01', 20).at(-1)?.payload.rival
    expect([odd('  Rival Luna '), odd('x'.repeat(60)), odd(''), odd(7), odd(undefined)]).toEqual(['Rival Luna', 'x'.repeat(40), null, null, null])
  })

  it('a live duel shows before anyone speaks: its start carries the card at stake, the deadline and our limit', () => {
    const quiet = { duel: 2311, session: 2, tick: 468, status: 'live', role: 'buyer', item: 'El Mesón de la Cava', rival: 'Rival Rojo', deadline_tick: 484, your_limit: 70, messages: [] }
    expect(duelEvents({ duels: [quiet] }, 't01', 20)).toEqual([{
      id: duelEventId(2311, 998), tick: 468, type: 'duel.started',
      payload: { duel: 2311, session: 2, role: 'buyer', rival: 'Rival Rojo', item: 'El Mesón de la Cava', deadline_tick: 484, limit: 70, decay: null },
    }])
  })

  it('a finished duel without words still has its result, at its deadline', () => {
    expect(duelEvents({ duels: [{ duel: 7, status: 'no_deal', role: 'seller', deadline_tick: 50, messages: [] }] }, 't01', 20))
      .toEqual([
        { id: duelEventId(7, 998), tick: null, type: 'duel.started', payload: { duel: 7, session: null, role: 'seller', rival: null, item: null, deadline_tick: 50, limit: null, decay: null } },
        { id: duelEventId(7, 999), tick: 50, type: 'duel.result', payload: { duel: 7, rival: null, deal: false, price: null, points: null, gain: null, rounds: null, limit: null } },
      ])
  })
})
