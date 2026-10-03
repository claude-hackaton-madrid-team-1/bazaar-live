import { describe, expect, it } from 'vitest'
import { BANK_KEYS, MOODS } from './bank.ts'
import { LANGS, parseLang, type Lang } from './lang.ts'
import { fill, isShowLine, NO_VALUES, PACKS, rawLines, slotsOf, usable, type SlotValues } from './lines.ts'
import { KNOWN_TAGS, tagsOf } from './tags.ts'
import { etaWords, HOODS, opensWords, slotPatterns, VOCAB } from './vocab.ts'

/** Words that only the other language uses (short, common, and never a Madrid proper noun). */
const ENGLISH_ONLY = /(?<![\p{L}'])(the|and|you|your|you're|it's|its|for|with|but|this|that|those|these|are|was|were|have|has|not|don't|doesn't|just|from|what|when|who|why|how|of|to|is|on|in|at|my|we|our|us|an|i|i'm|i'll|i've|after|here|there|will|would|can|all|any|now|good|let|let's|one|out|up|too|very)(?![\p{L}'])/iu
const SPANISH_ONLY = /((?<![\p{L}'])(el|los|las|una|un|que|con|para|pero|por|muy|nada|ya|del|al|mi|mis|tu|tus|su|sus|es|son|está|estamos|hoy|aquí|ahora|esto|eso|esa|ese|yo|usted|tú|vamos|hay|más|sin)(?![\p{L}'])|[¿¡ñáéíóú])/iu

/** A line with its tags and slots removed, so only the template's own words are checked. */
const words = (text: string): string => text.replace(/\[[a-z ]+\]/gi, ' ').replace(/\{[a-zA-Z]+\}/g, ' ')

/** Every slot filled with the words the show itself produces in that language. */
function sample(lang: Lang): SlotValues {
  const v = VOCAB[lang]
  return {
    card: `La Latina ${v.number} 9`,
    price: '30 primas',
    ask: '40 primas',
    item: v.items.rare,
    dealerName: v.dealers.chato,
    verdict: v.verdicts.quick_sale,
    error: v.errors.insufficient_cash,
    kind: v.kinds.post_ask,
    count: '4',
    eta: etaWords(45, lang),
    opens: opensWords(0, 6, 9, 0, lang),
    hood: HOODS.RET ?? 'El Retiro',
    tick: '160',
  }
}

describe('lang', () => {
  it('defaults to castellano and reads es / en, with or without a region', () => {
    expect(parseLang(null)).toBe('es')
    expect(parseLang('')).toBe('es')
    expect(parseLang('fr')).toBe('es')
    expect(parseLang('EN')).toBe('en')
    expect(parseLang('en-GB')).toBe('en')
    expect(parseLang('es-ES')).toBe('es')
  })
})

describe('the language packs', () => {
  it.each(LANGS)('%s has every bank, each with lines to say', (lang) => {
    for (const key of BANK_KEYS) {
      const bank = PACKS[lang][key]
      expect(bank.length, `${lang}.${key}`).toBeGreaterThan(0)
      for (const variant of bank) expect(variant.lines.length, `${lang}.${key}`).toBeGreaterThan(0)
    }
  })

  it('both languages use the same slots in every bank, so the same facts fill both', () => {
    for (const key of BANK_KEYS) {
      const slotSet = (lang: Lang) => [...new Set(PACKS[lang][key].flatMap((v) => slotsOf(v.lines)))].sort()
      expect(slotSet('en'), key).toEqual(slotSet('es'))
    }
  })

  it('has several variants where lines repeat most (so no-repeat has room), in two moods at least', () => {
    for (const lang of LANGS) {
      for (const key of ['POST_ASK', 'HOLD', 'TAKE', 'DENIED_BUYER', 'DEAL', 'QUIET', 'DOORS_CLOSED'] as const) {
        const bank = PACKS[lang][key]
        expect(bank.length, `${lang}.${key}`).toBeGreaterThanOrEqual(3)
        expect(new Set(bank.map((v) => v.mood)).size, `${lang}.${key}`).toBeGreaterThanOrEqual(2)
      }
      expect(PACKS[lang].QUIET.length).toBeGreaterThanOrEqual(8)
      const moods = new Set(Object.values(PACKS[lang]).flatMap((b) => b.map((v) => v.mood)))
      expect([...moods].sort()).toEqual([...MOODS].sort())
    }
  })
})

