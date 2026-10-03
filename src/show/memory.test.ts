import { describe, expect, it } from 'vitest'
import { B, S, v, type Variant } from '../../shared/bank.ts'
import { chooseVariant, LineMemory, variantId } from './memory'

const MIN = 60_000
const a = v('calm', S('Línea A.'), B('Respuesta A.'))
const b = v('calm', S('Línea B.'), B('Respuesta B.'))
const c = v('eager', S('Línea C.'), B('Respuesta C.'))
const d = v('sarcastic', S('Línea D.'), B('Respuesta D.'))

describe('LineMemory', () => {
  it('remembers a line for its window and then forgets it', () => {
    const m = new LineMemory(5 * MIN)
    expect(m.recent(a, 0)).toBe(false)
    expect(m.ageOf(a, 0)).toBe(Infinity)
    m.record(a, 1000)
    expect(m.recent(a, 1000 + 5 * MIN - 1)).toBe(true)
    expect(m.recent(a, 1000 + 5 * MIN)).toBe(false)
    expect(m.ageOf(a, 3000)).toBe(2000)
  })

  it('treats two variants that open with the same words as the same line', () => {
    const m = new LineMemory(5 * MIN)
    const first: Variant = v('calm', S('Choca esa mano.'), B('Hecho.'))
    const second: Variant = v('eager', S('Choca esa mano.'), B('Otra respuesta.'))
    m.record(first, 0)
    expect(variantId(first)).not.toBe(variantId(second))
    expect(m.recent(second, 1000)).toBe(true)
  })

  it('remembers the last moods, newest last, and caps them', () => {
    const m = new LineMemory()
    for (const x of [a, c, d, b, c, c, c, a, d, d]) m.record(x, 0)
    expect(m.recentMoods().length).toBe(8)
    expect(m.recentMoods().at(-1)).toBe('sarcastic')
  })

  it('does not grow without bound', () => {
    const m = new LineMemory(MIN, 10)
    for (let i = 0; i < 100; i += 1) m.record(v('calm', S(`línea ${i}`)), i * MIN)
    expect(m.recent(v('calm', S('línea 99')), 99 * MIN + 1)).toBe(true)
    expect(m.recent(v('calm', S('línea 0')), 99 * MIN + 1)).toBe(false)
  })
})

describe('chooseVariant', () => {
  it('prefers the mood asked for', () => {
    expect(chooseVariant([a, b, c, d], ['eager', 'calm'], 7, undefined, 0)).toBe(c)
    expect(chooseVariant([a, b, c, d], ['sarcastic'], 7, undefined, 0)).toBe(d)
    expect(chooseVariant([a, b], ['triumphant', 'eager', 'calm'], 7, undefined, 0).mood).toBe('calm')
  })

  it('without a memory it is a pure function of the seed (a replay reads the same)', () => {
    const picks = (seed: number) => chooseVariant([a, b], ['calm'], seed, undefined, 0)
    expect(picks(3)).toBe(picks(3))
    expect(new Set([0, 1, 2, 3, 4, 5].map(picks)).size).toBe(2)
  })

  it('never repeats a line within the window while a fresh one exists', () => {
    const m = new LineMemory(5 * MIN)
    const pool = [a, b, c, d]
    const said: Variant[] = []
    for (let i = 0; i < 4; i += 1) {
      const pick = chooseVariant(pool, ['calm', 'eager'], i * 31, m, i * 1000)
      m.record(pick, i * 1000)
      said.push(pick)
    }
    expect(new Set(said).size).toBe(4)
  })

  it('prefers a fresh line of another mood over a recent line of the mood asked for', () => {
    const m = new LineMemory(5 * MIN)
    m.record(a, 0)
    m.record(b, 0)
    const pick = chooseVariant([a, b, c], ['calm', 'eager'], 1, m, 1000)
    expect(pick).toBe(c)
  })

  it('when everything was said lately, says the one said longest ago', () => {
    const m = new LineMemory(5 * MIN)
    m.record(a, 0)
    m.record(b, 1000)
    m.record(c, 2000)
    expect(chooseVariant([a, b, c], ['calm'], 9, m, 3000)).toBe(a)
    m.record(a, 4000)
    expect(chooseVariant([a, b, c], ['calm'], 9, m, 5000)).toBe(b)
  })

  it('refuses an empty pool', () => {
    expect(() => chooseVariant([], ['calm'], 1, undefined, 0)).toThrow()
  })
})
