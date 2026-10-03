/** Each neighbourhood's colour: the line along the top of an offer card. */
const HOOD_COLORS: Readonly<Record<string, string>> = {
  LAV: '#e76f51',
  MAL: '#9b5de5',
  LAT: '#f4a261',
  SAL: '#2a9d8f',
  RET: '#52b788',
  CHA: '#457b9d',
}

/** The set a card belongs to: the first three letters of its ref (`LAV-04` is Lavapiés). */
export function setOf(ref: string): string {
  return ref.slice(0, 3).toUpperCase()
}

export function hoodColor(ref: string): string {
  return HOOD_COLORS[setOf(ref)] ?? 'var(--text-3)'
}
