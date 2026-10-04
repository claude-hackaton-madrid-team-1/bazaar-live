/**
 * The words of the Market Test panel on /history (./ui/MarketTestPanel.tsx), in the page's language (kept apart from
 * strings.ts: one panel, one file). Team names come from humanize.ts (`whoName`).
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'

const fmt = (v: number, lang: Lang): string => {
  const s = String(Math.round(v * 100) / 100)
  return lang === 'es' ? s.replace('.', ',') : s
}

export interface MarketTestStrings {
  readonly title: string
  readonly sub: string
  /** "Market 7.5 · 8th of 18 · Team 10 leads with 12.5 (+5)". */
  readonly headline: (ours: number | null, place: number | null, of: number, leader: { name: string; venue: string | null; value: number; gap: number | null } | null) => string
  /** "Team 10 (v07)". */
  readonly named: (name: string, venue: string | null) => string
  readonly value: (v: number) => string
  readonly us: string
  readonly more: (n: number) => string
  readonly levelTitle: (teams: number) => string
  readonly benchHead: string
  readonly benchTitle: string
  readonly benchPoints: (v: number | null) => string
  readonly efficiency: (v: number | null) => string
  readonly venue: (v: string | null) => string
  readonly mm: (v: number | null) => string
  /** Bench matches never show up as venue trades. */
  readonly note: (venue: string | null) => string
}

const EN: MarketTestStrings = {
  title: 'Market Test',
  sub: "every team's market part on the board; our bench run below is ours alone",
  headline: (ours, place, of, leader) =>
    [
      ours === null ? 'Our market: not read yet' : `Our market ${fmt(ours, 'en')}`,
      place !== null && of > 0 ? `#${place} of ${of}` : null,
      leader ? `${leader.name} leads with ${fmt(leader.value, 'en')}${leader.venue ? ` on ${leader.venue}` : ''}${leader.gap !== null && leader.gap > 0 ? ` (+${fmt(leader.gap, 'en')})` : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  value: (v) => v.toFixed(2),
  named: (name, venue) => (venue ? `${name} (${venue})` : name),
  us: 'us',
  more: (n) => `+${n} more`,
  levelTitle: (teams) => `${teams} ${teams === 1 ? 'team' : 'teams'} at this market`,
  benchHead: 'Our bench run',
  benchTitle: 'Our private score breakdown, in its own units: the board hides it for every team, so it is never set beside a rival',
  benchPoints: (v) => `bench ${v === null ? '—' : fmt(v, 'en')}`,
  efficiency: (v) => `efficiency ${v === null ? '—' : `${(v * 100).toFixed(1)}%`}`,
  venue: (v) => `venue ${v ?? '—'}`,
  mm: (v) => `market-making ${v === null ? '—' : fmt(v, 'en')}`,
  note: (venue) =>
    `Bench matches never show up as venue trades: ${venue ? `our venue ${venue} showing 0 trades` : '0 trades on our venue'} does not mean the Market Test did not run.`,
}

const ES: MarketTestStrings = {
  title: 'Market Test',
  sub: 'la parte de mercado de cada equipo en la clasificación; nuestra prueba de banco, abajo, es solo nuestra',
  headline: (ours, place, of, leader) =>
    [
      ours === null ? 'Nuestro mercado: sin leer todavía' : `Nuestro mercado ${fmt(ours, 'es')}`,
      place !== null && of > 0 ? `#${place} de ${of}` : null,
      leader ? `${leader.name} va primero con ${fmt(leader.value, 'es')}${leader.venue ? ` en ${leader.venue}` : ''}${leader.gap !== null && leader.gap > 0 ? ` (+${fmt(leader.gap, 'es')})` : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  value: (v) => v.toFixed(2).replace('.', ','),
  named: (name, venue) => (venue ? `${name} (${venue})` : name),
  us: 'nosotros',
  more: (n) => `+${n} más`,
  levelTitle: (teams) => `${teams} ${teams === 1 ? 'equipo' : 'equipos'} con este mercado`,
  benchHead: 'Nuestra prueba de banco',
  benchTitle: 'Nuestro desglose privado, en sus propias unidades: la clasificación lo oculta para todos, así que nunca se compara con un rival',
  benchPoints: (v) => `banco ${v === null ? '—' : fmt(v, 'es')}`,
  efficiency: (v) => `eficiencia ${v === null ? '—' : `${(v * 100).toFixed(1).replace('.', ',')} %`}`,
  venue: (v) => `puesto ${v ?? '—'}`,
  mm: (v) => `creación de mercado ${v === null ? '—' : fmt(v, 'es')}`,
  note: (venue) =>
    `Las partidas del banco nunca aparecen como operaciones del puesto: que ${venue ? `nuestro puesto ${venue}` : 'nuestro puesto'} muestre 0 operaciones no significa que el Market Test no se jugara.`,
}

export const MARKET_TEST_STRINGS: Readonly<Record<Lang, MarketTestStrings>> = { es: ES, en: EN }

export function useMarketTestStrings(): MarketTestStrings {
  return MARKET_TEST_STRINGS[useLang()]
}
