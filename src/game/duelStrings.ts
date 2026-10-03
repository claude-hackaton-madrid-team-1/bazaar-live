/**
 * The words of the Duels screen, in the page's language (kept apart from strings.ts: one screen, one file).
 */
import type { Lang } from '../../shared/lang.ts'
import type { DecisionStatus } from '../../shared/decisions.ts'
import { useLang } from '../ui/lang'
import type { AgentState } from './views/decisions.ts'
import type { DuelAction, DuelState, LiveDuel } from './views/duels.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const p = (v: number) => `${Math.round(v * 10) / 10} P`

const pct = (v: number) => `${Math.round(v * 100)} %`

export interface DuelStrings {
  readonly live: string
  readonly liveSub: (n: number) => string
  readonly noLive: string
  readonly noDuels: string
  readonly state: Readonly<Record<DuelState, string>>
  readonly stateTitle: Readonly<Record<DuelState, string>>
  readonly buying: string
  readonly selling: string
  readonly their: string
  readonly our: string
  readonly gap: string
  readonly limit: string
  readonly limitTitle: (side: 'buy' | 'sell') => string
  readonly inside: (by: number) => string
  readonly outside: (by: number) => string
  readonly daysNote: string
  readonly verdict: (r: LiveDuel) => string
  readonly rounds: (n: number) => string
  readonly decay: (share: number, cost: number | null) => string
  readonly decayTitle: (decay: number) => string
  /** `span` is the time left said as "~2 min". */
  readonly left: (n: number, span: string) => string
  readonly leftTitle: (deadline: number) => string
  readonly agent: string
  readonly action: Readonly<Record<DuelAction, string>>
  readonly decision: Readonly<Record<DecisionStatus, string>>
  readonly blockedBy: (rule: string) => string
  readonly failedWith: (error: string) => string
  readonly atTick: (tick: number) => string
  /** When the accept is planned, said as "in ~1 min". */
  readonly acceptPlan: (when: string) => string
  readonly acceptPlanTitle: string
  readonly noDecision: string
  readonly details: string
  readonly detailsLine: (id: number, session: number | null, deadline: number | null) => string
  readonly record: string
  readonly recordSub: string
  readonly scorePoints: string
  readonly scorePointsTitle: string
  readonly dealsOf: (deals: number, finished: number) => string
  readonly gainTotal: string
  readonly gainTitle: string
  readonly perRival: string
  readonly perSession: string
  readonly session: (n: number | null) => string
  readonly unknownRival: string
  readonly col: Readonly<Record<'who' | 'duels' | 'deals' | 'noDeals' | 'gain', string>>
  readonly liveBadge: (n: number) => string
  readonly finished: string
  readonly finishedSub: (deals: number, none: number) => string
  readonly deal: (price: number | null, limit: number | null, edge: number | null) => string
  readonly noDeal: string
  readonly dealBadge: string
  readonly noFinished: string
  readonly kept: (gain: number) => string
  readonly pts: (points: number) => string
  readonly endedAt: (tick: number) => string
  readonly health: string
  readonly healthState: Readonly<Record<AgentState, string>>
  /** `ago` as "3 min ago", null when it never decided. */
  readonly silentSince: (ago: string | null) => string
  readonly decidedAt: (ago: string) => string
  readonly topBlock: (rule: string, n: number) => string
  readonly noBlock: string
  readonly link: (n: number) => string
}

