import { describe, expect, it } from 'vitest'
import { MockGame } from './mock'
import { apply, createState, KNOWN_TYPES, type GameEvent } from './state'

const play = (steps: number, seed = 7): GameEvent[] => {
  const game = new MockGame(seed)
  return Array.from({ length: steps }, () => game.step()).flat()
}

describe('MockGame', () => {
  it('only emits types the screens know, with unique positive ids', () => {
    const events = play(400)
    expect(events.every((e) => KNOWN_TYPES.has(e.type))).toBe(true)
    const ids = events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id > 0)).toBe(true)
  })

  it('starts with our hello and /me, and every screen has something to show', () => {
    const events = play(400)
    expect(events.slice(0, 2).map((e) => e.type)).toEqual(['agent.hello', 'agent.me'])
    const s = createState()
    events.forEach((e) => apply(s, e))
    expect(s.team).toBe('t01')
    expect(s.pages.length).toBeGreaterThan(0)
    expect(Object.keys(s.threads).length).toBeGreaterThan(0)
    expect(Object.keys(s.duels).length).toBeGreaterThan(0)
    expect(s.tape.some((t) => t.ours)).toBe(true)
    expect(s.tape.some((t) => !t.ours)).toBe(true)
    expect(s.log.length).toBeGreaterThan(0)
  })

  it('fills the board, the venues, packs, gifts, failures and threads like the real feed', () => {
    const events = play(400)
    const s = createState()
    events.forEach((e) => apply(s, e))
    const count = (type: string) => events.filter((e) => e.type === type).length
    expect(count('offer.listed') + count('offer.cancelled')).toBeGreaterThan(events.length / 3)
    expect(events.some((e) => e.type === 'offer.cancelled' && e.payload.reason === 'expired')).toBe(true)
    const offers = [...s.book.values()].flatMap((o) => [...o.values()])
    expect(offers.some((o) => o.side === 'ask') && offers.some((o) => o.side === 'bid')).toBe(true)
    expect(offers.some((o) => o.maker === 't01')).toBe(true)
    expect(offers.every((o) => o.expiresTick == null || o.expiresTick >= s.tick)).toBe(true)
    expect(s.venues.get('t07-puesto')?.owner).toBe('t07')
    expect(s.venues.get('rastro')).toBeDefined()
    expect([...s.venues.values()].some((v) => v.announcement)).toBe(true)
    expect(s.packsOpened.some((p) => p.team === 't01')).toBe(true)
    expect(s.gifts.some((g) => g.team === 't01')).toBe(true)
    expect(s.failed.some((f) => f.ours)).toBe(true)
    expect(s.opened.length).toBeGreaterThan(0)
    expect(s.packs.length).toBeGreaterThan(0)
  })

  it('is the same game for the same seed', () => {
    expect(play(120, 3)).toEqual(play(120, 3))
    expect(play(120, 3)).not.toEqual(play(120, 4))
  })
})
