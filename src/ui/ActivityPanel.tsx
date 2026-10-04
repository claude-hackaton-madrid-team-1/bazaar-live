import { useState } from 'react'
import type { ActivityCategory } from '../show/broadcast'
import type { ShowState } from '../show/engine'
import { useLang } from './lang'
import './activity.css'

const CATEGORIES: readonly ActivityCategory[] = ['duel', 'team', 'trade', 'jev', 'incident', 'market', 'clock', 'dealer']
const LABELS = {
  en: { duel: 'Duels', team: 'Team negotiations', trade: 'Settlements', jev: 'Jev · orchestration', incident: 'Incidents', market: 'Market', clock: 'Game clock', dealer: 'Dealers / public activity' },
  es: { duel: 'Duelos', team: 'Negociaciones entre equipos', trade: 'Liquidaciones', jev: 'Jev · orquestación', incident: 'Incidentes', market: 'Mercado', clock: 'Reloj del juego', dealer: 'Tratos / actividad pública' },
}

/** Updates as events arrive, independently of whether the speech queue is muted or busy. */
export function ActivityPanel({ state, replay }: { state: ShowState; replay: boolean }) {
  const lang = useLang()
  const es = lang === 'es'
  const [filter, setFilter] = useState<ActivityCategory | 'all'>('all')
  const latest = [...state.activity].reverse()
  const rows = (filter === 'all' ? latest.filter((row, i) => latest.findIndex((other) => other.category === row.category) === i) : latest.filter((row) => row.category === filter)).slice(0, 6)
  const tick = state.gameClock.tick ?? state.ticks.taker ?? state.ticks.maker
  const source = replay ? (es ? 'REPRODUCCIÓN GRABADA' : 'RECORDED REPLAY') : state.broadcastStatus === 'demo' ? 'DEMO · SYNTHETIC' : state.broadcastStatus === 'live' ? (es ? 'EVENTOS AUTORIZADOS' : 'AUTHORIZED EVENTS') : (es ? 'ACTIVIDAD PÚBLICA' : 'PUBLIC ACTIVITY')
  return <section className="activity-panel material" aria-label={es ? 'Actividad del juego' : 'Game activity'}>
    <div className="activity-heading">
      <div><span className="activity-source">{source}</span><h2>{es ? 'La mesa en directo' : 'Around the table'}</h2></div>
      <div className="activity-clock" key={tick}><span aria-hidden="true">●</span> Tick {tick ?? '—'}{state.gameClock.seconds !== null && <small> · {state.gameClock.seconds}s</small>}</div>
      <label>{es ? 'Ver' : 'Show'} <select value={filter} onChange={(e) => { setFilter(CATEGORIES.find((category) => category === e.target.value) ?? 'all') }}>
        <option value="all">{es ? 'Toda la actividad' : 'All activity'}</option>
        {CATEGORIES.map((category) => <option key={category} value={category}>{LABELS[lang][category]}</option>)}
      </select></label>
    </div>
    <p className="activity-note">{es ? 'Los eventos aparecen al llegar; la voz resume los cambios importantes.' : 'Events appear as they arrive; the voice summarizes meaningful changes.'} {state.broadcastStatus === 'locked' && !replay && (es ? 'Los duelos en vivo y Jev necesitan el enlace autorizado del juego.' : 'Live duels and Jev require the authorized game link.')} {['connecting', 'reconnecting', 'off'].includes(state.broadcastStatus) && (es ? 'Esperando la fuente autorizada.' : 'Waiting for the authorized source.')}</p>
    <div className="activity-grid">
      {rows.map((row) => <article key={row.id} className={`activity-card activity-${row.category}`}>
        <div><b>{LABELS[lang][row.category]}</b><small>{replay ? 'Replay' : state.broadcastStatus === 'demo' ? 'Demo' : row.history ? (es ? 'Historial' : 'History') : 'Live'} · {row.tick ?? '—'}</small></div>
        <p>{row.text}</p>{row.reference && <small>{row.reference}</small>}
      </article>)}
      {rows.length === 0 && <p className="activity-empty">{es ? 'Aún no hay eventos verificados en esta categoría.' : 'No verified events in this category yet.'}</p>}
    </div>
  </section>
}