const EN: DuelStrings = {
  live: 'Live duels',
  liveSub: (n) => (n ? `${n} live · is their price inside our limit?` : 'none live'),
  noLive: 'No live duel right now.',
  noDuels: 'No duels yet. A duel shows up here as soon as its session starts.',
  state: { inside: 'inside limit · will accept', haggling: 'haggling', outside: 'outside limit', expiring: 'expiring' },
  stateTitle: {
    inside: 'Their price is strictly inside our limit: the agent may accept it (duel_inside_limit allows it)',
    haggling: 'Their price is outside our limit, but at their pace it crosses it before the deadline',
    outside: 'Their price is outside our limit and they hold, or cannot cross it before the deadline at their pace',
    expiring: 'Outside our limit with two ticks or fewer left: no deal unless they jump',
  },
  buying: 'buying',
  selling: 'selling',
  their: 'their price',
  our: 'our price',
  gap: 'gap',
  limit: 'our limit',
  limitTitle: (side) => (side === 'buy' ? 'Our value: never pay this or more' : 'Our cost: never sell at this or less'),
  inside: (by) => `inside by ${p(by)}`,
  outside: (by) => `outside by ${p(by)}`,
  daysNote: 'price only: the days weight is private',
  verdict: (r) => {
    if (r.theirPrice == null || r.limit == null) return r.limit == null ? 'Waiting for our limit.' : 'Waiting for their first price.'
    if (r.margin != null && r.margin > 0) {
      const keep = r.keepNow != null ? `; accepting now keeps ${p(r.keepNow)}` : ''
      return `Their ${p(r.theirPrice)} is inside our limit ${p(r.limit)} by ${p(r.margin)}${keep}.`
    }
    const by = p(Math.abs(r.margin ?? 0))
    if (r.theirStep != null && r.theirStep > 0) {
      const when = r.roundsToLimit != null ? `, inside in ~${plural(r.roundsToLimit, 'round', 'rounds')}` : ''
      return `Their ${p(r.theirPrice)} is ${by} past our limit ${p(r.limit)}; they move ${p(r.theirStep)} a round${when}.`
    }
    return `Their ${p(r.theirPrice)} is ${by} past our limit ${p(r.limit)}, and they ${r.theirStep == null ? 'have priced once' : 'are not moving'}.`
  },
  rounds: (n) => plural(n, 'round', 'rounds'),
  decay: (share, cost) => `decay −${pct(share)}${cost != null ? ` (−${p(cost)})` : ''}`,
  decayTitle: (decay) => `Every round keeps ${pct(1 - decay)} of the deal's value; this is what the rounds so far have cost`,
  left: (n, span) => (n === 0 ? 'ends this tick' : `${span} left`),
  leftTitle: (deadline) => `Ticks until the deadline (tick ${deadline})`,
  agent: 'Agent',
  action: { offer: 'offer', accept: 'accept', hold: 'hold', other: 'act' },
  decision: { proposed: 'proposed', approved: 'approved', claimed: 'sending', done: 'done', rejected: 'blocked', failed: 'failed', expired: 'expired' },
  blockedBy: (rule) => `blocked by ${rule}`,
  failedWith: (error) => `failed: ${error}`,
  atTick: (tick) => `tick ${tick}`,
  acceptPlan: (when) => `accept planned ${when}`,
  acceptPlanTitle: 'duel_policy v2 plans each accept by the deadline − 2 (one accept per tick for the whole team)',
  noDecision: 'no decision on this duel yet',
  details: 'details',
  detailsLine: (id, session, deadline) => `duel #${id} · session ${session ?? '—'} · deadline tick ${deadline ?? '—'}`,
  record: 'Record',
  recordSub: 'per rival and per session',
  scorePoints: 'duel points',
  scorePointsTitle: 'score.duel_points from our /me: what the game counts',
  dealsOf: (deals, finished) => `${deals} / ${finished} deals`,
  gainTotal: 'kept',
  gainTitle: 'What our deals kept for us: the price against our limit after the decay of their rounds',
  perRival: 'Per rival',
  perSession: 'Per session',
  session: (n) => (n == null ? 'session —' : `session ${n}`),
  unknownRival: 'unknown rival',
  col: { who: '', duels: 'duels', deals: 'deals', noDeals: 'no deal', gain: 'kept' },
  liveBadge: (n) => `${n} live`,
  finished: 'Finished duels',
  finishedSub: (deals, none) => `${plural(deals, 'deal', 'deals')} · ${none} no deal · most recent first`,
  deal: (price, limit, edge) =>
    `deal at ${price == null ? '—' : p(price)}${limit != null ? ` vs our limit ${p(limit)}` : ''}${edge != null ? ` (${edge >= 0 ? '+' : '−'}${p(Math.abs(edge))})` : ''}`,
  noDeal: 'no deal',
  dealBadge: 'deal',
  noFinished: 'No duel has finished yet.',
  kept: (gain) => `kept ${p(gain)}`,
  pts: (points) => `${points >= 0 ? '+' : '−'}${Math.abs(points)} pts`,
  endedAt: (tick) => `t${tick}`,
  health: 'Duels agent',
  healthState: { none: 'NO LOG', silent: 'SILENT', quiet: 'QUIET', stuck: 'BLOCKED', ok: 'OK' },
  silentSince: (ago) => (ago == null ? 'has never decided' : `silent: last decision ${ago}`),
  decidedAt: (ago) => `last decision ${ago}`,
  topBlock: (rule, n) => `blocked most by ${rule} ×${n} this game hour`,
  noBlock: 'nothing blocked this game hour',
  link: (n) => `${plural(n, 'live duel', 'live duels')} →`,
}

