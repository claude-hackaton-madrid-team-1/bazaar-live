import { describe, expect, it } from 'vitest'
import type { ShowEvent } from '../model/events'
import { parseEnvelope } from '../model/sanitize'
import { SpeechQueue } from '../tts/queue'
import { resolveChoice } from '../tts/select'
import type { SpeechProvider, Utterance } from '../tts/types'
import { EMPTY_ITEM, type TranscriptItem } from '../../shared/transcript.ts'
import { applyToBoard, readingMs, ShowEngine, syncBoard } from './engine'
import { realBeat } from './real'

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
    const seen: unknown[] = []
    let show: ShowEngine | null = null
    const provider: SpeechProvider = {
      name: 'webspeech',
      speak: async (u) => void seen.push({ speaker: u.speaker, reach: show?.getSnapshot().reach, line: show?.getSnapshot().line?.text === u.text }),
    }
    show = new ShowEngine({ speech: new SpeechQueue({ provider }), idle: false, sleep: () => Promise.resolve() })
    show.start()
    show.ingest(event(-2, { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18 } }, 'taker'), false)
    await settle()
    expect(seen.length).toBeGreaterThan(1)
    expect(seen[0]).toMatchObject({ speaker: 'buyer', reach: { ref: 'SAL-05', take: true }, line: true })
    expect(show.getSnapshot().transcript.map((t) => t.speaker)).toEqual(seen.map((x) => (x as { speaker: string }).speaker))
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
    let board = applyToBoard([], { kind: 'post', side: 'ask', ref: 'LAT-09', price: 68 }, 1)
    board = applyToBoard(board, { kind: 'reprice', side: 'ask', ref: 'LAT-09', price: 62 }, 2)
    expect(board).toEqual([{ key: 'ask:LAT-09', ref: 'LAT-09', side: 'ask', price: 62, version: 1, at: 2, tick: null }])
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

describe('after a beat', () => {
  it('relaxes the stage: no lingering reach, handshake or dealer', async () => {
    const { show } = engine()
    show.start()
    show.ingest(event(-20, { kind: 'dealer_open', inputs: { dealer: 'abuela', item: 'sobre_barrio' } }, 'taker'), false)
    await settle()
    const s = show.getSnapshot()
    expect([s.line, s.beat, s.reach, s.deal, s.dealer]).toEqual([null, null, null, null, null])
    expect(s.transcript.length).toBeGreaterThan(0)
    show.stop()
  })
})

describe('board sync and stale events', () => {
  it('follows /state: a sold card leaves, a repriced one flashes, a just-posted one stays', () => {
    const now = 100_000
    const old = { key: 'ask:LAT-09', ref: 'LAT-09', side: 'ask' as const, price: 68, version: 0, at: 0, tick: null }
    const sold = { key: 'ask:MAL-03', ref: 'MAL-03', side: 'ask' as const, price: 24, version: 0, at: 0, tick: null }
    const fresh = { key: 'ask:SAL-02', ref: 'SAL-02', side: 'ask' as const, price: 31, version: 0, at: now - 5000, tick: null }
    const next = syncBoard([old, sold, fresh], [{ id: 1, side: 'ask', ref: 'LAT-09', price: 62, venue: 'rastro' }], now)
    expect(next.map((c) => [c.ref, c.price, c.version])).toEqual([
      ['LAT-09', 62, 1],
      ['SAL-02', 31, 0],
    ])
    expect(syncBoard(next, [], now + 60_000)).toEqual([])
  })

  it('treats a live event far behind the agent tick as history', async () => {
    const { show, spoken } = engine()
    show.start()
    show.setHealth('maker', { ok: true, agent: 'maker', mode: 'live', tick: 310, doors: 'open', paused: false, nextOpens: null, tickSeconds: 15, serverTick: 310 })
    show.ingest(event(-30, { kind: 'post_ask', inputs: { ref: 'LAT-09', price: 68 } }), false)
    await settle()
    expect(spoken).toEqual([])
    expect(show.getSnapshot().transcript.every((t) => t.kind === 'history')).toBe(true)
    show.stop()
  })
})

