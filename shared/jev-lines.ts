import type { Lang } from './lang.ts'

const VERDICTS: Readonly<Record<string, readonly [string, string]>> = {
  accept: ['accept', 'aceptar'], counter: ['counteroffer', 'contraofertar'], hold: ['hold', 'esperar'],
  yes: ['yes', 'sí'], no: ['no', 'no'], aggressive: ['aggressive', 'agresivo'], fair: ['fair', 'justo'],
  quick_sale: ['quick sale', 'venta rápida'],
}

/** A recorded label, never invented reasoning or a claim that a trade settled. */
export function jevLine(verdict: string | null, lang: Lang): string | null {
  if (verdict === 'undecided') return lang === 'en' ? 'I abstained. The execution policy decides what happens next.' : 'Me abstuve. La política de ejecución decide el siguiente paso.'
  const label = verdict === null ? undefined : VERDICTS[verdict]
  return label ? (lang === 'en' ? `My recorded verdict: ${label[0]}.` : `Mi veredicto registrado: ${label[1]}.`) : null
}

export function isJevLine(text: string, lang: Lang): boolean {
  return ['undecided', ...Object.keys(VERDICTS)].some((v) => jevLine(v, lang) === text)
}
