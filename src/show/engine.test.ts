import { describe, expect, it } from 'vitest'
import { isShowLine } from '../../shared/lines.ts'
import type { ShowEvent } from '../model/events'
import { parseEnvelope } from '../model/sanitize'
import { SpeechQueue } from '../tts/queue'
import { resolveChoice } from '../tts/select'
import type { SpeechProvider, Utterance } from '../tts/types'
import { applyToBoard, readingMs, ShowEngine, syncBoard } from './engine'

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
    show.setHealth('maker', { ok: true, agent: 'maker', mode: 'live', tick: 310, doors: 'open', paused: false, nextOpens: null, tickSeconds: 15, serverTick: 310, target: 'real' })
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

describe('the idle brain: the characters know what is going on', () => {
  const NOW = Date.parse('2026-10-03T07:25:00+02:00')
  const closedHealth = (agent: 'taker' | 'maker') => ({ ok: true, agent, mode: 'live' as const, tick: null, doors: 'closed', paused: true, nextOpens: '2026-10-03T09:00:00+02:00', tickSeconds: 60, serverTick: 159, target: 'real' as const })
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  function idleEngine(lang: 'es' | 'en') {
    const spoken: Utterance[] = []
    const provider: SpeechProvider = { name: 'webspeech', speak: async (u) => void spoken.push(u) }
    const show = new ShowEngine({ speech: new SpeechQueue({ provider }), idle: true, idleAfterMs: 5, lang, now: () => NOW, sleep: () => Promise.resolve() })
    return { show, spoken }
  }

  it('with the doors closed it talks about the countdown to the opening, in castellano', async () => {
    const { show, spoken } = idleEngine('es')
    show.setHealth('taker', closedHealth('taker'))
    show.setHealth('maker', closedHealth('maker'))
    show.start()
    await wait(150)
    show.stop()
    const said = spoken.map((u) => u.text).join('\n')
    expect(spoken.length).toBeGreaterThan(1)
    expect(said).toMatch(/95 minutos|hoy a las 9:00|puertas|cerrad/i)
    expect(spoken.every((u) => u.lang === 'es')).toBe(true)
  })

  it('says it in English with ?lang=en, and never in a mixed line', async () => {
    const { show, spoken } = idleEngine('en')
    show.setHealth('taker', closedHealth('taker'))
    show.start()
    await wait(150)
    show.stop()
    expect(spoken.map((u) => u.text).join('\n')).toMatch(/95 minutes|today at 9:00|doors|shut/i)
    expect(spoken.every((u) => u.lang === 'en')).toBe(true)
    for (const u of spoken) expect(isShowLine(u.speaker, u.text, 'en'), u.text).toBe(true)
  })

  it('does not repeat a line while the stage keeps talking to itself', async () => {
    const { show, spoken } = idleEngine('es')
    show.setHealth('taker', closedHealth('taker'))
    show.start()
    await wait(400)
    show.stop()
    const firsts = spoken.filter((u) => u.id.endsWith('#0')).map((u) => u.text)
    expect(firsts.length).toBeGreaterThan(4)
    // 4 beats fit well inside the default 6 minute window, and a closed-door bank has more than that.
    expect(new Set(firsts.slice(0, 4)).size).toBe(4)
  })

  it('announces a new neighbourhood page once, only when a live event first shows it', async () => {
    const { show, spoken } = engine()
    show.start()
    show.ingest(event(-1, { kind: 'post_ask', inputs: { ref: 'RET-03', price: 40 } }, 'maker'), true) // replay: seen, not news
    show.ingest(event(-2, { kind: 'post_ask', inputs: { ref: 'RET-04', price: 41 } }, 'maker'), false)
    await settle()
    expect(spoken.map((u) => u.text).join(' ')).not.toMatch(/Páginas nuevas|Llega|zona nueva|comerciar/)
    const fresh = engine()
    fresh.show.start()
    fresh.show.ingest(event(-3, { kind: 'post_ask', inputs: { ref: 'CHA-01', price: 40 } }, 'maker'), false)
    fresh.show.ingest(event(-4, { kind: 'post_ask', inputs: { ref: 'CHA-02', price: 41 } }, 'maker'), false)
    await settle()
    await settle()
    const mentions = fresh.spoken.filter((u) => /Chamberí/.test(u.text) && /(zona|Páginas|Llega)/.test(u.text))
    expect(mentions.length).toBe(1)
    show.stop()
    fresh.show.stop()
  })

  it('notices a Market Test session when the game clock crosses a two-hour mark', async () => {
    const { show, spoken } = engine()
    show.start()
    const tickAt = (id: number, t: number) => parseEnvelope({ id, tick: id, t, type: 'agent.tick', agent: 'maker', payload: { mode: 'live' } })!
    show.ingest(tickAt(-1, 3.9), false) // first reading: the slot is learned, nothing is announced
    await settle()
    expect(spoken).toEqual([])
    show.ingest(tickAt(-2, 4.1), false) // slot 1 → 2: a session started
    await settle()
    await settle()
    expect(spoken.map((u) => u.text).join(' ')).toMatch(/Test de Mercado/)
    show.stop()
  })
})

