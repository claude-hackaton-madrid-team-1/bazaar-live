import { describe, expect, it } from 'vitest'
import type { ShowEvent } from '../model/events'
import { parseEnvelope } from '../model/sanitize'
import { SpeechQueue } from '../tts/queue'
import { resolveChoice } from '../tts/select'
import type { SpeechProvider, Utterance } from '../tts/types'
import { applyToBoard, readingMs, ShowEngine } from './engine'

function event(id: number, payload: Record<string, unknown>, agent: 'taker' | 'maker' = 'maker', type = 'agent.decision'): ShowEvent {
  const e = parseEnvelope({ id, tick: 300, t: 6, type, agent, payload: { status: 'approved', dry_run: false, ...payload } })
  if (!e) throw new Error('bad fixture')
  return e
}

function engine() {
  const spoken: Utterance[] = []
  const provider: SpeechProvider = { name: 'webspeech', speak: async (u) => void spoken.push(u) }
  const speech = new SpeechQueue({ provider })
  const show = new ShowEngine({ speech, idle: false, sleep: () => Promise.resolve() })
  return { show, spoken }
}

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('ShowEngine', () => {
  it('puts replayed history in the transcript without speaking it, and builds the board', async () => {
    const { show, spoken } = engine()
    show.start()
    show.ingest(event(-1, { kind: 'post_ask', inputs: { ref: 'LAT-09', side: 'ask', price: 68 } }), true)
    await settle()
    const s = show.getSnapshot()
    expect(spoken).toEqual([])
    expect(s.transcript.every((t) => t.kind === 'history')).toBe(true)
    expect(s.board.map((c) => [c.ref, c.price])).toEqual([['LAT-09', 68]])
    show.stop()
  })

  it('acts out a live move: cue first, then every line spoken in order', async () => {
    const { show, spoken } = engine()
    show.start()
    show.ingest(event(-2, { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18 } }, 'taker'), false)
    await settle()
    const s = show.getSnapshot()
    expect(s.reach).toMatchObject({ ref: 'SAL-05', take: true })
    expect(spoken.map((u) => u.speaker)).toEqual(s.transcript.map((t) => t.speaker))
    expect(spoken.length).toBeGreaterThan(1)
    show.stop()
  })

  it('counts heartbeats only for live ticks', () => {
    const { show } = engine()
    show.ingest(event(-3, { mode: 'live' }, 'taker', 'agent.tick'), true)
    show.ingest(event(-4, { mode: 'live' }, 'taker', 'agent.tick'), false)
    expect(show.getSnapshot().heartbeat.taker).toBe(1)
    expect(show.getSnapshot().ticks.taker).toBe(300)
  })
})

describe('board and pacing helpers', () => {
  it('posts, reprices and cancels cards', () => {
    let board = applyToBoard([], { kind: 'post', side: 'ask', ref: 'LAT-09', price: 68 })
    board = applyToBoard(board, { kind: 'reprice', side: 'ask', ref: 'LAT-09', price: 62 })
    expect(board).toEqual([{ key: 'ask:LAT-09', ref: 'LAT-09', side: 'ask', price: 62, version: 1 }])
    expect(applyToBoard(board, { kind: 'cancel', side: 'ask', ref: 'LAT-09' })).toEqual([])
  })

  it('reads faster when the queue is long', () => {
    expect(readingMs('short', 0)).toBeGreaterThan(readingMs('short', 5))
    expect(readingMs('x'.repeat(500), 0)).toBe(4800)
  })

  it('resolves the voice choice by what the proxy offers', () => {
    expect(resolveChoice('auto', [], true)).toBe('webspeech')
    expect(resolveChoice('auto', ['gemini', 'elevenlabs'], true)).toBe('elevenlabs')
    expect(resolveChoice('gemini', ['elevenlabs'], true)).toBe('webspeech')
    expect(resolveChoice('webspeech', ['elevenlabs'], false)).toBe('off')
    expect(resolveChoice('off', ['elevenlabs'], true)).toBe('off')
  })
})
