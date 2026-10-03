/**
 * The words of the Approvals screen, in the page's language (one screen, one file, like strategyStrings.ts).
 * Never the server's or bazaar-mcp's own error words: only which kind of failure it was.
 */
import type { Lang } from '../../shared/lang.ts'
import type { AlbumImpact, PendingState, Side } from '../../shared/approvals.ts'
import { useLang } from '../ui/lang'
import type { PriceError, WriteError } from './approvals.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)}`
/** Primas, one decimal at most. */
export const p = (v: number | null): string => (v == null ? '—' : `${Math.round(v * 10) / 10} P`)

export interface ApprovalsStrings {
  readonly title: string
  readonly sub: (threshold: number) => string
  readonly tick: (tick: number) => string
  // the lock
  readonly loginTitle: string
  readonly loginSub: string
  readonly password: string
  readonly unlock: string
  readonly unlocking: string
  readonly wrong: string
  readonly locked: (minutes: number) => string
  readonly loginError: string
  readonly lock: string
  readonly checking: string
  // what came back
  readonly unavailable: string
  readonly skipped: (n: number) => string
  readonly notes: string
  // requests
  readonly pending: string
  readonly pendingSub: (waiting: number, total: number) => string
  readonly noPending: string
  readonly side: Readonly<Record<Side, string>>
  readonly state: Readonly<Record<PendingState, string>>
  readonly asks: (side: Side, price: number) => string
  readonly whyLabel: string
  readonly scoreImpact: (v: number) => string
  readonly values: string
  readonly ourValue: string
  readonly officialValue: string
  readonly album: (a: AlbumImpact) => string
  readonly lastCopy: string
  readonly lastCopyTitle: string
  readonly albumLabel: string
  readonly askedLabel: string
  readonly capLabel: string
  readonly askedBy: (kind: string | null, counterparty: string | null) => string
  readonly askedAt: (asked: number | null) => string
  readonly staleIn: (staleAfter: number, left: number) => string
  readonly staleSince: (staleAfter: number) => string
  readonly cap: (max: number, rule: string) => string
  // the form
  readonly priceLabel: (side: Side) => string
  readonly ttlLabel: string
  readonly reasonLabel: string
  readonly approve: string
  readonly confirm: (card: string, side: Side, price: number) => string
  /** What an approval covers, said before the confirm click. */
  readonly scope: (card: string, side: Side, ttl: number) => string
  readonly aboveOfficial: (official: number) => string
  readonly belowOurs: (ours: number) => string
  readonly cancel: string
  readonly deny: string
  readonly sending: string
  readonly priceError: (e: PriceError, min: number, max: number, rule: string | null) => string
  readonly ttlError: (min: number, max: number) => string
  readonly reasonError: (max: number) => string
  // answers
  readonly approved: (card: string, side: Side, price: number | null, until: number | null) => string
  readonly refused: string
  readonly revoked: (card: string, side: Side) => string
  readonly denied: (card: string, side: Side) => string
  readonly error: Readonly<Record<WriteError, string>>
  // active approvals
  readonly active: string
  readonly activeSub: (n: number) => string
  readonly noActive: string
  readonly limit: (side: Side, price: number | null) => string
  readonly until: (until: number, left: number) => string
  readonly by: (by: string) => string
  readonly revoke: string
}

/** The write kinds bazaar's guardrails name, as a person says them; an unknown one is shown as it came. */
const KIND_EN: Readonly<Record<string, string>> = {
  accept_buy: 'the taker, accepting an ask', bid: 'a bid on the board', buy: 'a buy', sell: 'a sell', dealer_sell: 'a sale to a dealer',
  accept_bid: 'the maker, accepting a bid', dealer_buy: 'a buy from a dealer', post_ask: 'an ask on the board', duel: 'a duel',
}
const KIND_ES: Readonly<Record<string, string>> = {
  accept_buy: 'el taker, aceptando una oferta de venta', bid: 'una puja en el tablón', buy: 'una compra', sell: 'una venta', dealer_sell: 'una venta a un tratante',
  accept_bid: 'el maker, aceptando una puja', dealer_buy: 'una compra a un tratante', post_ask: 'una oferta de venta en el tablón', duel: 'un duelo',
}

