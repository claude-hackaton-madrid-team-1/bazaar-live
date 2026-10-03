/**
 * The words of the "every team's score" panel on /history (./ui/TeamsScorePanel.tsx), in the page's language (kept
 * apart from strings.ts: one panel, one file). Team names come from humanize.ts (`whoName`), times from strings.ts
 * (`hum.ago`) and the viewer's clock.
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'
import type { BoardPart, Headline } from './views/teams.ts'

const r2 = (n: number): number => Math.round(n * 100) / 100
/** A gap with its sign: +1.7, −3.2, 0. */
export const signedGap = (n: number): string => {
  const r = r2(n)
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r)}`
}

export interface TeamsStrings {
  readonly title: string
  readonly sub: (teams: number) => string
  readonly part: Readonly<Record<BoardPart, string>>
  /** "Where do they beat us, and where do we beat them?" in one sentence. */
  readonly headline: (h: Headline, name: (team: string) => string) => string
  readonly us: string
  readonly col: {
    readonly part: string
    readonly ours: string
    readonly place: string
    readonly leader: (team: string, rank: number) => string
    readonly above: (team: string, rank: number) => string
    readonly mean: string
  }
  readonly place: (place: number, of: number) => string
  readonly notScored: string
  readonly theirs: (team: string, value: string) => string
  readonly meanOf: (teams: number, value: string) => string
  /** Under the table: what compares with what. */
  readonly note: string
  readonly chartLabel: string
  readonly rankTitle: string
  readonly rankLabel: string
  readonly keys: string
  readonly follow: string
  readonly followHint: (max: number) => string
  readonly rank: (n: number) => string
  /** A rank change, said from our side. */
  readonly moved: (before: number, after: number) => string
  readonly ours: (parts: readonly { readonly part: string; readonly delta: string }[]) => string
  readonly oursStill: string
  readonly passedUs: (names: readonly string[]) => string
  /** "3 more", after the names a list shows. */
  readonly more: (n: number) => string
  readonly wePassed: (names: readonly string[]) => string
  readonly crossing: (team: string, part: string | null, delta: string) => string
  readonly after: (what: string) => string
  readonly start: (agent: string) => string
  readonly changes: string
  readonly noChanges: string
  readonly noBoard: string
  readonly noUs: string
}

const list = (names: readonly string[], and: string): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`

const EN_PART: Readonly<Record<BoardPart, string>> = { score: 'Score', negotiating: 'Negotiation', market: 'Market-making', pages: 'Complete pages', deals: 'Deals', level: 'Level' }
const ES_PART: Readonly<Record<BoardPart, string>> = { score: 'Puntos', negotiating: 'Negociación', market: 'Creación de mercado', pages: 'Páginas completas', deals: 'Tratos', level: 'Nivel' }

const EN: TeamsStrings = {
  title: 'Score, every team',
  sub: (n) => `${n} teams · the public leaderboard, every ~10 ticks`,
  part: EN_PART,
  headline: ({ worst, best, leader }, name) => {
    const p = (part: BoardPart) => EN_PART[part].toLowerCase()
    const tail = leader ? ` The leader, ${name(leader.team)}, is ${r2(-leader.gap)} ahead in ${p(leader.part)}.` : ''
    const b = best ? `${p(best.part)} (${signedGap(best.gap)}${best.scored ? '' : ', scores nothing'})` : null
    if (worst && b) return `They beat us most in ${p(worst.part)} (${signedGap(worst.gap)} vs the average); we beat them in ${b}.${tail}`
    if (worst) return `They beat us most in ${p(worst.part)} (${signedGap(worst.gap)} vs the average); we lead in nothing that scores.${tail}`
    if (best) return `We beat them most in ${p(best.part)} (${signedGap(best.gap)} vs the average${best.scored ? '' : ', scores nothing'}), below the average in nothing that scores.${tail}`
    return `Level with the average in every part that scores.${tail}`
  },
  us: 'Us',
  col: {
    part: 'Part',
    ours: 'Us',
    place: 'Place',
    leader: (team, rank) => `vs ${team} (${rank === 1 ? 'leader' : `#${rank}`})`,
    above: (team, rank) => `vs ${team} (#${rank}, just above)`,
    mean: 'vs average',
  },
  place: (p, of) => `#${p} of ${of}`,
  notScored: 'scores nothing',
  theirs: (team, value) => `${team}: ${value}`,
  meanOf: (n, value) => `Average of the other ${n} teams: ${value}`,
  note: 'Score = negotiation + market-making, counted the same way for every team. Pages, deals and level score nothing by themselves.',
  chartLabel: "Every team's score over the day",
  rankTitle: 'Our place',
  rankLabel: 'Our place and the followed teams’ over the day',
  keys: 'arrows move along the day, Esc leaves',
  follow: 'Follow',
  followHint: (max) => `Tap a team to draw it in colour (up to ${max})`,
  rank: (n) => `#${n}`,
  moved: (a, b) => (b < a ? `Up from #${a} to #${b}` : `Down from #${a} to #${b}`),
  ours: (parts) => `our ${list(parts.map((p) => `${p.part.toLowerCase()} ${p.delta}`), 'and')}`,
  oursStill: 'our score did not move',
  passedUs: (names) => `passed by ${list(names, 'and')}`,
  wePassed: (names) => `we passed ${list(names, 'and')}`,
  more: (n) => `${n} more`,
  crossing: (team, part, d) => (part ? `${team} (${part.toLowerCase()} ${d})` : team),
  after: (what) => `after ${what}`,
  start: (agent) => `the ${agent.toLowerCase()} restarted`,
  changes: 'What moved our place',
  noChanges: 'Our place has not moved today.',
  noBoard: 'No leaderboard read today yet.',
  noUs: 'We are not on today’s leaderboard yet.',
}

