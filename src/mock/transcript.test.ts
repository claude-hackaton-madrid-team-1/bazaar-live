import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLang } from '../../shared/detect-lang.ts'
import { parseItem } from '../../shared/transcript-parse.ts'
import { realBeat } from '../show/real'
import { MOCK_TRANSCRIPT, MockTranscriptPlayer } from './transcript'

afterEach(() => vi.useRealTimers())

describe('the mock transcript', () => {
  it('is all valid items, with unique ids', () => {
    const parsed = MOCK_TRANSCRIPT.map((s, i) => parseItem({ ...s.item, seq: i + 1 }))
    expect(parsed.every((p) => p !== null)).toBe(true)
    expect(new Set(MOCK_TRANSCRIPT.map((s) => s.item.id)).size).toBe(MOCK_TRANSCRIPT.length)
  })

  it('mixes a Spanish and an English quote, and gives every item a beat in both languages', () => {
    const langs = MOCK_TRANSCRIPT.map((s) => s.item.text).filter((t): t is string => t !== null).map(detectLang)
    expect(langs).toContain('es')
    expect(langs).toContain('en')
    for (const lang of ['es', 'en'] as const) {
      for (const [i, step] of MOCK_TRANSCRIPT.entries()) {
        const item = parseItem({ ...step.item, seq: i + 1 })
        expect(item && realBeat(item, lang), `${lang} ${step.item.id}`).not.toBeNull()
      }
    }
  })

  it('contains no secret-looking or private field', () => {
    const dump = JSON.stringify(MOCK_TRANSCRIPT)
    expect(dump).not.toMatch(/limit|reason|postgres|password|secret/i)
  })

  it('plays the scene in order and loops with fresh ids', () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const player = new MockTranscriptPlayer({ speed: 8, onItems: (items) => seen.push(...items.map((i) => i.id)) })
    player.start()
    vi.advanceTimersByTime(60_000 / 8 + 2500 / 8)
    player.stop()
    expect(seen.slice(0, MOCK_TRANSCRIPT.length)).toEqual(MOCK_TRANSCRIPT.map((s) => `${s.item.id}~0`))
    expect(seen[MOCK_TRANSCRIPT.length]).toBe(`${MOCK_TRANSCRIPT[0]?.item.id}~1`)
  })
})