const EN: ApprovalsStrings = {
  title: 'Approvals',
  sub: (threshold) => `every buy or sell at or above ${threshold} P waits for a human yes`,
  tick: (tick) => `tick ${tick}`,
  loginTitle: 'Unlock approvals',
  loginSub: 'The approver password (not the game view token). Nothing is kept in this browser: a reload asks again after 2 h.',
  password: 'Password',
  unlock: 'Unlock',
  unlocking: 'Checking…',
  wrong: 'Wrong password.',
  locked: (minutes) => `Too many attempts: locked for ${plural(minutes, 'minute', 'minutes')}.`,
  loginError: 'Could not reach the server. Try again.',
  lock: 'Lock',
  checking: 'Checking the session…',
  unavailable: 'Approvals service unavailable: bazaar-mcp did not answer. Trying again every 10 s.',
  skipped: (n) => `${plural(n, 'row', 'rows')} could not be read and ${n === 1 ? 'is' : 'are'} not shown.`,
  notes: 'Notes from bazaar-mcp',
  pending: 'Requests',
  pendingSub: (waiting, total) => `${waiting} waiting · ${total} in all`,
  noPending: 'No request: our agents have asked for nothing at or above the threshold.',
  side: { buy: 'BUY', sell: 'SELL' },
  state: { waiting: 'waiting', approved: 'approved', denied: 'denied' },
  asks: (side, price) => (side === 'buy' ? `wants to pay ${p(price)}` : `wants to sell for ${p(price)}`),
  whyLabel: 'Why it asked',
  scoreImpact: (v) => `score ${signed(v)}`,
  values: 'Value',
  ourValue: 'to us',
  officialValue: 'official',
  album: (a) => `${a.set}: we hold ${a.held}${a.page_card ? ' · a page card' : ''}`,
  lastCopy: 'LAST COPY of a page card',
  lastCopyTitle: 'selling it breaks a page: its bonus is lost',
  albumLabel: 'Album',
  askedLabel: 'Asked',
  capLabel: 'Hard cap',
  askedBy: (kind, cp) => `${kind ? `asked by ${KIND_EN[kind] ?? kind}` : 'asked'}${cp ? ` · with ${cp}` : ''}`,
  askedAt: (asked) => (asked === null ? 'asked at an unknown tick' : `asked at tick ${asked}`),
  staleIn: (stale, left) => `stale after tick ${stale} (${plural(left, 'tick', 'ticks')} left)`,
  staleSince: (stale) => `stale since tick ${stale}`,
  cap: (max, rule) => `never above ${max}: ${rule}`,
  priceLabel: (side) => (side === 'buy' ? 'Up to (P)' : 'Down to (P)'),
  ttlLabel: 'For (ticks)',
  reasonLabel: 'Reason (optional)',
  approve: 'Approve',
  confirm: (card, side, price) => `Confirm approve ${card} ${side} ${side === 'buy' ? 'up to' : 'down to'} ${price}?`,
  scope: (card, side, ttl) => `It covers any counterparty for the next ${plural(ttl, 'tick', 'ticks')}, and replaces any live approval for ${card} ${side}.`,
  aboveOfficial: (official) => `above the official value ${p(official)}`,
  belowOurs: (ours) => `below what it is worth to us, ${p(ours)}`,
  cancel: 'Cancel',
  deny: 'Deny',
  sending: 'Sending…',
  priceError: (e, min, max, rule) => {
    switch (e) {
      case 'not_integer':
        return 'whole primas only'
      case 'below':
        return `at least ${min}`
      case 'above_cap':
        return `never above ${max} (${rule ?? 'cap'}): an approval cannot lift it`
      case 'above_max':
        return `at most ${max}`
    }
  },
  ttlError: (min, max) => `${min} to ${max} ticks`,
  reasonError: (max) => `at most ${max} characters`,
  approved: (card, side, price, until) => `Approved: ${card} ${side} ${side === 'buy' ? 'up to' : 'down to'} ${p(price)}${until !== null ? ` until tick ${until}` : ''}.`,
  refused: 'bazaar-mcp refused it:',
  revoked: (card, side) => `Revoked: ${card} ${side}.`,
  denied: (card, side) => `Denied: ${card} ${side} is recorded as a no.`,
  error: {
    expired: 'The session ended: unlock again.',
    csrf: 'The session check failed: reload the page.',
    rate_limited: 'Too many changes in a minute: wait a moment and try again.',
    bad_request: 'The server refused those values.',
    unavailable: 'Approvals service unavailable: nothing was changed.',
    tool: 'bazaar-mcp refused the request: nothing was changed.',
    network: 'Could not reach the server: nothing was changed.',
  },
  active: 'Active approvals',
  activeSub: (n) => plural(n, 'live approval', 'live approvals'),
  noActive: 'No approval is live.',
  limit: (side, price) => (side === 'buy' ? `up to ${p(price)}` : `down to ${p(price)}`),
  until: (until, left) => (left >= 0 ? `until tick ${until} (${plural(left, 'tick', 'ticks')} left)` : `ended at tick ${until}`),
  by: (by) => `by ${by}`,
  revoke: 'Revoke',
}

