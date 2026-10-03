import { describe, expect, it } from 'vitest'
import { PRIORITY, type Beat, type Cue } from './beat'
import { Director } from './director'

function beat(id: string, priority: number, cue: Cue = { kind: 'talk' }, agent: 'taker' | 'maker' = 'maker'): Beat {
  return { id, agent, tick: 1, priority, lines: [{ speaker: 'seller', text: id }], cue, denied: false, jev: null, practice: false, note: null }
}

describe('Director', () => {
  it('plays beats in arrival order', () => {
    const d = new Director()
    d.push(beat('post', PRIORITY.post))
    d.push(beat('deal', PRIORITY.deal))
    expect(d.next().beat?.id).toBe('post')
    expect(d.next().beat?.id).toBe('deal')
    expect(d.next().beat).toBeNull()
  })

  it('drops the least interesting (oldest among equals) when the queue is full', () => {
    const d = new Director({ maxQueue: 3 })
    d.push(beat('hold1', PRIORITY.hold))
    d.push(beat('deal', PRIORITY.deal))
    d.push(beat('hold2', PRIORITY.hold))
    const dropped = d.push(beat('post', PRIORITY.post))
    expect(dropped.map((b) => b.id)).toEqual(['hold1'])
    expect([d.next().beat?.id, d.next().beat?.id, d.next().beat?.id]).toEqual(['deal', 'hold2', 'post'])
  })

  it('skips stale small talk but keeps a stale deal', () => {
    let now = 0
    const d = new Director({ maxAgeMs: 1000, now: () => now })
    d.push(beat('hold', PRIORITY.hold))
    d.push(beat('deal', PRIORITY.deal))
    now = 5000
    const { beat: next, skipped } = d.next()
    expect(skipped.map((b) => b.id)).toEqual(['hold'])
    expect(next?.id).toBe('deal')
  })

  it('merges the queued holds of one agent into the first', () => {
    const d = new Director()
    const hold = (id: string): Cue => ({ kind: 'hold', side: 'ask', ref: id, count: 1 })
    d.push(beat('h1', PRIORITY.hold, hold('A')))
    d.push(beat('post', PRIORITY.post))
    d.push(beat('h2', PRIORITY.hold, hold('B')))
    d.push(beat('h3', PRIORITY.hold, hold('C')))
    const first = d.next().beat
    expect(first?.cue).toMatchObject({ kind: 'hold', count: 3 })
    expect(d.next().beat?.id).toBe('post')
    expect(d.size).toBe(0)
  })
})
