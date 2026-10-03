import { describe, expect, it } from 'vitest'
import { parseBatch, parseItem } from './transcript-parse.ts'

const good = { id: 'f1', seq: 1, kind: 'thread_line', tick: 11, counterpart: 'chato', who: 'them', thread: 187, item: 'LAV-08', text: 'hola', offer: { by: 'them', verb: 'ask', price: 31, item: 'LAV-08', final: true }, price: null, status: null, role: null, lines: [] }

describe('parseItem', () => {
  it('keeps a good item', () => {
    expect(parseItem(good)).toMatchObject({ id: 'f1', seq: 1, kind: 'thread_line', text: 'hola', offer: { price: 31, final: true } })
  })
  it('cleans again what a server should already have cleaned', () => {
    expect(parseItem({ ...good, text: '[shouts] hi <b>x</b>', counterpart: '<x>', item: 'drop' })).toMatchObject({ text: 'hi x', counterpart: null, item: null })
  })
  it('never carries text for our side', () => {
    expect(parseItem({ ...good, who: 'us', text: 'smuggled' })?.text).toBeNull()
  })
  it('rejects the shapes it does not know', () => {
    for (const bad of [null, 'x', [], { ...good, id: '' }, { ...good, seq: 'a' }, { ...good, kind: 'nope' }, { ...good, id: 'x'.repeat(80) }]) expect(parseItem(bad)).toBeNull()
  })
  it('drops a malformed offer or line instead of the whole item', () => {
    const item = parseItem({ ...good, offer: { by: 'them', verb: 'steal', price: 5 }, lines: [{ n: 1, speaker: 'them', text: 'a' }, { n: 'x' }, 7] })
    expect(item?.offer).toBeNull()
    expect(item?.lines).toHaveLength(1)
  })
})

describe('parseBatch', () => {
  it('parses a batch and skips bad items', () => {
    expect(parseBatch({ epoch: 'e1', cursor: 3, enabled: true, replay: true, items: [good, { nope: 1 }] })).toMatchObject({ epoch: 'e1', cursor: 3, enabled: true, replay: true, items: [{ id: 'f1' }] })
  })
  it('refuses anything that is not a batch', () => {
    for (const bad of [null, {}, { epoch: 'e', cursor: 'x', items: [] }, { epoch: 'e', cursor: 1, items: 'no' }]) expect(parseBatch(bad)).toBeNull()
  })
})
