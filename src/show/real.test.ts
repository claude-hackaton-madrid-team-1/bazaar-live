import { describe, expect, it } from 'vitest'
import { detectLang } from '../../shared/detect-lang.ts'
import type { Lang } from '../../shared/lang.ts'
import { isRealLine } from '../../shared/real-lines.ts'
import { EMPTY_ITEM, type TranscriptItem } from '../../shared/transcript.ts'
import { planQuote, realBeat } from './real'

const EN_QUOTE = "Your abuela would've moved more than one. 31 P. I match what you move, nothing extra."
const ES_QUOTE = 'Venga, mi niño. Te lo dejo en 31 primas, ni una menos.'

const item = (extra: Partial<TranscriptItem>): TranscriptItem => ({ ...EMPTY_ITEM, id: 'f1', seq: 1, kind: 'thread_line', tick: 11, ...extra })
const dealerLine = (text: string | null, extra: Partial<TranscriptItem> = {}) =>
  item({ who: 'them', counterpart: 'chato', thread: 187, item: 'LAV-08', text, offer: { by: 'them', verb: 'ask', price: 31, item: 'LAV-08', final: false }, ...extra })

const spoken = (beat: ReturnType<typeof realBeat>) => (beat?.lines ?? []).filter((l) => !l.silent)
const shown = (beat: ReturnType<typeof realBeat>) => beat?.lines ?? []

describe('planQuote: a quote is spoken only in its own language', () => {
  it('speaks a quote in the selected language', () => {
    expect(planQuote(EN_QUOTE, 'en')).toEqual({ speak: true, lang: 'en' })
    expect(planQuote(ES_QUOTE, 'es')).toEqual({ speak: true, lang: 'es' })
  })
  it('shows, but does not speak, a quote in the other language', () => {
    expect(planQuote(EN_QUOTE, 'es')).toEqual({ speak: false, lang: 'en' })
    expect(planQuote(ES_QUOTE, 'en')).toEqual({ speak: false, lang: 'es' })
  })
  it('does not speak what it cannot place', () => {
    expect(planQuote('Venga', 'es')).toEqual({ speak: false, lang: 'unknown' })
  })
})

describe('a dealer thread line', () => {
  it('speaks the dealer real English line when the show is English', () => {
    const beat = realBeat(dealerLine(EN_QUOTE), 'en')
    expect(beat?.lines).toEqual([{ speaker: 'chato', text: EN_QUOTE }])
    expect(beat?.cue).toMatchObject({ kind: 'dealer', dealer: 'chato', move: 'bid', price: 31 })
  })

  it('shows the English quote and speaks a Spanish line from the offer when the show is Spanish', () => {
    const beat = realBeat(dealerLine(EN_QUOTE), 'es')
    expect(shown(beat).map((l) => [l.speaker, l.text, l.silent === true])).toEqual([
      ['chato', EN_QUOTE, true],
      ['chato', 'Lavapiés número 8 te sale por 31 primas.', false],
    ])
  })

  it('does the reverse for a Spanish quote in an English show', () => {
    const beat = realBeat(dealerLine(ES_QUOTE, { counterpart: 'abuela' }), 'en')
    expect(shown(beat).map((l) => [l.speaker, l.silent === true])).toEqual([['abuela', true], ['abuela', false]])
    expect(spoken(beat)[0]?.text).toBe('Lavapiés number 8 will cost you 31 primas.')
  })

  it('marks the final offer in the generated line', () => {
    const beat = realBeat(dealerLine(EN_QUOTE, { offer: { by: 'them', verb: 'ask', price: 31, item: 'LAV-08', final: true } }), 'es')
    expect(spoken(beat)[0]?.text).toContain('Precio final')
  })

  it('only shows a foreign quote when there is no structured offer to speak', () => {
    const beat = realBeat(dealerLine(EN_QUOTE, { offer: null }), 'es')
    expect(shown(beat)).toEqual([{ speaker: 'chato', text: EN_QUOTE, silent: true }])
    expect(spoken(beat)).toEqual([])
  })

  it('speaks the structured offer when the dealer line has no words', () => {
    const beat = realBeat(dealerLine(null), 'en')
    expect(beat?.lines).toEqual([{ speaker: 'chato', text: 'Lavapiés number 8 will cost you 31 primas.' }])
  })

  it('gives a dealer we have no character for to the narrator', () => {
    expect(realBeat(dealerLine(EN_QUOTE, { counterpart: 'tendero' }), 'en')?.lines[0]?.speaker).toBe('narrator')
  })

  it('has nothing to play for an empty line', () => {
    expect(realBeat(dealerLine(null, { offer: null }), 'en')).toBeNull()
  })
})

describe('our own messages', () => {
  const ours = (offer: TranscriptItem['offer']) => item({ who: 'us', counterpart: 'chato', thread: 187, item: 'LAV-08', offer })
  it('speaks our bid from the structure, as the buyer', () => {
    const beat = realBeat(ours({ by: 'us', verb: 'bid', price: 24, item: 'LAV-08', final: false }), 'en')
    expect(beat?.lines).toEqual([{ speaker: 'buyer', text: 'I offer 24 primas for Lavapiés number 8.' }])
    expect(beat?.agent).toBe('taker')
    expect(beat?.cue).toMatchObject({ kind: 'dealer', dealer: 'chato', move: 'bid', price: 24 })
  })
  it('speaks our ask as the seller, in Spanish when the show is Spanish', () => {
    const beat = realBeat(ours({ by: 'us', verb: 'ask', price: 31, item: 'LAV-08', final: false }), 'es')
    expect(beat?.lines).toEqual([{ speaker: 'seller', text: 'Quiero 31 primas por Lavapiés número 8.' }])
    expect(beat?.agent).toBe('maker')
  })
  it('says nothing for a message of ours with no offer', () => {
    expect(realBeat(ours(null), 'en')).toBeNull()
  })
  it('never carries a quote of ours (the feed has none)', () => {
    const beat = realBeat(item({ who: 'us', text: 'smuggled', offer: { by: 'us', verb: 'bid', price: 1, item: null, final: false } }), 'en')
    expect(JSON.stringify(beat)).not.toContain('smuggled')
  })
})