const ES: ApprovalsStrings = {
  title: 'Aprobaciones',
  sub: (threshold) => `toda compra o venta de ${threshold} P o más espera el sí de una persona`,
  tick: (tick) => `turno ${tick}`,
  loginTitle: 'Desbloquear aprobaciones',
  loginSub: 'La contraseña de aprobador (no el token de las pantallas). Nada se guarda en este navegador: pasadas 2 h se vuelve a pedir.',
  password: 'Contraseña',
  unlock: 'Desbloquear',
  unlocking: 'Comprobando…',
  wrong: 'Contraseña incorrecta.',
  locked: (minutes) => `Demasiados intentos: bloqueado ${plural(minutes, 'minuto', 'minutos')}.`,
  loginError: 'No se pudo hablar con el servidor. Inténtalo otra vez.',
  lock: 'Bloquear',
  checking: 'Comprobando la sesión…',
  unavailable: 'Aprobaciones no disponibles: bazaar-mcp no responde. Se reintenta cada 10 s.',
  skipped: (n) => `${plural(n, 'fila no se pudo leer', 'filas no se pudieron leer')} y no se ${n === 1 ? 'muestra' : 'muestran'}.`,
  notes: 'Notas de bazaar-mcp',
  pending: 'Peticiones',
  pendingSub: (waiting, total) => `${waiting} en espera · ${total} en total`,
  noPending: 'Ninguna petición: nuestros agentes no han pedido nada por encima del umbral.',
  side: { buy: 'COMPRA', sell: 'VENTA' },
  state: { waiting: 'en espera', approved: 'aprobada', denied: 'vetada' },
  asks: (side, price) => (side === 'buy' ? `quiere pagar ${p(price)}` : `quiere vender por ${p(price)}`),
  whyLabel: 'Por qué pregunta',
  scoreImpact: (v) => `puntuación ${signed(v)}`,
  values: 'Valor',
  ourValue: 'para nosotros',
  officialValue: 'oficial',
  album: (a) => `${a.set}: tenemos ${a.held}${a.page_card ? ' · carta de página' : ''}`,
  lastCopy: 'ÚLTIMA COPIA de una carta de página',
  lastCopyTitle: 'venderla rompe una página: se pierde su bonus',
  albumLabel: 'Álbum',
  askedLabel: 'Pedido',
  capLabel: 'Tope fijo',
  askedBy: (kind, cp) => `${kind ? `lo pide ${KIND_ES[kind] ?? kind}` : 'pedido'}${cp ? ` · con ${cp}` : ''}`,
  askedAt: (asked) => (asked === null ? 'pedido en un turno desconocido' : `pedido en el turno ${asked}`),
  staleIn: (stale, left) => `caduca tras el turno ${stale} (quedan ${plural(left, 'turno', 'turnos')})`,
  staleSince: (stale) => `caducada desde el turno ${stale}`,
  cap: (max, rule) => `nunca por encima de ${max}: ${rule}`,
  priceLabel: (side) => (side === 'buy' ? 'Hasta (P)' : 'Como mínimo (P)'),
  ttlLabel: 'Durante (turnos)',
  reasonLabel: 'Motivo (opcional)',
  approve: 'Aprobar',
  confirm: (card, side, price) => `¿Confirmas aprobar ${side === 'buy' ? 'la compra' : 'la venta'} de ${card} ${side === 'buy' ? 'hasta' : 'como mínimo a'} ${price}?`,
  scope: (card, side, ttl) => `Vale con cualquier contraparte durante los próximos ${plural(ttl, 'turno', 'turnos')} y sustituye cualquier aprobación en vigor de la ${side === 'buy' ? 'compra' : 'venta'} de ${card}.`,
  aboveOfficial: (official) => `por encima del valor oficial, ${p(official)}`,
  belowOurs: (ours) => `por debajo de lo que nos vale, ${p(ours)}`,
  cancel: 'Cancelar',
  deny: 'Vetar',
  sending: 'Enviando…',
  priceError: (e, min, max, rule) => {
    switch (e) {
      case 'not_integer':
        return 'solo primas enteras'
      case 'below':
        return `como mínimo ${min}`
      case 'above_cap':
        return `nunca por encima de ${max} (${rule ?? 'tope'}): una aprobación no lo levanta`
      case 'above_max':
        return `como máximo ${max}`
    }
  },
  ttlError: (min, max) => `de ${min} a ${max} turnos`,
  reasonError: (max) => `como máximo ${max} caracteres`,
  approved: (card, side, price, until) => `Aprobada: ${side === 'buy' ? 'compra' : 'venta'} de ${card} ${side === 'buy' ? 'hasta' : 'como mínimo a'} ${p(price)}${until !== null ? ` hasta el turno ${until}` : ''}.`,
  refused: 'bazaar-mcp la rechazó:',
  revoked: (card, side) => `Revocada: ${side === 'buy' ? 'compra' : 'venta'} de ${card}.`,
  denied: (card, side) => `Vetada: queda anotado un no a la ${side === 'buy' ? 'compra' : 'venta'} de ${card}.`,
  error: {
    expired: 'La sesión terminó: desbloquea otra vez.',
    csrf: 'Falló la comprobación de la sesión: recarga la página.',
    rate_limited: 'Demasiados cambios en un minuto: espera un momento y vuelve a probar.',
    bad_request: 'El servidor rechazó esos valores.',
    unavailable: 'Aprobaciones no disponibles: no se cambió nada.',
    tool: 'bazaar-mcp rechazó la petición: no se cambió nada.',
    network: 'No se pudo hablar con el servidor: no se cambió nada.',
  },
  active: 'Aprobaciones activas',
  activeSub: (n) => plural(n, 'aprobación en vigor', 'aprobaciones en vigor'),
  noActive: 'Ninguna aprobación en vigor.',
  limit: (side, price) => (side === 'buy' ? `hasta ${p(price)}` : `como mínimo ${p(price)}`),
  until: (until, left) => (left >= 0 ? `hasta el turno ${until} (quedan ${plural(left, 'turno', 'turnos')})` : `terminó en el turno ${until}`),
  by: (by) => `por ${by}`,
  revoke: 'Revocar',
}

export const APPROVALS_STRINGS: Readonly<Record<Lang, ApprovalsStrings>> = { es: ES, en: EN }

export function useApprovalsStrings(): ApprovalsStrings {
  return APPROVALS_STRINGS[useLang()]
}