describe('a gap-free voice queue', () => {
  it('puts the next line in the queue while the current one is still being said', async () => {
    const started: string[] = []
    const release: (() => void)[] = []
    const provider: SpeechProvider = {
      name: 'webspeech',
      speak: (u) => new Promise<void>((resolve) => { started.push(u.id); release.push(resolve) }),
    }
    const speech = new SpeechQueue({ provider })
    const show = new ShowEngine({ speech, idle: false, sleep: () => Promise.resolve() })
    show.start()
    show.ingest(event(-40, { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18 } }, 'taker'), false)
    await settle()
    expect(started.length).toBe(1)
    expect(speech.backlog).toBeGreaterThanOrEqual(1) // line 2 waits in the queue, not in the stage
    release.shift()?.()
    await settle()
    expect(started.length).toBe(2) // and starts the moment line 1 ends
    release.forEach((r) => r())
    show.stop()
  })

  it('shows each caption when its voice starts, and the reading time only applies when muted', async () => {
    const sleeps: number[] = []
    const voiced = new SpeechQueue({ provider: { name: 'webspeech', speak: async () => undefined } })
    const a = new ShowEngine({ speech: voiced, idle: false, sleep: (ms) => { sleeps.push(ms); return Promise.resolve() } })
    a.start()
    a.ingest(event(-41, { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18 } }, 'taker'), false)
    await settle()
    a.stop()
    expect(sleeps[0]).toBe(500) // a voice sets the pace
    expect(sleeps[1]).toBeGreaterThan(500) // ...unless it ended at once (it did not speak): then the caption keeps its reading time
    const mutedSleeps: number[] = []
    const muted = new SpeechQueue({ provider: { name: 'webspeech', speak: async () => undefined } })
    muted.setMuted(true)
    const b = new ShowEngine({ speech: muted, idle: false, sleep: (ms) => { mutedSleeps.push(ms); return Promise.resolve() } })
    b.start()
    b.ingest(event(-42, { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18 } }, 'taker'), false)
    await settle()
    b.stop()
    expect(mutedSleeps[0]).toBeGreaterThan(1000) // text is read at reading speed
  })
})

describe('switching the language (the selector)', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('stops the beat being played, drops what was queued, and says the next things in the new language', async () => {
    const spoken: Utterance[] = []
    const release: (() => void)[] = []
    const provider: SpeechProvider = { name: 'webspeech', speak: (u) => new Promise<void>((resolve) => { spoken.push(u); release.push(resolve) }) }
    let current: 'es' | 'en' = 'es'
    const speech = new SpeechQueue({ provider, currentLang: () => current })
    const show = new ShowEngine({ speech, idle: false, sleep: () => Promise.resolve(), lang: 'es' })
    show.start()
    show.ingest(event(-50, { kind: 'accept_ask', inputs: { ref: 'SAL-05', ask: 18 } }, 'taker'), false)
    show.ingest(event(-51, { kind: 'post_ask', inputs: { ref: 'LAT-09', price: 68 } }), false)
    await settle()
    expect(spoken[0]?.lang).toBe('es')
    expect(show.getSnapshot().beat).not.toBeNull()
    current = 'en'
    show.setLang('en')
    release.forEach((r) => r())
    await settle()
    const s = show.getSnapshot()
    expect(s.line).toBeNull()
    expect(s.beat).toBeNull()
    expect(spoken.length).toBe(1) // nothing else of the old language was started
    show.ingest(event(-52, { kind: 'hold_ask', jev: { verdict: 'hold' }, inputs: { ref: 'MAL-03' } }), false)
    await settle()
    release.forEach((r) => r())
    await settle()
    const later = spoken.slice(1)
    expect(later.length).toBeGreaterThan(0)
    for (const u of later) {
      expect(u.lang).toBe('en')
      expect(isShowLine(u.speaker, u.text, 'en'), u.text).toBe(true)
    }
    show.stop()
  })

  it('is a no-op for the same language, and the idle talk follows the new language', async () => {
    const spoken: Utterance[] = []
    const provider: SpeechProvider = { name: 'webspeech', speak: async (u) => void spoken.push(u) }
    const show = new ShowEngine({ speech: new SpeechQueue({ provider }), idle: true, idleAfterMs: 5, lang: 'es', sleep: () => Promise.resolve() })
    show.setLang('es')
    show.start()
    await wait(80)
    show.setLang('en')
    spoken.length = 0
    await wait(150)
    show.stop()
    expect(spoken.length).toBeGreaterThan(0)
    expect(spoken.every((u) => u.lang === 'en' && isShowLine(u.speaker, u.text, 'en'))).toBe(true)
  })
})