const ES: TeamsStrings = {
  title: 'Puntos de todos los equipos',
  sub: (n) => `${n} equipos · la clasificación pública, cada ~10 turnos`,
  part: ES_PART,
  headline: ({ worst, best, leader }, name) => {
    const p = (part: BoardPart) => ES_PART[part].toLowerCase()
    const tail = leader ? ` El líder, ${name(leader.team)}, nos saca ${r2(-leader.gap)} en ${p(leader.part)}.` : ''
    const b = best ? `${p(best.part)} (${signedGap(best.gap)}${best.scored ? '' : ', no puntúa'})` : null
    if (worst && b) return `Nos ganan sobre todo en ${p(worst.part)} (${signedGap(worst.gap)} vs la media); ganamos en ${b}.${tail}`
    if (worst) return `Nos ganan sobre todo en ${p(worst.part)} (${signedGap(worst.gap)} vs la media); no ganamos en nada que puntúe.${tail}`
    if (best) return `Ganamos sobre todo en ${p(best.part)} (${signedGap(best.gap)} vs la media${best.scored ? '' : ', no puntúa'}), y no estamos bajo la media en nada que puntúe.${tail}`
    return `A la par de la media en todo lo que puntúa.${tail}`
  },
  us: 'Nosotros',
  col: {
    part: 'Parte',
    ours: 'Nosotros',
    place: 'Puesto',
    leader: (team, rank) => `vs ${team} (${rank === 1 ? 'líder' : `${rank}º`})`,
    above: (team, rank) => `vs ${team} (${rank}º, justo encima)`,
    mean: 'vs la media',
  },
  place: (p, of) => `${p}º de ${of}`,
  notScored: 'no puntúa',
  theirs: (team, value) => `${team}: ${value}`,
  meanOf: (n, value) => `Media de los otros ${n} equipos: ${value}`,
  note: 'Puntos = negociación + creación de mercado, contados igual para todos. Páginas, tratos y nivel no puntúan por sí solos.',
  chartLabel: 'Puntos de cada equipo a lo largo del día',
  rankTitle: 'Nuestro puesto',
  rankLabel: 'Nuestro puesto y el de los equipos seguidos a lo largo del día',
  keys: 'las flechas recorren el día, Esc sale',
  follow: 'Seguir',
  followHint: (max) => `Toca un equipo para verlo en color (hasta ${max})`,
  rank: (n) => `${n}º`,
  moved: (a, b) => (b < a ? `Subimos del ${a}º al ${b}º` : `Bajamos del ${a}º al ${b}º`),
  ours: (parts) => `nuestra ${list(parts.map((p) => `${p.part.toLowerCase()} ${p.delta}`), 'y')}`,
  oursStill: 'nuestros puntos no se movieron',
  passedUs: (names) => `${names.length === 1 ? 'nos pasó' : 'nos pasaron'} ${list(names, 'y')}`,
  wePassed: (names) => `pasamos a ${list(names, 'y')}`,
  more: (n) => `${n} más`,
  crossing: (team, part, d) => (part ? `${team} (${part.toLowerCase()} ${d})` : team),
  after: (what) => `tras ${what}`,
  start: (agent) => `reiniciar el ${agent.toLowerCase()}`,
  changes: 'Qué movió nuestro puesto',
  noChanges: 'Nuestro puesto no se ha movido hoy.',
  noBoard: 'Todavía no hay lecturas de la clasificación de hoy.',
  noUs: 'Todavía no estamos en la clasificación de hoy.',
}

export const TEAMS_STRINGS: Readonly<Record<Lang, TeamsStrings>> = { es: ES, en: EN }

export function useTeamsStrings(): TeamsStrings {
  return TEAMS_STRINGS[useLang()]
}