const ES: DuelStrings = {
  live: 'Duelos en curso',
  liveSub: (n) => (n ? `${n} en curso · ¿su precio está dentro de nuestro límite?` : 'ninguno en curso'),
  noLive: 'Ningún duelo en curso ahora.',
  noDuels: 'Aún no hay duelos. Un duelo aparece aquí en cuanto empieza su sesión.',
  state: { inside: 'dentro del límite · aceptará', haggling: 'regateando', outside: 'fuera del límite', expiring: 'a punto de expirar' },
  stateTitle: {
    inside: 'Su precio está estrictamente dentro de nuestro límite: el agente puede aceptarlo (duel_inside_limit lo permite)',
    haggling: 'Su precio está fuera de nuestro límite, pero a su ritmo lo cruza antes del plazo',
    outside: 'Su precio está fuera de nuestro límite y no se mueve, o no lo cruza antes del plazo a su ritmo',
    expiring: 'Fuera de nuestro límite y quedan dos turnos o menos: sin trato salvo que salten',
  },
  buying: 'compramos',
  selling: 'vendemos',
  their: 'su precio',
  our: 'nuestro precio',
  gap: 'distancia',
  limit: 'nuestro límite',
  limitTitle: (side) => (side === 'buy' ? 'Nuestro valor: nunca pagar esto o más' : 'Nuestro coste: nunca vender por esto o menos'),
  inside: (by) => `dentro por ${p(by)}`,
  outside: (by) => `fuera por ${p(by)}`,
  daysNote: 'solo precio: el peso de los días es privado',
  verdict: (r) => {
    if (r.theirPrice == null || r.limit == null) return r.limit == null ? 'Esperando nuestro límite.' : 'Esperando su primer precio.'
    if (r.margin != null && r.margin > 0) {
      const keep = r.keepNow != null ? `; aceptar ahora nos deja ${p(r.keepNow)}` : ''
      return `Sus ${p(r.theirPrice)} están dentro de nuestro límite ${p(r.limit)} por ${p(r.margin)}${keep}.`
    }
    const by = p(Math.abs(r.margin ?? 0))
    if (r.theirStep != null && r.theirStep > 0) {
      const when = r.roundsToLimit != null ? `, dentro en ~${plural(r.roundsToLimit, 'ronda', 'rondas')}` : ''
      return `Sus ${p(r.theirPrice)} están ${by} más allá de nuestro límite ${p(r.limit)}; se mueven ${p(r.theirStep)} por ronda${when}.`
    }
    return `Sus ${p(r.theirPrice)} están ${by} más allá de nuestro límite ${p(r.limit)}, y ${r.theirStep == null ? 'solo han dado un precio' : 'no se mueven'}.`
  },
  rounds: (n) => plural(n, 'ronda', 'rondas'),
  decay: (share, cost) => `desgaste −${pct(share)}${cost != null ? ` (−${p(cost)})` : ''}`,
  decayTitle: (decay) => `Cada ronda conserva el ${pct(1 - decay)} del valor del trato; esto es lo que han costado las rondas hasta ahora`,
  left: (n, span) => (n === 0 ? 'acaba este turno' : `quedan ${span}`),
  leftTitle: (deadline) => `Turnos hasta el plazo (turno ${deadline})`,
  agent: 'Agente',
  action: { offer: 'oferta', accept: 'aceptar', hold: 'esperar', other: 'actuar' },
  decision: { proposed: 'propuesta', approved: 'aprobada', claimed: 'enviando', done: 'hecha', rejected: 'bloqueada', failed: 'fallida', expired: 'caducada' },
  blockedBy: (rule) => `bloqueada por ${rule}`,
  failedWith: (error) => `fallida: ${error}`,
  atTick: (tick) => `turno ${tick}`,
  acceptPlan: (when) => `aceptación prevista ${when}`,
  acceptPlanTitle: 'duel_policy v2 planifica cada aceptación para el plazo − 2 (una aceptación por turno para todo el equipo)',
  noDecision: 'aún sin decisión en este duelo',
  details: 'detalles',
  detailsLine: (id, session, deadline) => `duelo #${id} · sesión ${session ?? '—'} · plazo turno ${deadline ?? '—'}`,
  record: 'Balance',
  recordSub: 'por rival y por sesión',
  scorePoints: 'puntos de duelo',
  scorePointsTitle: 'score.duel_points de nuestro /me: lo que cuenta el juego',
  dealsOf: (deals, finished) => `${deals} / ${finished} tratos`,
  gainTotal: 'ganado',
  gainTitle: 'Lo que nos dejaron nuestros tratos: el precio frente a nuestro límite tras el desgaste de sus rondas',
  perRival: 'Por rival',
  perSession: 'Por sesión',
  session: (n) => (n == null ? 'sesión —' : `sesión ${n}`),
  unknownRival: 'rival desconocido',
  col: { who: '', duels: 'duelos', deals: 'tratos', noDeals: 'sin trato', gain: 'ganado' },
  liveBadge: (n) => `${n} en curso`,
  finished: 'Duelos terminados',
  finishedSub: (deals, none) => `${plural(deals, 'trato', 'tratos')} · ${none} sin trato · los más recientes primero`,
  deal: (price, limit, edge) =>
    `trato a ${price == null ? '—' : p(price)}${limit != null ? ` frente a nuestro límite ${p(limit)}` : ''}${edge != null ? ` (${edge >= 0 ? '+' : '−'}${p(Math.abs(edge))})` : ''}`,
  noDeal: 'sin trato',
  dealBadge: 'trato',
  noFinished: 'Aún no ha terminado ningún duelo.',
  kept: (gain) => `ganado ${p(gain)}`,
  pts: (points) => `${points >= 0 ? '+' : '−'}${Math.abs(points)} pts`,
  endedAt: (tick) => `t${tick}`,
  health: 'Agente de duelos',
  healthState: { none: 'SIN REGISTRO', silent: 'EN SILENCIO', quiet: 'CALLADO', stuck: 'BLOQUEADO', ok: 'OK' },
  silentSince: (ago) => (ago == null ? 'nunca ha decidido' : `en silencio: última decisión ${ago}`),
  decidedAt: (ago) => `última decisión ${ago}`,
  topBlock: (rule, n) => `lo bloquea sobre todo ${rule} ×${n} esta hora de juego`,
  noBlock: 'nada bloqueado esta hora de juego',
  link: (n) => `${plural(n, 'duelo en curso', 'duelos en curso')} →`,
}

export const DUEL_STRINGS: Readonly<Record<Lang, DuelStrings>> = { es: ES, en: EN }

export function useDuelStrings(): DuelStrings {
  return DUEL_STRINGS[useLang()]
}
