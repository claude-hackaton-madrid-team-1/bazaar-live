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

  it('is the same game for the same seed', () => {
    expect(play(120, 3)).toEqual(play(120, 3))
    expect(play(120, 3)).not.toEqual(play(120, 4))
  })
})