describe('thread opened and settlement', () => {
  it('opens in the selected language', () => {
    expect(realBeat(item({ kind: 'thread_opened', who: 'us', counterpart: 'abuela', item: 'LAV-08' }), 'es')?.lines).toEqual([{ speaker: 'buyer', text: 'Voy a por Lavapiés número 8.' }])
    expect(realBeat(item({ kind: 'thread_opened', who: 'us', counterpart: 'abuela', item: null }), 'es')).toBeNull()
  })
  it('narrates a settlement and plays the deal cue', () => {
    const beat = realBeat(item({ kind: 'settlement', counterpart: 'abuela', item: 'LAV-08', price: 31 }), 'en')
    expect(beat?.lines).toEqual([{ speaker: 'narrator', text: 'Deal done: Lavapiés number 8 for 31 primas.' }])
    expect(beat?.cue).toMatchObject({ kind: 'deal', big: true })
    expect(beat?.priority).toBeGreaterThanOrEqual(100)
  })
  it('has nothing to say about a settlement with no price', () => {
    expect(realBeat(item({ kind: 'settlement', price: null }), 'en')).toBeNull()
  })
})

describe('duels', () => {
  const replay = (role: 'buyer' | 'seller') =>
    item({
      id: 'dc:61', kind: 'duel_replay', counterpart: 'Rival Noche', item: 'MAL-02', role, status: 'deal', price: 55,
      lines: [
        { n: 1, speaker: 'them', tick: 40, price: 60, days: 3, text: ES_QUOTE },
        { n: 2, speaker: 'us', tick: 41, price: 50, days: 2, text: null },
        { n: 3, speaker: 'them', tick: 42, price: null, days: null, text: EN_QUOTE },
      ],
    })

  it('plays the replay once, with the rival in the opposite chair, then the verdict', () => {
    const beat = realBeat(replay('seller'), 'es')
    expect(shown(beat).map((l) => [l.speaker, l.silent === true])).toEqual([
      ['buyer', false], // the rival, speaking Spanish in a Spanish show
      ['seller', false], // our offer, from the structure (no words of ours in the data)
      ['buyer', true], // an English quote is only shown
      ['narrator', false],
    ])
    expect(shown(beat)[1]?.text).toBe('Mi oferta es 50 primas.')
    expect(shown(beat)[3]?.text).toBe('El duelo ha terminado: trato por 55 primas.')
    expect(beat?.id).toBe('real:dc:61')
  })

  it('swaps the chairs when we were the buyer', () => {
    expect(realBeat(replay('buyer'), 'en')?.lines[0]?.speaker).toBe('seller')
  })

  it('announces a live duel as text only, naming the item and the rival, never its words', () => {
    const beat = realBeat(item({ id: 'dl:63', kind: 'duel_live', counterpart: 'Rival Sol', item: 'LAT-05', status: 'live' }), 'en')
    expect(beat?.lines).toEqual([{ speaker: 'narrator', text: 'Duel in progress: LAT-05 vs Rival Sol', silent: true }])
    expect(realBeat(item({ id: 'dl:63', kind: 'duel_live', counterpart: 'Rival Sol', item: 'LAT-05', status: 'live' }), 'es')?.lines[0]?.text).toBe('Duelo en marcha: LAT-05 contra Rival Sol')
  })
})

describe('one language for every spoken line', () => {
  const samples: TranscriptItem[] = [
    dealerLine(EN_QUOTE), dealerLine(ES_QUOTE), dealerLine('ok'), dealerLine(null),
    dealerLine(EN_QUOTE, { offer: { by: 'them', verb: 'bid', price: 9, item: null, final: true } }),
    item({ who: 'us', offer: { by: 'us', verb: 'ask', price: 12, item: 'SAL-01', final: true } }),
    item({ kind: 'settlement', price: 5, item: 'RET-03' }),
    item({ kind: 'thread_opened', who: 'us', item: 'CHA-02' }),
    item({ kind: 'duel_replay', role: 'seller', status: 'no_deal', price: null, counterpart: 'R', item: 'MAL-02', lines: [
      { n: 1, speaker: 'them', tick: 1, price: 3, days: 1, text: ES_QUOTE }, { n: 2, speaker: 'them', tick: 2, price: 3, days: 1, text: EN_QUOTE },
    ] }),
  ]
  it.each<Lang>(['es', 'en'])('every spoken line is a generated %s line or a %s quote', (lang) => {
    for (const sample of samples) {
      for (const line of spoken(realBeat(sample, lang))) {
        const generated = isRealLine(line.text, lang)
        const quote = detectLang(line.text) === lang
        expect(generated || quote, `${lang}: ${line.text}`).toBe(true)
        // and never the other language's template
        expect(isRealLine(line.text, lang === 'es' ? 'en' : 'es') && !generated, line.text).toBe(false)
      }
    }
  })
})
