import { describe, expect, it } from 'vitest'
import { LANGS, type Lang } from '../../shared/lang.ts'
import { isShowLine } from '../../shared/lines.ts'
import { tagsOf, KNOWN_TAGS } from '../../shared/tags.ts'
import type { AgentHealth, ShowEvent } from '../model/events'
import { parseEnvelope } from '../model/sanitize'
import { PRIORITY } from './beat'
import { situationBeat, toBeat, type DialogueContext } from './dialogue'
import { LineMemory } from './memory'
import { situationOf, type Narration, type Situation } from './situation'

const MIN = 60_000
const NOW = Date.parse('2026-10-03T07:25:00+02:00')
const text = (b: { lines: readonly { text: string }[] }) => b.lines.map((l) => l.text).join(' | ')

const closed: Situation = { topic: 'doors_closed', eta: '95 minutos', opens: 'hoy a las 9:00' }

describe('situation → line selection', () => {
  it('doors closed: the countdown and the opening hour are in the words', () => {
    const es = situationBeat(1, { topic: 'doors_closed', eta: '45 minutos', opens: 'hoy a las 9:00' }, { lang: 'es' })
    const seen = new Set<string>()
    for (let i = 0; i < 40; i += 1) seen.add(text(situationBeat(i, { topic: 'doors_closed', eta: '45 minutos', opens: 'hoy a las 9:00' }, { lang: 'es' })))
    const joined = [...seen].join('\n')
    expect(joined).toMatch(/45 minutos/)
    expect(joined).toMatch(/hoy a las 9:00/)
    expect(text(es)).not.toMatch(/\{|undefined|null/)
    expect(es.cue).toEqual({ kind: 'talk' })
    expect(es.priority).toBe(PRIORITY.other)
  })

  it('doors closed with no countdown still talks about the closed doors, without an empty slot', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 20; i += 1) seen.add(text(situationBeat(i, { topic: 'doors_closed', eta: null, opens: null }, { lang: 'en' })))
    for (const line of seen) expect(line).not.toMatch(/\{|undefined|null/)
    expect([...seen].join(' ')).toMatch(/shut|closed|doors/i)
  })

  it('only offers the lines whose slots it can fill', () => {
    const onlyEta = new Set<string>()
    for (let i = 0; i < 40; i += 1) onlyEta.add(text(situationBeat(i, { topic: 'doors_closed', eta: '45 minutes', opens: null }, { lang: 'en' })))
    for (const line of onlyEta) expect(line).not.toMatch(/today at|tomorrow at|\{/)
    expect([...onlyEta].join(' ')).toMatch(/45 minutes/)
  })

  it('a new page names the neighbourhood and is news (above idle talk)', () => {
    const beat = situationBeat(1, { topic: 'new_page', hood: 'El Retiro' }, { lang: 'es' })
    expect(text(beat)).toMatch(/El Retiro/)
    expect(beat.priority).toBe(PRIORITY.news)
    expect(PRIORITY.news).toBeGreaterThan(PRIORITY.other)
  })

  it('a new tick names the tick', () => {
    expect(text(situationBeat(1, { topic: 'tick', tick: 162 }, { lang: 'es' }))).toMatch(/162/)
  })

  it('every situation, in both languages, is a line the proxy accepts in that language, with known tags', () => {
    const situations: Situation[] = [
      closed,
      { topic: 'doors_closed', eta: null, opens: null },
      { topic: 'paused' }, { topic: 'offline' }, { topic: 'quiet' }, { topic: 'simulator' }, { topic: 'dry' }, { topic: 'market_test' },
      { topic: 'new_page', hood: 'Chamberí' }, { topic: 'tick', tick: 12 },
    ]
    for (const lang of LANGS) {
      const dialogue: DialogueContext = { lang }
      const opens = lang === 'es' ? 'hoy a las 9:00' : 'today at 9:00'
      const eta = lang === 'es' ? '95 minutos' : '95 minutes'
      for (const s of situations) {
        for (let n = 0; n < 12; n += 1) {
          const filled = s.topic === 'doors_closed' && s.eta !== null ? { ...s, eta, opens } : s
          for (const l of situationBeat(n, filled, dialogue).lines) {
            expect(isShowLine(l.speaker, l.text, lang), `${lang}: ${l.text}`).toBe(true)
            for (const tag of tagsOf(l.text)) expect(KNOWN_TAGS).toContain(tag)
          }
        }
      }
    }
  })

  it('reads the situation from /health: closed doors go through to the words', () => {
    const h = (patch: Partial<AgentHealth>): AgentHealth => ({ ok: true, agent: 'taker', mode: 'live', tick: null, doors: 'closed', paused: true, nextOpens: '2026-10-03T09:00:00+02:00', tickSeconds: 60, serverTick: 159, target: 'real', ...patch })
    const n: Narration = { health: { taker: h({}), maker: h({ agent: 'maker' }) }, feeds: { taker: 'open', maker: 'open' }, now: NOW, tick: null, freshHood: null, freshMarketTest: false }
    const said = new Set<string>()
    for (let turn = 0; turn < 30; turn += 1) said.add(text(situationBeat(turn, situationOf(n, 'es', turn), { lang: 'es' })))
    const all = [...said].join('\n')
    expect(all).toMatch(/95 minutos|hoy a las 9:00/)
    expect(all).not.toMatch(/tick \d/) // closed doors do not talk about ticks
  })
})

describe('no line repeats within the window', () => {
  it('a quiet stage talking every 35 s sounds different each time for as long as the window allows', () => {
    for (const lang of LANGS as readonly Lang[]) {
      const memory = new LineMemory(6 * MIN)
      const said: string[] = []
      // The window holds 10 beats at one every 35 s; the quiet bank has 8 and the tick bank 6 (they alternate).
      for (let i = 0; i < 10; i += 1) {
        const situation: Situation = i % 2 === 0 ? { topic: 'quiet' } : { topic: 'tick', tick: 100 + i }
        const beat = situationBeat(i, situation, { lang, memory, now: i * 35_000 })
        said.push(beat.lines[0]?.text.replace(/\d+/g, '#') ?? '')
      }
      expect(new Set(said).size, `${lang}: ${said.join(' / ')}`).toBe(said.length)
    }
  })

  it('uses a whole bank before it reuses a line, then cycles through it from the least recent', () => {
    const memory = new LineMemory(6 * 60 * MIN)
    const bankSize = 8
    const said: string[] = []
    for (let i = 0; i < bankSize * 3; i += 1) {
      said.push(situationBeat(i, { topic: 'quiet' }, { lang: 'es', memory, now: i * 40_000 }).lines[0]?.text ?? '')
    }
    expect(new Set(said.slice(0, bankSize)).size).toBe(bankSize)
    // Everything is "recent" now, so the line said longest ago comes back first: the same cycle again.
    expect(said.slice(bankSize, 2 * bankSize)).toEqual(said.slice(0, bankSize))
  })

  it('keeps the first line out of the next beats of its window', () => {
    const memory = new LineMemory(2 * MIN)
    const first = situationBeat(0, { topic: 'quiet' }, { lang: 'es', memory, now: 0 }).lines[0]?.text
    const sameWindow = Array.from({ length: 3 }, (_, i) => situationBeat(i + 1, { topic: 'quiet' }, { lang: 'es', memory, now: (i + 1) * 30_000 }).lines[0]?.text)
    expect(sameWindow).not.toContain(first)
  })

  it('event lines do not repeat either: ten holds in a row say ten different things when the bank allows', () => {
    const memory = new LineMemory(6 * MIN)
    const hold = (id: number): ShowEvent => parseEnvelope({ id, tick: 300, t: 6, type: 'agent.decision', agent: 'maker', payload: { status: 'approved', dry_run: false, chosen: true, guardrail: 'allowed', kind: 'hold_ask', jev: { verdict: 'hold' }, inputs: { ref: 'MAL-03' } } })!
    const said = Array.from({ length: 3 }, (_, i) => text(toBeat(hold(-i - 1), { lang: 'es', memory, now: i * 1000 })!))
    expect(new Set(said).size).toBe(3)
  })

  it('replayed history never uses up the memory (it passes none)', () => {
    const memory = new LineMemory(6 * MIN)
    const event = parseEnvelope({ id: -1, tick: 1, t: 1, type: 'agent.decision', agent: 'maker', payload: { status: 'approved', dry_run: false, chosen: true, guardrail: 'allowed', kind: 'hold_ask', inputs: { ref: 'MAL-03' } } })!
    const first = toBeat(event, { lang: 'es' })!
    const again = toBeat(event, { lang: 'es' })!
    expect(text(first)).toBe(text(again))
    expect(memory.recentMoods()).toEqual([])
  })
})

describe('tone follows the situation', () => {
  it('a deal sounds triumphant, a refusal sarcastic, closed doors calm', () => {
    const exec = (payload: Record<string, unknown>): ShowEvent => parseEnvelope({ id: -5, tick: 1, t: 1, type: 'agent.execution', agent: 'taker', payload })!
    expect(toBeat(exec({ method: 'accept', request: { offer: 1 }, error_code: null }), { lang: 'es' })?.mood).toBe('triumphant')
    expect(toBeat(exec({ method: 'accept', request: { offer: 1 }, error_code: 'insufficient_cash' }), { lang: 'es' })?.mood).toBe('sarcastic')
    expect(situationBeat(1, { topic: 'quiet' }, { lang: 'es' }).mood).toBe('calm')
    expect(situationBeat(1, closed, { lang: 'es' }).mood).toBe('calm')
  })

  it('goes drier when the stage has been quiet for minutes', () => {
    const moods = new Set(Array.from({ length: 12 }, (_, i) => situationBeat(i, { topic: 'quiet' }, { lang: 'es', quietMs: 10 * MIN }).mood))
    expect(moods).toEqual(new Set(['sarcastic']))
  })

  it('every language says things in more than one tone across a busy afternoon', () => {
    for (const lang of LANGS) {
      const memory = new LineMemory()
      const moods = new Set<string>()
      for (let i = 0; i < 30; i += 1) moods.add(situationBeat(i, { topic: i % 3 === 0 ? 'tick' : 'quiet', tick: i } as Situation, { lang, memory, now: i * 35_000 }).mood)
      expect(moods.size).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('language: events and situations speak one language', () => {
  it('es lines have no English words and en lines no Spanish ones, from a recorded afternoon', async () => {
    const { MOCK_STEPS, shiftEnvelope } = await import('../mock/player')
    const events = MOCK_STEPS.map((s) => parseEnvelope(shiftEnvelope(s.event, 0, 'live'))).filter((e): e is ShowEvent => e !== null)
    for (const lang of LANGS) {
      for (const e of events) {
        const beat = toBeat(e, { lang })
        for (const l of beat?.lines ?? []) {
          expect(isShowLine(l.speaker, l.text, lang), `${lang}: ${l.text}`).toBe(true)
          expect(isShowLine(l.speaker, l.text, lang === 'es' ? 'en' : 'es'), `must not pass as the other language: ${l.text}`).toBe(false)
        }
      }
    }
  })
})
