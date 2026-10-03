/**
 * Which language is a real quote in? A small deterministic detector for the two languages of the show.
 *
 * It counts words that are specific to one language (function words, a few interjections) and the
 * characters only Spanish uses (`ñ ¿ ¡`). It answers `unknown` unless one side clearly wins, because
 * the cost of a wrong answer is a Spanish sentence in an English voice (or the reverse), while the cost
 * of `unknown` is a line shown as text.
 *
 * Imported by the Node server and the browser bundle; it has no imports of its own beyond types.
 */
import type { Lang } from './lang.ts'

export type QuoteLang = Lang | 'unknown'

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean))

// Words that are (almost) only Spanish. Left out on purpose: no, me, a, un, son, he, ha, al, mi-like clashes.
const ES = words(`
  el la los las una unos unas del de que y en es por para con se su sus lo le les te mi tu nos pero como
  más mas muy ya sí está están esto esta este eso esa ese hay tengo tiene tienes quiero quieres vamos
  cuánto cuanto precio trato mucho poco nada todo tan también porque cuando donde así ni sin sobre
  hacer hago haces bueno buena buen eres soy somos ser estoy estás pues entonces ahora aquí allí
  dame doy dale puedo puedes quiere dejo dejas lleva llevo llévatelo barato caro cariño niño niña
  tío hombre mujer gracias hola adiós señor señora usted ustedes vosotros vuestro nuestro nuestra
  hagas haga perder tiempo oferta ofrece ofrezco algo mejor peor hable habla digo dice dices sé creo verdad justo justa
  sesenta cincuenta cuarenta treinta veinte diez cien mil euros
`)

// Interjections that mark a speaker as Spanish but are borrowed into English sentences: they count double.
const ES_STRONG = words('venga oye vale anda hombre ojalá olé caramba madre mía')

// Words that are (almost) only English. Left out on purpose: a, no, me, he, as, so, was, don't clashes.
const EN = words(`
  the an and of to in is are you your i my we it that this with for not be have has do does what how much
  more than one just nothing extra would could will can but or if at on by from they them his her our us
  price deal take offer again today want give pay get got see said think there here when where why who
  which their these those been being were am im i'm don't dont won't can't it's that's you're
  fine pigeons offers better cheap final number last leave cost mine yours
`)

const SPANISH_ONLY_CHARS = /[ñ¿¡]/gu
const ACCENTED = /[áéíóúü]/gu
const TOKEN = /[\p{L}']+/gu

/** The detector's confidence floor: at least this many points, and at least twice the other language. */
const MIN_POINTS = 3

export function detectLang(text: string): QuoteLang {
  const lower = text.normalize('NFC').toLowerCase()
  let es = (lower.match(SPANISH_ONLY_CHARS)?.length ?? 0) * 2 + (lower.match(ACCENTED)?.length ?? 0)
  let en = 0
  for (const token of lower.match(TOKEN) ?? []) {
    if (ES_STRONG.has(token)) es += 2
    else if (ES.has(token)) es += 1
    if (EN.has(token)) en += 1
  }
  if (es >= MIN_POINTS && es >= en * 2) return 'es'
  if (en >= MIN_POINTS && en >= es * 2) return 'en'
  return 'unknown'
}
