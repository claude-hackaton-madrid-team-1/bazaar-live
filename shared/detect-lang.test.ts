import { describe, expect, it } from 'vitest'
import { detectLang } from './detect-lang.ts'

describe('detectLang', () => {
  it.each([
    "Your abuela would've moved more than one. 31 P. I match what you move, nothing extra.",
    'I offer 24 primas for this card, and that is my final price.',
    'You again. What do you want? Pigeons offer more.',
    'Not today. The price is the price.',
  ])('English: %s', (text) => expect(detectLang(text)).toBe('en'))

  it.each([
    'Venga, mi niño. Te lo dejo en 31 primas, ni una menos.',
    '¡Qué barbaridad! Eso es muy poco para una carta así.',
    'No me hagas perder el tiempo, ofrece algo mejor.',
    'Sesenta y no se hable más.',
    'Pues yo creo que el precio es justo, la verdad.',
  ])('Spanish: %s', (text) => expect(detectLang(text)).toBe('es'))

  it('treats a Spanish interjection inside an English sentence as English', () => {
    expect(detectLang('Venga, I will give you what you asked for the card.')).toBe('en')
  })

  it.each(['', '   ', '31', 'LAV-08', 'ok', 'Venga', '¿?', 'P'])('says unknown when there is not enough to judge: %j', (text) => {
    expect(detectLang(text)).toBe('unknown')
  })

  it('says unknown for a balanced mix rather than guess', () => {
    expect(detectLang('Venga mi niño, I match what you move and you pay the price')).toBe('unknown')
  })

  it('is deterministic', () => {
    const t = 'Eso es muy poco para una carta así.'
    expect([1, 2, 3].map(() => detectLang(t))).toEqual(['es', 'es', 'es'])
  })
})