describe('language consistency: one language per line', () => {
  it('the detectors catch the mixed lines the show used to have', () => {
    expect(words('¡Oiga, oiga! {card}, fresh from the stall, {price}!')).toMatch(ENGLISH_ONLY)
    expect(words('Card up: {card} for {price}. Que lo vendo, ¿eh?')).toMatch(SPANISH_ONLY)
    expect(words("¡Buenos días, {dealerName}! I'm after {item}.")).toMatch(ENGLISH_ONLY)
  })

  it('no Spanish line carries English words, no English line carries Spanish ones', () => {
    for (const text of rawLines('es')) expect(words(text), `es: ${text}`).not.toMatch(ENGLISH_ONLY)
    for (const text of rawLines('en')) expect(words(text), `en: ${text}`).not.toMatch(SPANISH_ONLY)
  })

  it('stays consistent once the slots are filled with the words of the same language', () => {
    for (const lang of LANGS) {
      const values = sample(lang)
      for (const bank of Object.values(PACKS[lang])) {
        for (const variant of bank) {
          for (const [, text] of variant.lines) {
            const filled = fill(text, values).replace(/\[[a-z ]+\]/gi, ' ')
            // Proper nouns (hoods, dealers) are the same in both; strip them before looking for foreign words.
            const plain = filled.replace(/Abuela Carmen|El Chato|El Retiro|La Latina|Lavapiés|Malasaña|Salamanca|Chamberí|primas?|Rastro|Retiro|Latina|churros?|Jev/g, ' ')
            if (lang === 'es') expect(plain, `es: ${filled}`).not.toMatch(ENGLISH_ONLY)
            else expect(plain.replace(/\bEl\b/g, ' '), `en: ${filled}`).not.toMatch(SPANISH_ONLY)
          }
        }
      }
    }
  })

  it('every filled line is accepted by the proxy in its own language and refused in the other', () => {
    const SHARED_ONLY = /^(?:[^\p{L}]*)$/u
    for (const lang of LANGS) {
      const other: Lang = lang === 'es' ? 'en' : 'es'
      for (const bank of Object.values(PACKS[lang])) {
        for (const variant of bank) {
          for (const [role, text] of variant.lines) {
            const speaker = role === 'dealer' ? 'abuela' : role
            const filled = fill(text, sample(lang))
            expect(isShowLine(speaker, filled, lang), `${lang}: ${filled}`).toBe(true)
            // A line is one language's: unless it has no words at all, the other language refuses it.
            if (!SHARED_ONLY.test(filled)) expect(isShowLine(speaker, filled, other), `${other} must refuse: ${filled}`).toBe(false)
          }
        }
      }
    }
  })
})

describe('tags', () => {
  it('uses only tags the voices understand, never inside a word, and never an angle tag', () => {
    for (const lang of LANGS) {
      for (const text of rawLines(lang)) {
        for (const tag of tagsOf(text)) expect(KNOWN_TAGS, `${lang}: ${text}`).toContain(tag)
        expect(text).not.toMatch(/[<>]/)
        expect(text.replace(/\[[a-z ]+\]/gi, '')).not.toMatch(/[[\]]/)
      }
    }
  })

  it('keeps lines short enough to say (and to caption) in a breath or two', () => {
    for (const lang of LANGS) for (const text of rawLines(lang)) expect(text.length, text).toBeLessThan(120)
  })
})

describe('slots and vocab', () => {
  it('skips a template when a slot has no value', () => {
    const bank = PACKS.es.POST_ASK
    const none = bank.filter((v) => usable(v.lines, NO_VALUES))
    expect(none).toEqual([])
    expect(bank.filter((v) => usable(v.lines, { ...NO_VALUES, card: 'esta carta', price: '30 primas' })).length).toBe(bank.length)
  })

  it('writes countdowns in minutes under two hours, then whole hours, and refuses nonsense', () => {
    expect(etaWords(1, 'es')).toBeNull() // under two minutes there is no countdown to speak of
    expect(etaWords(2, 'es')).toBe('2 minutos')
    expect(etaWords(45, 'es')).toBe('45 minutos')
    expect(etaWords(95, 'en')).toBe('95 minutes')
    expect(etaWords(150, 'es')).toBe('2 horas')
    expect(etaWords(125, 'en')).toBe('2 hours')
    expect(etaWords(0, 'es')).toBeNull()
    expect(etaWords(Number.NaN, 'es')).toBeNull()
    expect(etaWords(100 * 60, 'es')).toBeNull()
  })

  it('writes the opening as today, tomorrow or a weekday, in the language', () => {
    expect(opensWords(0, 6, 9, 0, 'es')).toBe('hoy a las 9:00')
    expect(opensWords(1, 0, 9, 5, 'es')).toBe('mañana a las 9:05')
    expect(opensWords(3, 6, 21, 30, 'es')).toBe('el sábado a las 21:30')
    expect(opensWords(1, 0, 1, 5, 'es')).toBe('mañana a la 1:05')
    expect(opensWords(0, 6, 9, 0, 'en')).toBe('today at 9:00')
    expect(opensWords(2, 1, 10, 0, 'en')).toBe('on Monday at 10:00')
    expect(opensWords(-1, 1, 10, 0, 'en')).toBeNull()
  })

  it('has patterns that match exactly the words the show produces', () => {
    for (const lang of LANGS) {
      const p = slotPatterns(lang)
      const values = sample(lang)
      for (const [slot, value] of Object.entries(values)) expect(new RegExp(`^${p[slot as keyof typeof p]}$`, 'u').test(value ?? ''), `${lang}.${slot}: ${value}`).toBe(true)
      expect(new RegExp(`^${p.eta}$`).test('9999 minutos')).toBe(false)
      expect(new RegExp(`^${p.hood}$`).test('Wall Street')).toBe(false)
    }
  })
})
