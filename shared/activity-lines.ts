import type { Lang } from './lang.ts'

/** Closed narration, shared with the TTS allow-list. No private values or free-text slots. */
export const ACTIVITY_LINES = {
  tick: ['A new market tick. Watching for the next opportunity.', 'Nuevo turno de mercado. Pendientes de la próxima oportunidad.'],
  round: ['The game reports a changed day or round.', 'El juego indica un cambio de día o ronda.'],
  duel_start: ['A live duel has started. The negotiation is underway.', 'Ha comenzado un duelo. La negociación está en marcha.'],
  duel_offer: ['A new offer in the live duel.', 'Nueva oferta en el duelo.'],
  duel_deal: ['The duel ended with an agreement.', 'El duelo terminó con un acuerdo.'],
  duel_no_deal: ['The duel ended without an agreement.', 'El duelo terminó sin acuerdo.'],
  team_open: ['Negotiations with another team are open.', 'Comienza la negociación con otro equipo.'],
  team_offer: ['A proposal is on the table with another team.', 'Hay una propuesta sobre la mesa con otro equipo.'],
  team_message: ['A message was exchanged in a team negotiation.', 'Nuevo mensaje en una negociación entre equipos.'],
  team_close: ['The team conversation has closed. That alone does not confirm a trade.', 'La conversación entre equipos ha cerrado. Eso no confirma un intercambio.'],
  team_accept: ['A team offer was accepted. Settlement is still a separate event.', 'Se ha aceptado una oferta entre equipos. La liquidación es un evento aparte.'],
  trade: ['The game confirms a settled trade.', 'El juego confirma un intercambio liquidado.'],
  failure: ['An action failed. Its outcome needs checking before another attempt.', 'Una acción ha fallado. Hay que comprobar el resultado antes de otro intento.'],
  bench_start: ['The Market Test has started.', 'Ha comenzado la prueba de mercado.'],
  bench_finish: ['The Market Test has finished.', 'Ha terminado la prueba de mercado.'],
  observe: ['The agent reports its observation phase.', 'El agente indica que está observando.'],
  decide: ['The agent reports its decision phase.', 'El agente indica que está decidiendo.'],
  act: ['The agent reports its action phase.', 'El agente indica que está actuando.'],
} as const
export type ActivityLine = keyof typeof ACTIVITY_LINES
export const activityLine = (kind: ActivityLine, lang: Lang): string => ACTIVITY_LINES[kind][lang === 'en' ? 0 : 1]
export const isActivityLine = (text: string, lang: Lang): boolean => Object.values(ACTIVITY_LINES).some((pair) => pair[lang === 'en' ? 0 : 1] === text)
