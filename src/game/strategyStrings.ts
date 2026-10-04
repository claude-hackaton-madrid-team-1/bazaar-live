/**
 * The words of the Strategy screen, in the page's language (kept apart from strings.ts: one screen, one file).
 * Facts only: what a rule did and what it would take, never advice to change an agent.
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'
import { percent } from './humanize.ts'
import type { StrategyStatus } from './strategy.ts'
import type { Binding, JevVeto, RuleCount, RuleId, SpareWhy, Unblock } from './views/strategy.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A number of primas, one decimal at most. */
export const p = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 10) / 10} P`)

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)}`

const aff = (a: number | null) => (a == null ? '' : ` ×${a}`)

export interface StrategyStrings {
  readonly notice: Readonly<Record<Exclude<StrategyStatus, 'live'>, string>>
  readonly missingView: string
  readonly rarity: (r: string | null) => string
  // 1. what we aim for
  readonly aim: string
  readonly aimSub: string
  readonly scoring: readonly string[]
  readonly inventory: string
  readonly target: (name: string, affinity: number | null, have: number, of: number) => string
  readonly lacks: (n: number) => string
  readonly complete: (names: string) => string
  /** `all`: every set's only copy is protected (protect_page_sets names them all): only true duplicates are sold. */
  readonly sell: (surplus: number, sets: string, protectedSets: string, all?: boolean) => string
  readonly venue: (v: string) => string
  readonly caps: string
  readonly docValue: (source: string) => string
  // 2. why we do not buy
  readonly why: string
  readonly whySub: (ticks: number) => string
  readonly headline: (b: Binding, cash: number | null, room: number | null, spent: number | null) => string
  /** `card` is the card's name, `when` the last refusal said as "3 min ago". */
  readonly latest: (card: string, price: number | null, value: number | null, count: number, when: string, onSale: boolean, cashNeeded: number | null) => string
  readonly unblock: (u: Unblock) => string
  readonly board: (total: number, wanted: number, missing: number, held: number, notChased: number, offAlbum: number) => string
  readonly boardMissing: (price: number, cap: number | null, room: number | null) => string
  readonly blocked: string
  readonly col: { readonly card: string; readonly price: string; readonly value: string; readonly gaveUp: string; readonly rule: string; readonly times: string; readonly last: string }
  readonly rule: (r: Pick<RuleCount, 'rule' | 'rarity' | 'limit' | 'text'>) => string
  readonly ruleTitle: Readonly<Record<RuleId, string>>
  readonly heldNow: string
  readonly onSaleNow: (price: number) => string
  readonly notOnSale: string
  readonly allRules: string
  readonly noBlocks: string
  readonly jev: (j: JevVeto) => string
  // 3. why we hold
  readonly hold: string
  readonly holdSub: (copies: number, album: number, onSale: number, notListed: number) => string
  readonly album: string
  readonly pageState: (complete: boolean, missing: number) => string
  readonly keptWhy: Readonly<Record<'boost' | 'protected', string>>
  readonly keptCards: (n: number) => string
  readonly pageValue: string
  readonly onSale: string
  readonly saleCol: { readonly card: string; readonly ask: string; readonly value: string; readonly other: string; readonly fill: string }
  readonly notListed: string
  readonly copies: (n: number) => string
  readonly spareWhy: (w: SpareWhy) => string
  readonly makerSaid: string
  readonly duels: (n: number) => string
  readonly duelsLink: string
  readonly nothingHeld: string
}

const RULES_EN: Readonly<Record<RuleId, string>> = {
  cash_floor: 'a buy never takes cash below this floor',
  max_spend_per_game_hour: 'what all our buys may spend in one game hour',
  max_price: 'never pay more for a card of this rarity',
  block_buying_held_cards: 'never buy a page card we already hold',
  jev: 'Jev was not sure enough (below its bar)',
  other: 'another guardrail',
  unrecorded: 'refused without a rule in the decision row (accept quota, inspector or Jev)',
}

