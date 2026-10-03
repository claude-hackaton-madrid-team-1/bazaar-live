import { describe, expect, it } from 'vitest'
import { guestSpeaker } from '../../shared/tags.ts'
import { EMPTY_ITEM, type Draft } from '../../shared/transcript.ts'
import { TranscriptStore } from './store.ts'

const draft = (id: string, extra: Partial<Draft> = {}): Draft => ({ ...EMPTY_ITEM, id, ...extra })

describe('TranscriptStore', () => {
  it('numbers items in the order it learns them and dedupes by id', () => {
    const store = new TranscriptStore()
    const first = store.add([draft('f1'), draft('f2'), draft('f1')])
    expect(first.map((i) => [i.id, i.seq])).toEqual([['f1', 1], ['f2', 2]])
    expect(store.add([draft('f2'), draft('f3')]).map((i) => i.seq)).toEqual([3])
    expect(store.cursor).toBe(3)
  })

  it('answers since a cursor, capped, or the recent history without one', () => {
    const store = new TranscriptStore({ history: 3 })
    store.add(Array.from({ length: 10 }, (_, i) => draft(`f${i}`)))
    expect(store.since(8).map((i) => i.seq)).toEqual([9, 10])
    expect(store.since(null).map((i) => i.seq)).toEqual([8, 9, 10])
    expect(store.since(0, 2).map((i) => i.seq)).toEqual([1, 2])
    expect(store.since(10)).toEqual([])
  })

  it('treats a cursor from the future (a restarted server) as no cursor', () => {
    const store = new TranscriptStore({ history: 5 })
    store.add([draft('a'), draft('b')])
    expect(store.since(999).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('keeps a bounded ring', () => {
    const store = new TranscriptStore({ ring: 4 })
    store.add(Array.from({ length: 9 }, (_, i) => draft(`f${i}`)))
    expect(store.since(0, 100).map((i) => i.id)).toEqual(['f5', 'f6', 'f7', 'f8'])
  })

  it('does not forget an id the ring dropped while the dedupe set still knows it', () => {
    const store = new TranscriptStore({ ring: 2, seen: 100 })
    store.add([draft('a'), draft('b'), draft('c')])
    expect(store.add([draft('a')])).toEqual([])
  })

  it('tells subscribers about new items only', () => {
    const store = new TranscriptStore()
    const got: string[][] = []
    const off = store.subscribe((items) => got.push(items.map((i) => i.id)))
    store.add([draft('a'), draft('a')])
    store.add([draft('a')])
    off()
    store.add([draft('b')])
    expect(got).toEqual([['a']])
  })

  it("vouches only for a dealer's quote, in its language and bound to the dealer who said it", () => {
    const store = new TranscriptStore()
    const en = "Your abuela would've moved more than one. I match what you move, nothing extra."
    const es = 'Venga, mi niño. Te lo dejo en 31 primas, ni una menos.'
    store.add([
      draft('a', { kind: 'thread_line', who: 'them', counterpart: 'chato', text: en }),
      draft('b', { kind: 'thread_line', who: 'them', counterpart: 'abuela', text: es }),
      draft('c', { kind: 'thread_line', who: 'them', counterpart: 'chato', text: 'ok' }),
      draft('d', { kind: 'duel_replay', lines: [{ n: 1, speaker: 'them', tick: 1, price: 5, days: null, text: 'Eso es muy poco para una carta así.' }] }),
      draft('e', { kind: 'thread_line', who: 'them', counterpart: 'tendero', text: 'Eso lo dejo en veinte primas, no se hable más.' }),
      draft('g', { kind: 'thread_line', who: 'them', counterpart: 't05', text: 'Te lo cambio por dos repetidas, ni una más.' }),
      draft('f', { kind: 'thread_line', who: 'us', counterpart: 'chato', text: 'We never carry a quote of ours here, but if one came it is not indexed.' }),
      draft('h', { kind: 'thread_line', who: 'them', counterpart: 'abuela', text: 'Venga, mi niño, esta carta te la dejo muy bien de precio.', muted: true }),
    ])
    expect(store.quote(en)).toEqual({ lang: 'en', speaker: 'chato' })
    expect(store.quote(es)).toEqual({ lang: 'es', speaker: 'abuela' })
    expect(store.quote('ok')).toBeUndefined()
    expect(store.quote('Eso es muy poco para una carta así.')).toBeUndefined() // a rival's duel words: never
    // a dealer we do not know yet speaks with its guest voice, bound to it
    expect(store.quote('Eso lo dejo en veinte primas, no se hable más.')).toEqual({ lang: 'es', speaker: guestSpeaker('tendero') })
    expect(store.quote('Te lo cambio por dos repetidas, ni una más.')).toBeUndefined() // a team: never a dealer voice
    expect(store.quote('We never carry a quote of ours here, but if one came it is not indexed.')).toBeUndefined()
    expect(store.quote('anything somebody types into the proxy')).toBeUndefined()
    // its raw words had an injection's shape (rows.ts): never vouched for a voice
    expect(store.quote('Venga, mi niño, esta carta te la dejo muy bien de precio.')).toBeUndefined()
  })
})
