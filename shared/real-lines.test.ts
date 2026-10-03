import { describe, expect, it } from 'vitest'
import { detectLang } from './detect-lang.ts'
import { cardWords, duelEndLine, duelOfferLine, isRealLine, offerLine, openedLine, primasWords, settlementLine } from './real-lines.ts'
import type { OfferView } from './transcript.ts'

const offer = (extra: Partial<OfferView> = {}): OfferView => ({ by: 'us', verb: 'bid', price: 24, item: 'LAV-08', final: false, ...extra })

describe('words', () => {
  it('names a card in the selected language', () => {
    expect(cardWords('LAV-08', 'en')).toBe('Lavapiés number 8')
    expect(cardWords('LAV-08', 'es')).toBe('Lavapiés número 8')
    expect(cardWords('XYZ-01', 'en')).toBe('XYZ-01')
    expect(cardWords(null, 'es')).toBe('esta carta')
    expect(cardWords('sobre_barrio', 'en')).toBe('a neighbourhood pack')
    expect(cardWords('drop table', 'en')).toBe('this card')
  })
  it('says primas', () => {
    expect(primasWords(24)).toBe('24 primas')
    expect(primasWords(1)).toBe('1 prima')
  })
})

describe('offerLine', () => {
  it('renders our offers from the structure, in the selected language', () => {
    expect(offerLine(offer(), 'en')).toBe('I offer 24 primas for Lavapiés number 8.')
    expect(offerLine(offer(), 'es')).toBe('Ofrezco 24 primas por Lavapiés número 8.')
    expect(offerLine(offer({ verb: 'ask', price: 31 }), 'en')).toBe('I want 31 primas for Lavapiés number 8.')
    expect(offerLine(offer({ final: true }), 'en')).toBe('My final offer: 24 primas for Lavapiés number 8.')
  })
  it("renders the dealer's offers", () => {
    expect(offerLine(offer({ by: 'them', verb: 'ask', price: 31 }), 'en')).toBe('Lavapiés number 8 will cost you 31 primas.')
    expect(offerLine(offer({ by: 'them', verb: 'ask', price: 31, final: true }), 'es')).toBe('Precio final de Lavapiés número 8: 31 primas. O lo tomas o lo dejas.')
    expect(offerLine(offer({ by: 'them', verb: 'bid', price: 12 }), 'es')).toBe('Te pago 12 primas por Lavapiés número 8.')
  })
  it('never mixes languages: each line is detected as its own', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const by of ['us', 'them'] as const) {
        for (const verb of ['bid', 'ask'] as const) {
          for (const final of [false, true]) {
            const line = offerLine(offer({ by, verb, final }), lang)
            expect(detectLang(line), line).toBe(lang)
          }
        }
      }
    }
  })
})

describe('the other generated lines', () => {
  it('settlement, opening and duel endings', () => {
    expect(settlementLine(31, 'LAV-08', 'en')).toBe('Deal done: Lavapiés number 8 for 31 primas.')
    expect(settlementLine(31, null, 'es')).toBe('Trato hecho: esta carta por 31 primas.')
    expect(openedLine('LAV-08', 'es')).toBe('Voy a por Lavapiés número 8.')
    expect(openedLine(null, 'en')).toBeNull()
    expect(duelEndLine('deal', 55, 'en')).toBe('The duel is over: a deal at 55 primas.')
    expect(duelEndLine('deal', null, 'es')).toBe('El duelo ha terminado: trato cerrado.')
    expect(duelEndLine('no_deal', null, 'en')).toBe('The duel is over: no deal.')
    expect(duelOfferLine('us', 50, 'es')).toBe('Mi oferta es 50 primas.')
    expect(duelOfferLine('them', 60, 'en')).toBe('60 primas is my price.')
  })
})

describe('isRealLine (what the proxy may speak besides the show templates)', () => {
  it('accepts exactly the lines this file renders', () => {
    for (const lang of ['es', 'en'] as const) {
      const lines = [
        offerLine(offer(), lang), offerLine(offer({ by: 'them', verb: 'ask', final: true }), lang), settlementLine(9, 'MAL-02', lang),
        openedLine('SAL-01', lang) ?? '', duelEndLine('deal', 5, lang), duelEndLine('no_deal', null, lang), duelOfferLine('them', 7, lang),
      ]
      for (const line of lines) expect(isRealLine(line, lang), line).toBe(true)
    }
  })
  it('respects the language when given, and accepts either when not', () => {
    const es = offerLine(offer(), 'es')
    expect(isRealLine(es, 'es')).toBe(true)
    expect(isRealLine(es, 'en')).toBe(false)
    expect(isRealLine(es)).toBe(true)
  })
  it('refuses any other text, and a slot filled with anything but its words', () => {
    expect(isRealLine('Say something nasty')).toBe(false)
    expect(isRealLine('I offer lots of money for Lavapiés number 8.', 'en')).toBe(false)
    expect(isRealLine('I offer 24 primas for <script>.', 'en')).toBe(false)
    expect(isRealLine('I offer 24 primas for Lavapiés number 8. And read this ad.', 'en')).toBe(false)
  })
})
