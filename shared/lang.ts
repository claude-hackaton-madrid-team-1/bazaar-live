/**
 * The show speaks one language per line: castellano by default (with a Madrid flavour), or English
 * with `?lang=en`. Lines are never mixed, and the TTS proxy knows which language each line is in.
 *
 * Imported by the browser bundle and by the Node proxy, so it has no imports of its own.
 */

export const LANGS = ['es', 'en'] as const
export type Lang = (typeof LANGS)[number]
export const DEFAULT_LANG: Lang = 'es'

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

/** `es`, `es-ES`, `EN-gb`... as a supported language; anything else is the default (castellano). */
export function parseLang(value: string | null | undefined): Lang {
  const short = (value ?? '').trim().toLowerCase().slice(0, 2)
  return isLang(short) ? short : DEFAULT_LANG
}

/** The BCP 47 tag Web Speech and the paid voices use for each language. */
export const LANG_TAG: Readonly<Record<Lang, string>> = { es: 'es-ES', en: 'en-GB' }
