/**
 * The words of the Prices screen, in the page's language (kept apart from strings.ts: one screen, one file).
 * Facts and our own rules only: a "good deal" is the album's MIN_SURPLUS / MIN_SELL_SURPLUS line, never advice.
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'
import type { Need } from './views/market.ts'
import type { PriceFocus, Trend } from './views/prices.ts'
import type { Transport } from './wsSource.ts'

export interface PriceStrings {
  readonly title: string
  readonly sub: string
  /** "live over WebSocket · tick 1163" */
  readonly live: (transport: Transport | null, tick: number) => string
  readonly focusLabel: string
  readonly focus: Readonly<Record<PriceFocus, string>>
  readonly search: string
  readonly cols: {
    readonly card: string
    readonly standard: string
    readonly last: string
    readonly trend: string
    readonly bid: string
    readonly ask: string
    readonly spread: string
    readonly worth: string
    readonly deal: string
  }
  readonly basisBook: string
  readonly trend: Readonly<Record<Trend, string>>
  readonly noTrend: string
  readonly fills: (n: number) => string
  readonly depth: (n: number) => string
  readonly ours: (n: number) => string
  readonly feeIncluded: (cost: string) => string
  readonly need: Readonly<Record<Need, string>>
  readonly buyUpTo: (p: string) => string
  readonly sellFrom: (p: string) => string
  readonly signal: { readonly buy: string; readonly sell: string }
  readonly signalTitle: { readonly buy: string; readonly sell: string }
  readonly empty: string
  readonly emptyFocus: string
  readonly legend: string
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const EN: PriceStrings = {
  title: 'Price guide',
  sub: 'Every card the market or we care about: its standard price, where it is going, the best bid and ask on every venue, and what a good deal is for us.',
  live: (transport, tick) => `${transport === 'ws' ? 'live over WebSocket' : transport === 'sse' ? 'live (SSE fallback)' : 'connecting'} · tick ${tick}`,
  focusLabel: 'Which cards',
  focus: { all: 'All', ours: 'Ours', signals: 'Good deals now' },
  search: 'Card or code',
  cols: { card: 'Card', standard: 'Standard', last: 'Last fill', trend: 'Trend', bid: 'Best bid', ask: 'Best ask', spread: 'Spread', worth: 'To us', deal: 'A good deal for us' },
  basisBook: 'book price: no fill seen yet',
  trend: { up: 'rising', down: 'falling', flat: 'steady' },
  noTrend: 'too few fills',
  fills: (n) => plural(n, 'fill', 'fills'),
  depth: (n) => plural(n, 'offer', 'offers'),
  ours: (n) => plural(n, 'offer of ours', 'offers of ours'),
  feeIncluded: (cost) => `${cost} with the venue's fee`,
  need: { missing: 'we lack it', spare: 'spare', unneeded: 'no page of ours', held: 'single copy' },
  buyUpTo: (p) => `buy ≤ ${p}`,
  sellFrom: (p) => `sell ≥ ${p}`,
  signal: { buy: 'Buy now', sell: 'Sell now' },
  signalTitle: {
    buy: 'An ask on the board, with its venue fee, is at or under our buy line for a card we lack',
    sell: 'A bid on the board is at or over our sell line for a copy we hold',
  },
  empty: 'No fill and no offer seen yet.',
  emptyFocus: 'Nothing here right now.',
  legend: 'Standard: the median of the last 8 fills (dealers too), else the book price. Trend: the newest 3 fills against the 3 before (±5 % is steady). Good deal: buy at or under min(worth to us − 2, standard); sell at or over max(worth to us + 5, standard). A copy that completes a page is worth that page.',
}

const ES: PriceStrings = {
  title: 'Guía de precios',
  sub: 'Cada carta que mueve el mercado o nos importa: su precio estándar, hacia dónde va, la mejor puja y oferta de todos los mercados, y qué es buen trato para nosotros.',
  live: (transport, tick) => `${transport === 'ws' ? 'en vivo por WebSocket' : transport === 'sse' ? 'en vivo (respaldo SSE)' : 'conectando'} · turno ${tick}`,
  focusLabel: 'Qué cartas',
  focus: { all: 'Todas', ours: 'Las nuestras', signals: 'Buenos tratos ya' },
  search: 'Carta o código',
  cols: { card: 'Carta', standard: 'Estándar', last: 'Último cierre', trend: 'Tendencia', bid: 'Mejor puja', ask: 'Mejor oferta', spread: 'Diferencia', worth: 'Para nosotros', deal: 'Buen trato para nosotros' },
  basisBook: 'precio de catálogo: aún sin cierres',
  trend: { up: 'sube', down: 'baja', flat: 'estable' },
  noTrend: 'pocos cierres',
  fills: (n) => plural(n, 'cierre', 'cierres'),
  depth: (n) => plural(n, 'oferta', 'ofertas'),
  ours: (n) => plural(n, 'oferta nuestra', 'ofertas nuestras'),
  feeIncluded: (cost) => `${cost} con la comisión del mercado`,
  need: { missing: 'nos falta', spare: 'repetida', unneeded: 'sin página nuestra', held: 'copia única' },
  buyUpTo: (p) => `compra ≤ ${p}`,
  sellFrom: (p) => `vende ≥ ${p}`,
  signal: { buy: 'Comprar ya', sell: 'Vender ya' },
  signalTitle: {
    buy: 'Hay una oferta de venta que, con la comisión de su mercado, está en o por debajo de nuestra línea de compra, para una carta que nos falta',
    sell: 'Hay una puja en o por encima de nuestra línea de venta, para una copia que tenemos',
  },
  empty: 'Aún no hay cierres ni ofertas.',
  emptyFocus: 'Nada por aquí ahora mismo.',
  legend: 'Estándar: la mediana de los últimos 8 cierres (también de tratantes); si no hay, el precio de catálogo. Tendencia: los 3 cierres más recientes frente a los 3 anteriores (±5 % es estable). Buen trato: comprar en o por debajo de mín(valor para nosotros − 2, estándar); vender en o por encima de máx(valor para nosotros + 5, estándar). Una copia que completa una página vale esa página.',
}

export const PRICE_STRINGS: Readonly<Record<Lang, PriceStrings>> = { es: ES, en: EN }

export function usePriceStrings(): PriceStrings {
  return PRICE_STRINGS[useLang()]
}
