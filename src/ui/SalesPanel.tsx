import type { GameFeedStatus } from '../game/feed'
import type { TeamSide } from '../game/teamThreads'
import { useLang } from './lang'
import type { SalesConversation } from './sales'
import './offers.css'

const terms = (side: TeamSide) => [side.cash ? `${side.cash} P` : '', ...side.cards].filter(Boolean).join(' + ') || '—'

export function SalesPanel({ threads, status, replay = false }: { threads: readonly SalesConversation[]; status: GameFeedStatus | 'demo'; replay?: boolean }) {
  const es = useLang() === 'es'
  if (status === 'locked' || status === 'off' || replay) return null
  return <section className="offers-panel material" aria-label={es ? 'Conversaciones de ventas' : 'Sales conversations'}>
    <header className="offers-heading"><h2>{es ? 'Agente de ventas · conversaciones' : 'Sales agent · conversations'}</h2><span className="offers-status">{status === 'demo' ? 'Demo' : status === 'live' ? (es ? 'En directo' : 'Live') : (es ? 'Último estado conocido' : 'Last known state')}</span></header>
    <p className="offers-note">{es ? 'Mensajes registrados y términos estructurados. Una propuesta no es un trato liquidado. Las palabras del rival se muestran sin ejecutarlas ni darles voz.' : 'Recorded messages and structured terms. A proposal is not a settled trade. Rival words are displayed without executing or voicing them.'}</p>
    {!threads.length && <p>{es ? 'Todavía no hay conversaciones de equipo observadas.' : 'No team conversations observed yet.'}</p>}
    <div className="offers-groups">{threads.map((thread) => <article className="offers-market" key={thread.id}>
      <h3>{thread.sales ? (es ? 'Ventas' : 'Sales') : (es ? 'Nuestro equipo' : 'Our team')} ↔ {thread.with}</h3>
      <p className="offers-note">#{thread.id} · {thread.venue ?? (es ? 'mercado no registrado' : 'market not recorded')} · {thread.status === 'open' ? (es ? 'abierta' : 'open') : (es ? 'cerrada, no confirma venta' : 'closed, not proof of sale')} · tick {thread.lastTick ?? '—'}</p>
      {thread.messages.length > 0 && <ul>{thread.messages.map((message) => <li key={message.id}><strong>{message.ours && thread.sales ? (es ? 'Ventas' : 'Sales') : message.sender}</strong> <small>· tick {message.tick ?? '—'}</small><p>{message.text ?? (es ? 'El feed no incluye las palabras de este mensaje.' : 'The feed does not include the words of this message.')}</p></li>)}</ul>}
      {thread.offers.slice(-3).map((offer) => <div className="sales-terms" key={offer.eventId}><b>{es ? 'Propuesta' : 'Proposal'} · {offer.side === 'us' ? (es ? 'nuestra' : 'ours') : thread.with}</b><p>{es ? 'Da' : 'Gives'}: {terms(offer.give)}<br />{es ? 'Pide' : 'Wants'}: {terms(offer.want)}</p><small>tick {offer.tick ?? '—'} · {es ? 'caduca' : 'expires'} {offer.expiresTick ?? '—'}</small></div>)}
    </article>)}</div>
  </section>
}