const RARITY_EN: Readonly<Record<string, string>> = { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary', pack: 'pack' }
const RARITY_ES: Readonly<Record<string, string>> = { common: 'común', uncommon: 'poco común', rare: 'rara', epic: 'épica', legendary: 'legendaria', pack: 'sobre' }

/** A 0–1 confidence as "29 %". */
const pctOf = (v: number | null): string => (percent(v) == null ? '—' : `${percent(v)} %`)

const EN: StrategyStrings = {
  notice: {
    loading: 'Reading our strategy…',
    off: 'No database: set SHOW_DATABASE_URL on the server and apply db/strategy.sql to see why we hold and why we do not buy.',
    locked: 'This screen needs ?token= (GAME_VIEW_TOKEN): it shows our values and our caps.',
    error: 'The server did not answer: showing the last snapshot read.',
    mock: 'A made-up afternoon around the mock game. Remove ?mock=1 for our real strategy.',
  },
  missingView: 'not applied yet (db/strategy.sql)',
  rarity: (r) => (r ? (RARITY_EN[r] ?? r) : '—'),
  aim: 'What we aim for',
  aimSub: 'value created in negotiations and markets',
  scoring: [
    'Sales analyses market and rival intelligence to propose targeted offers coordinated with Maker.',
    'Team trades: buy below our private marginal value; sell inventory allowed by current guardrails above our your_value, preserving sole copies on protected complete pages. Account for the accepting side’s venue fees.',
    'Dealer ladder: negotiate toward the dealer’s final price. The best three deals per level count each round.',
    'Duels: capture our share of the pie before round decay. No cards or cash move; album rules do not apply.',
    'Market-making: Market Test matching efficiency and value other teams create on our venue.',
    'Holdings, completed pages, trade count, fee revenue and pack luck earn no points.',
  ],
  inventory: 'Inventory context: affinity and missing cards affect private values, not points for holding them',
  target: (name, a, have, of) => `${name}${aff(a)} · ${have}/${of}`,
  lacks: (n) => `lacks ${n}:`,
  complete: (names) => `${names} complete`,
  sell: (surplus) => `Sell inventory allowed by current guardrails, above our value + ${surplus} and the sell floor; keep protected copies`,
  venue: (v) => `Our own market: ${v}`,
  caps: 'Price caps',
  docValue: (source) => `not hit by any buy yet: from ${source}`,
  why: 'Why we do not buy',
  whySub: (ticks) => `last ${ticks} ticks`,
  headline: (b, cash, room, spent) => {
    switch (b.rule) {
      case 'cash_floor':
        return `Cash ${cash ?? '—'} · floor ${b.limit ?? '—'} · only ${room ?? '—'} available to buy`
      case 'max_spend_per_game_hour':
        return `Spent ${spent ?? '—'} / ${b.limit ?? '—'} this hour · only ${room ?? '—'} left to buy`
      case 'max_price':
        return `${RARITY_EN[b.rarity ?? ''] ?? b.rarity ?? ''} cap ${b.limit ?? '—'}: the cards we want cost more`
      case 'block_buying_held_cards':
        return 'What is offered we already hold'
      case 'jev':
        return 'Jev says no'
      case 'other':
        return `Guardrail: ${b.text ?? '—'}`
      case 'unrecorded':
        return 'Refused without a rule in the decision row'
      case 'cleared':
        return `Cash ${cash ?? '—'}: no rule stops a buy now`
      case 'none':
        return 'Nothing refused: no card we need is on sale at a price we would pay'
    }
  },
  latest: (card, price, value, count, when, onSale, cashNeeded) =>
    `${card} asked from ${p(price)}, worth ${p(value)} to us${price != null && value != null ? ` (${signed(value - price)})` : ''}: refused ×${count}, last ${when}${cashNeeded != null ? ` · fits with cash ${cashNeeded}` : ''}${onSale ? '' : ' · no longer on sale'}`,
  unblock: (u) => {
    const what = `${plural(u.cards, 'buy', 'buys')} worth ${signed(u.surplus)} surplus blocked by ${u.rule === 'max_price' ? `max_price_${u.rarity ?? '?'}` : u.rule} ${u.limit ?? ''}`.trim()
    return u.rule === 'cash_floor' && u.cheapest && u.cashNeeded != null ? `${what}; ${u.cheapest.card} at ${p(u.cheapest.price)} fits with cash ${u.cashNeeded}` : what
  },
  board: (total, wanted, missing, held, notChased, off) =>
    [`On sale now: ${total}`, missing ? `${missing} of the ${wanted} we lack` : `none of the ${wanted} we lack`, `${held} we already hold`, notChased ? `${notChased} of sets we do not chase` : '', off ? `${off} outside the album` : '']
      .filter(Boolean)
      .join(' · '),
  boardMissing: (price, cap, room) => `${p(price)}${cap != null && price > cap ? ` > cap ${cap}` : ''}${room != null && price > room ? ` > ${room} we can spend` : ''}`,
  blocked: 'Refused buys, by the surplus given up',
  col: { card: 'Card', price: 'Price', value: 'Worth to us', gaveUp: 'Gave up', rule: 'Rule', times: '×', last: 'Last' },
  rule: (r) => (r.rule === 'max_price' ? `max_price_${r.rarity ?? '?'} ${r.limit ?? ''}` : r.rule === 'other' ? (r.text ?? 'other') : r.rule === 'jev' ? 'Jev' : r.rule === 'unrecorded' ? 'no rule logged' : `${r.rule}${r.limit != null ? ` ${r.limit}` : ''}`).trim(),
  ruleTitle: RULES_EN,
  heldNow: 'we hold it now',
  onSaleNow: (price) => `on sale now at ${p(price)}`,
  notOnSale: 'not on sale now',
  allRules: 'every rule',
  noBlocks: 'No buy refused in the window.',
  jev: (j) => `Jev refused ${plural(j.count, 'swap', 'swaps')} (confidence ${pctOf(j.value)} under the ${pctOf(j.bar)} it needs)${j.give && j.want ? `, the last one ${j.give} for ${j.want}` : ''}`,
  hold: 'Why we hold',
  holdSub: (copies, album, onSale, notListed) => `${copies} cards · ${album} for the album · ${onSale} on sale · ${notListed} spare, not listed`,
  album: 'Kept for the album',
  pageState: (complete, missing) => (complete ? 'complete' : `lacks ${missing}`),
  keptWhy: { boost: 'page bonus', protected: 'only copy never sold' },
  keptCards: (n) => plural(n, 'card', 'cards'),
  pageValue: 'what the cards we keep for this page are worth to us',
  onSale: 'Spares on sale',
  saleCol: { card: 'Card', ask: 'Our ask', value: 'Worth to us', other: 'Elsewhere', fill: 'Last fill' },
  notListed: 'Spares not on sale',
  copies: (n) => `×${n}`,
  spareWhy: (w) => {
    switch (w.kind) {
      case 'two_copies':
        return 'two copies: the swap desk keeps them, neither is listed'
      case 'other_copy_on_sale':
        return 'another copy is on sale'
      case 'maker':
        return `maker t${w.tick}: ${w.reason}`
      case 'no_ask':
        return 'no ask from the maker yet'
    }
  },
  makerSaid: 'the maker',
  duels: (n) => `${plural(n, 'duel', 'duels')} on hold: nothing inside our limit yet`,
  duelsLink: 'Duels →',
  nothingHeld: 'No cards in our latest snapshot.',
}

const RULES_ES: Readonly<Record<RuleId, string>> = {
  cash_floor: 'ninguna compra deja la caja por debajo de este suelo',
  max_spend_per_game_hour: 'lo que pueden gastar todas nuestras compras en una hora de juego',
  max_price: 'nunca pagar más por una carta de esta rareza',
  block_buying_held_cards: 'nunca comprar una carta de página que ya tenemos',
  jev: 'Jev no estaba lo bastante seguro (bajo su listón)',
  other: 'otra regla',
  unrecorded: 'rechazada sin regla anotada en la decisión (cupo de aceptaciones, inspector o Jev)',
}

const ES: StrategyStrings = {
  notice: {
    loading: 'Leyendo nuestra estrategia…',
    off: 'Sin base de datos: pon SHOW_DATABASE_URL en el servidor y aplica db/strategy.sql para ver por qué guardamos y por qué no compramos.',
    locked: 'Esta pantalla necesita ?token= (GAME_VIEW_TOKEN): muestra nuestros valores y nuestros topes.',
    error: 'El servidor no respondió: se muestra la última lectura.',
    mock: 'Una tarde inventada alrededor de la partida falsa. Quita ?mock=1 para ver nuestra estrategia real.',
  },
  missingView: 'aún sin aplicar (db/strategy.sql)',
  rarity: (r) => (r ? (RARITY_ES[r] ?? r) : '—'),
  aim: 'Qué buscamos',
  aimSub: 'valor creado al negociar y hacer mercado',
  scoring: [
    'Ventas analiza el mercado y el conocimiento de los rivales para proponer ofertas dirigidas, coordinadas con Maker.',
    'Tratos con equipos: comprar por debajo de nuestro valor marginal privado; vender inventario permitido por las reglas vigentes por encima de nuestro your_value, conservando las únicas copias de páginas completas protegidas. Contar las comisiones de quien acepta.',
    'Escalera de tratantes: negociar hacia su precio final. Cuentan los tres mejores tratos por nivel en cada ronda.',
    'Duelos: capturar nuestra parte del beneficio antes de que decaiga por ronda. No mueven cartas ni dinero; las reglas del álbum no se aplican.',
    'Mercado: eficiencia al cruzar ofertas del Market Test y valor creado entre otros equipos en nuestro mercado.',
    'Tener cartas, completar páginas, contar tratos, cobrar comisiones y la suerte de los sobres no dan puntos.',
  ],
  inventory: 'Contexto del inventario: afinidad y cartas pendientes afectan al valor privado, no dan puntos por tenerlas',
  target: (name, a, have, of) => `${name}${aff(a)} · ${have}/${of}`,
  lacks: (n) => `faltan ${n}:`,
  complete: (names) => `${names} completa`,
  sell: (surplus) => `Vender inventario permitido por las reglas vigentes, por encima de nuestro valor + ${surplus} y del suelo de venta; conservar las copias protegidas`,
  venue: (v) => `Mercado propio: ${v}`,
  caps: 'Topes de precio',
  docValue: (source) => `ninguna compra lo ha tocado aún: de ${source}`,
  why: 'Por qué no compramos',
  whySub: (ticks) => `últimos ${ticks} turnos`,
  headline: (b, cash, room, spent) => {
    switch (b.rule) {
      case 'cash_floor':
        return `Caja ${cash ?? '—'} · suelo ${b.limit ?? '—'} · solo ${room ?? '—'} disponibles para comprar`
      case 'max_spend_per_game_hour':
        return `Gastado ${spent ?? '—'} / ${b.limit ?? '—'} esta hora · solo quedan ${room ?? '—'} para comprar`
      case 'max_price':
        return `Tope ${RARITY_ES[b.rarity ?? ''] ?? b.rarity ?? ''} ${b.limit ?? '—'}: lo que queremos cuesta más`
      case 'block_buying_held_cards':
        return 'Lo que se vende ya lo tenemos'
      case 'jev':
        return 'Jev dice que no'
      case 'other':
        return `Regla: ${b.text ?? '—'}`
      case 'unrecorded':
        return 'Rechazadas sin regla anotada en la decisión'
      case 'cleared':
        return `Caja ${cash ?? '—'}: ninguna regla frena una compra ahora`
      case 'none':
        return 'Nada rechazado: no se vende ninguna carta que necesitemos a un precio que pagaríamos'
    }
  },
  latest: (card, price, value, count, when, onSale, cashNeeded) =>
    `${card} pedía desde ${p(price)}, nos vale ${p(value)}${price != null && value != null ? ` (${signed(value - price)})` : ''}: rechazada ×${count}, la última ${when}${cashNeeded != null ? ` · cabría con caja ${cashNeeded}` : ''}${onSale ? '' : ' · ya no está a la venta'}`,
  unblock: (u) => {
    const what = `${plural(u.cards, 'compra', 'compras')} con ${signed(u.surplus)} de excedente bloqueadas por ${u.rule === 'max_price' ? `max_price_${u.rarity ?? '?'}` : u.rule} ${u.limit ?? ''}`.trim()
    return u.rule === 'cash_floor' && u.cheapest && u.cashNeeded != null ? `${what}; ${u.cheapest.card} a ${p(u.cheapest.price)} cabe con caja ${u.cashNeeded}` : what
  },
  board: (total, wanted, missing, held, notChased, off) =>
    [`A la venta ahora: ${total}`, missing ? `${missing} de las ${wanted} que nos faltan` : `ninguna de las ${wanted} que nos faltan`, `${held} ya las tenemos`, notChased ? `${notChased} de barrios que no buscamos` : '', off ? `${off} fuera del álbum` : '']
      .filter(Boolean)
      .join(' · '),
  boardMissing: (price, cap, room) => `${p(price)}${cap != null && price > cap ? ` > tope ${cap}` : ''}${room != null && price > room ? ` > ${room} disponibles` : ''}`,
  blocked: 'Compras rechazadas, por el excedente perdido',
  col: { card: 'Carta', price: 'Precio', value: 'Nos vale', gaveUp: 'Perdido', rule: 'Regla', times: '×', last: 'Último' },
  rule: (r) => (r.rule === 'max_price' ? `max_price_${r.rarity ?? '?'} ${r.limit ?? ''}` : r.rule === 'other' ? (r.text ?? 'otra') : r.rule === 'jev' ? 'Jev' : r.rule === 'unrecorded' ? 'sin regla anotada' : `${r.rule}${r.limit != null ? ` ${r.limit}` : ''}`).trim(),
  ruleTitle: RULES_ES,
  heldNow: 'ya la tenemos',
  onSaleNow: (price) => `a la venta ahora a ${p(price)}`,
  notOnSale: 'ya no está a la venta',
  allRules: 'todas las reglas',
  noBlocks: 'Ninguna compra rechazada en la ventana.',
  jev: (j) => `Jev rechazó ${plural(j.count, 'intercambio', 'intercambios')} (confianza ${pctOf(j.value)}, necesita ${pctOf(j.bar)})${j.give && j.want ? `, el último ${j.give} por ${j.want}` : ''}`,
  hold: 'Por qué guardamos',
  holdSub: (copies, album, onSale, notListed) => `${copies} cartas · ${album} para el álbum · ${onSale} en venta · ${notListed} sobrantes sin anunciar`,
  album: 'Guardadas para el álbum',
  pageState: (complete, missing) => (complete ? 'completa' : `faltan ${missing}`),
  keptWhy: { boost: 'bonus de página', protected: 'su única copia no se vende' },
  keptCards: (n) => plural(n, 'carta', 'cartas'),
  pageValue: 'lo que nos valen las cartas que guardamos para esta página',
  onSale: 'Sobrantes en venta',
  saleCol: { card: 'Carta', ask: 'Pedimos', value: 'Nos vale', other: 'Fuera', fill: 'Cierre' },
  notListed: 'Sobrantes sin anunciar',
  copies: (n) => `×${n}`,
  spareWhy: (w) => {
    switch (w.kind) {
      case 'two_copies':
        return 'dos copias: las guarda la mesa de intercambios, no se anuncia ninguna'
      case 'other_copy_on_sale':
        return 'otra copia ya está en venta'
      case 'maker':
        return `maker t${w.tick}: ${w.reason}`
      case 'no_ask':
        return 'el maker aún no la ha anunciado'
    }
  },
  makerSaid: 'el maker',
  duels: (n) => `${plural(n, 'duelo', 'duelos')} en espera: nada dentro de nuestro límite todavía`,
  duelsLink: 'Duelos →',
  nothingHeld: 'Ninguna carta en nuestra última foto.',
}

export const STRATEGY_STRINGS: Readonly<Record<Lang, StrategyStrings>> = { es: ES, en: EN }

export function useStrategyStrings(): StrategyStrings {
  return STRATEGY_STRINGS[useLang()]
}
