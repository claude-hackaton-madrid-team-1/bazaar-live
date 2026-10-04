export const SETS: Record<string, { name: string; color: string }> = {
  LAV: { name: 'Lavapiés', color: '#E4572E' },
  MAL: { name: 'Malasaña', color: '#9D4EDD' },
  LAT: { name: 'La Latina', color: '#F4A259' },
  SAL: { name: 'Salamanca', color: '#2E86AB' },
  RET: { name: 'El Retiro', color: '#3BB273' },
  CHA: { name: 'Chamberí', color: '#C1666B' },
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9AA4B8', uncommon: '#3DDC97', rare: '#4C8DFF', epic: '#B061FF', legendary: '#FFC44D',
}

export const SLOT_RARITY: Rarity[] = [
  ...Array<Rarity>(5).fill('common'), ...Array<Rarity>(3).fill('uncommon'), 'rare', 'rare', 'epic', 'legendary',
]

export const BOOK = [10, 10, 10, 10, 10, 25, 25, 25, 70, 70, 180, 450]

export const LOG_ICON: Record<string, string> = {
  thought: '·', say: '↗', accept: '✔', walk: '✖', open: '+', list: '≡', flag: '⚑',
}

const SUSPICIOUS = /ignore (all |any )?previous|system:|instructions|transfer \d+/i

export const isSuspicious = (text: string | null | undefined): boolean => Boolean(text && SUSPICIOUS.test(text))

export const slotOf = (ref: string): number | null => {
  const n = Number(String(ref).split('-')[1])
  return Number.isFinite(n) ? n - 1 : null
}

export const setOf = (ref: string) => SETS[String(ref).split('-')[0] ?? ''] ?? null

export const rarityOf = (ref: string): Rarity | null => {
  const slot = slotOf(ref)
  return slot == null ? null : SLOT_RARITY[slot] ?? null
}

export const bookOf = (ref: string): number | null => {
  const slot = slotOf(ref)
  return slot == null ? null : BOOK[slot] ?? null
}

const round1 = (v: number) => Math.round(v * 10) / 10

export const fmtP = (v: number | null | undefined): string => (v == null ? '—' : `${round1(v)} P`)

export const signed = (v: number | null | undefined): string =>
  v == null ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(round1(v))} P`

/** A thread's topic in a few words: `{buy: {pack}}`, `{buy: {card}}`, `{buy: {rarity, set}}` or `{sell: {assets}}`. */
export function topicText(topic: unknown): string {
  if (!topic || typeof topic !== 'object') return ''
  const { buy, sell } = topic as { buy?: Record<string, unknown>; sell?: { assets?: unknown } }
  if (buy && typeof buy === 'object') {
    const what = buy.pack ?? buy.card ?? [buy.rarity, buy.set].filter(Boolean).join(' ')
    return `buy ${String(what || '?')}`
  }
  if (sell && typeof sell === 'object') {
    const ids = Array.isArray(sell.assets) ? sell.assets.map((id) => `#${String(id)}`) : []
    return `sell ${ids.join(', ') || '?'}`
  }
  const json = JSON.stringify(topic)
  return json.length > 60 ? `${json.slice(0, 59)}…` : json
}
