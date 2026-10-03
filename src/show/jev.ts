/** Families of Jev verdicts: the meter lights the option Jev picked among its siblings. */
const FAMILIES: readonly (readonly string[])[] = [
  ['quick_sale', 'fair', 'aggressive'],
  ['hold', 'reprice'],
  ['no', 'yes'],
  ['reject', 'accept'],
  ['walk', 'bid', 'accept'],
]

export function verdictFamily(verdict: string): readonly string[] {
  const v = verdict.toLowerCase()
  return FAMILIES.find((f) => f.includes(v)) ?? [v]
}