describe('a /state snapshot older than our own events (review P2 #1)', () => {
  const offer = (price: number) => [{ id: 1, side: 'ask', ref: 'LAT-09', price, venue: 'rastro' }]
  const board = (show: ShowEngine) => show.getSnapshot().board.map((c) => [c.ref, c.price, c.version])
  const live = (id: number, tick: number, payload: Record<string, unknown>) =>
    parseEnvelope({ id, tick, t: tick, type: 'agent.decision', agent: 'maker', payload: { status: 'approved', dry_run: false, tick, ...payload } })!

  it('keeps a cancelled card gone until a newer snapshot', () => {
    const { show } = engine()
    show.syncBoard(offer(68), 9)
    show.ingest(live(-1, 10, { kind: 'cancel_ask', inputs: { ref: 'LAT-09', side: 'ask' } }), true)
    expect(board(show)).toEqual([])
    show.syncBoard(offer(68), 10) // read at the start of tick 10, before the cancel
    expect(board(show)).toEqual([])
    show.syncBoard(offer(68), 11) // stamped 11 while tick 11 runs: its offers are still tick 10's
    expect(board(show)).toEqual([])
    show.syncBoard(offer(68), 12) // two ticks later it still lists it: the cancel did not happen
    expect(board(show)).toEqual([['LAT-09', 68, 0]])
  })

  it('keeps a card posted this tick through a snapshot from the same tick', () => {
    const { show } = engine()
    show.ingest(live(-2, 10, { kind: 'post_ask', inputs: { ref: 'LAT-09', side: 'ask', price: 68 } }), true)
    show.syncBoard([], 10)
    expect(board(show)).toEqual([['LAT-09', 68, 0]])
    show.syncBoard([], 11)
    expect(board(show)).toEqual([['LAT-09', 68, 0]])
    show.syncBoard([], 12)
    expect(board(show)).toEqual([])
  })

  it('keeps our new price, and flashes once, when an older snapshot still has the old one', () => {
    const { show } = engine()
    show.syncBoard(offer(68), 9)
    show.ingest(live(-3, 10, { kind: 'reprice_ask', inputs: { ref: 'LAT-09', side: 'ask', price: 59 }, move: { price: 59 } }), true)
    expect(board(show)).toEqual([['LAT-09', 59, 1]])
    show.syncBoard(offer(68), 10)
    expect(board(show)).toEqual([['LAT-09', 59, 1]])
    show.syncBoard(offer(68), 11)
    expect(board(show)).toEqual([['LAT-09', 59, 1]])
    show.syncBoard(offer(59), 12)
    expect(board(show)).toEqual([['LAT-09', 59, 1]])
  })
})

describe('ShowEngine with real conversations', () => {
  const dealerItem = (text: string): TranscriptItem => ({
    ...EMPTY_ITEM, id: 'f1', seq: 1, kind: 'thread_line', tick: null, who: 'them', counterpart: 'chato', thread: 187, item: 'LAV-08', text,
    offer: { by: 'them', verb: 'ask', price: 31, item: 'LAV-08', final: false },
  })
  const quote = "Your abuela would've moved more than one. 31 P. I match what you move, nothing extra."

  it('speaks the real English line, and puts a replayed one in the captions only', async () => {
    const { show, spoken } = engine()
    show.start()
    const beat = realBeat(dealerItem(quote), 'en')
    if (!beat) throw new Error('no beat')
    show.ingestBeat({ ...beat, id: 'real:history' }, true)
    show.ingestBeat(beat, false)
    await settle()
    expect(spoken.map((u) => [u.speaker, u.text])).toEqual([['chato', quote]])
    expect(show.getSnapshot().transcript.map((t) => t.kind)).toEqual(['history', 'played'])
    show.stop()
  })

  it('shows a quote of the other language in the captions but never gives it to a voice', async () => {
    const { show, spoken } = engine()
    show.start()
    const beat = realBeat(dealerItem(quote), 'es')
    if (!beat) throw new Error('no beat')
    show.ingestBeat(beat, false)
    await settle()
    expect(spoken.map((u) => u.text)).toEqual(['Lavapiés número 8 te sale por 31 primas.'])
    expect(show.getSnapshot().transcript.map((t) => t.text)).toEqual([quote, 'Lavapiés número 8 te sale por 31 primas.'])
    show.stop()
  })
})
