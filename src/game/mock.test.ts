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

  it('plays our three agents\' decisions: approved, blocked by several rules, expired, an idle agent, outcomes and a ledger', () => {
    const s = createState()
    play(8 * 12).forEach((e) => apply(s, e))
    const all = [...s.agents.decisions.taker, ...s.agents.decisions.maker, ...s.agents.decisions.duels]
    expect(new Set(all.map((d) => d.agent))).toEqual(new Set(['taker', 'maker', 'duels']))
    expect(all.some((d) => d.status === 'done')).toBe(true)
    expect(all.some((d) => d.status === 'expired')).toBe(true)
    expect(new Set(all.filter((d) => d.verdict === 'denied').map((d) => d.rule)).size).toBeGreaterThanOrEqual(4)
    expect(all.filter((d) => d.agent === 'duels').every((d) => d.price === null && d.text === null)).toBe(true)
    const ticks = new Set(s.agents.decisions.maker.map((d) => d.tick))
    expect([1, 2, 3, 4, 5, 6].some((tick) => !ticks.has(tick))).toBe(true)
    expect(s.agents.outcomes.length).toBeGreaterThan(0)
    expect(s.agents.ledger?.limits).toEqual({ spendPerHour: 150, cashFloor: 50, acceptsPerTick: 1 })
  })

  it('duels three rivals by alias from the first step: two finished duels and a live one, each event naming its rival', () => {
    const first = createState()
    play(1).forEach((e) => apply(first, e))
    const duels = Object.values(first.duels)
    expect(duels.map((d) => [d.id, d.rival, d.status])).toEqual([[1, 'Rival Noche', 'deal'], [2, 'Rival Azul', 'no deal'], [3, 'Rival Oro', 'open']])
    const events = play(400).filter((e) => e.type.startsWith('duel.'))
    expect(events.every((e) => typeof e.payload.rival === 'string' && e.payload.rival.startsWith('Rival '))).toBe(true)
    expect(events.filter((e) => e.type === 'duel.message' && e.payload.sender !== 't01').every((e) => e.payload.sender === e.payload.rival)).toBe(true)
  })

  it('is the same game for the same seed', () => {
    expect(play(120, 3)).toEqual(play(120, 3))
    expect(play(120, 3)).not.toEqual(play(120, 4))
  })
})
