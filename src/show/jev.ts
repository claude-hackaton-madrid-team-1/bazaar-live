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

/** The colour Jev's orb glows for a verdict: green for a yes, red for a no, gold for a quick sale... */
export function verdictHue(verdict: string): string {
  switch (verdict.toLowerCase()) {
    case 'yes':
    case 'accept':
    case 'fair':
    case 'bid':
      return '#4ee0a0'
    case 'no':
    case 'reject':
    case 'walk':
      return '#ff5d6c'
    case 'aggressive':
      return '#ff9a3d'
    case 'quick_sale':
      return '#ffd84d'
    case 'hold':
      return '#6fb4ff'
    case 'reprice':
      return '#b98cff'
    default:
      return '#cfc7e6'
  }
}
