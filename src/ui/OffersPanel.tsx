import { useEffect, useState } from 'react'
import type { GameFeedStatus } from '../game/feed'
import { useLang } from './lang'
import type { OffersView } from './offers'
import './offers.css'

const ALLIANCE = new Set(['v05', 'v15', 'v28'])

export function OffersPanel({ view, status, replay = false }: { view: OffersView; status: GameFeedStatus | 'demo'; replay?: boolean }) {
  const es = useLang() === 'es'
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])
  const locked = status === 'locked' || status === 'off' || replay
  const stale = status !== 'demo' && (status !== 'live' || view.receivedAt === null || now - view.receivedAt > 60_000)
  const label = replay ? (es ? 'Grabación' : 'Replay') : status === 'demo' ? 'Demo' : locked ? (es ? 'Protegido' : 'Locked') : stale ? (es ? 'Sin datos recientes' : 'Waiting for fresh data') : (es ? 'En directo' : 'Live')
  const stateLabels = es ? { open: 'Publicada · abierta', expired: 'Caducada', cancelled: 'Cancelada', unknown: 'Ya no abierta · resultado desconocido' } : { open: 'Posted · open', expired: 'Expired', cancelled: 'Cancelled', unknown: 'No longer open · outcome unknown' }
  const groups = locked ? [] : view.groups
  return (
    <section className="offers-panel material" aria-labelledby="our-offers-title">
      <header className="offers-heading">
        <div><p className="eyebrow">{es ? 'Dónde estamos negociando' : 'Where we are trading'}</p><h2 id="our-offers-title">{es ? 'Nuestras ofertas' : 'Our posted offers'}</h2></div>
        <span className="offers-status" data-stale={stale}>{label}{!locked && view.tick !== null ? ` · tick ${view.tick}` : ''}</span>
      </header>
      <p className="offers-note">{es ? 'Alianza: v05 · v15 · v28. Publicar no significa vender; solo una liquidación confirma el trato.' : 'Alliance: v05 · v15 · v28. Posting is not a sale; only settlement confirms a trade.'}</p>
      {locked ? <p>{es ? 'Las ofertas requieren la vista de equipo autenticada. No se muestran datos privados aquí.' : 'Offers require the authenticated team view. No private data is shown here.'}</p> : <>
        {stale && <p role="status">{es ? 'Último estado conocido; no confirma que estas ofertas sigan abiertas.' : 'Last known state; these offers are not confirmed open now.'}</p>}
        {!groups.length && <p>{es ? 'Todavía no se han observado ofertas nuestras en esta conexión.' : 'No offers of ours have been observed in this connection yet.'}</p>}
        <div className="offers-groups">{groups.map((group) => <article className="offers-market" key={group.id}>
          <h3>{group.name !== group.id ? `${group.name} · ` : ''}{group.id} {ALLIANCE.has(group.id) && <small>{es ? 'Alianza' : 'Alliance'}</small>}</h3>
          <p className="offers-note">{es ? 'Propietario' : 'Owner'}: {group.owner ?? '—'}</p>
          <ul>{group.rows.map((row) => <li key={row.id} data-status={row.status}>
            <div className="offer-summary"><strong>{row.side === 'ask' ? (es ? 'Venta' : 'Sell') : row.side === 'bid' ? (es ? 'Compra' : 'Buy') : (es ? 'Intercambio' : 'Swap')} · {row.ref}</strong><b>{row.price === null ? '—' : `${row.price} P`}</b></div>
            <div className="offer-meta"><span>#{row.id} · {row.maker} → {row.to ?? (es ? 'cualquier equipo' : 'any team')}</span><span>{stateLabels[row.status]}</span></div>
            <div className="offer-meta"><span>{es ? 'Publicada en tick' : 'Posted at tick'} {row.createdTick ?? '—'}</span><span>{es ? 'Caduca en tick' : 'Expires at tick'} {row.expiresTick ?? '—'}</span></div>
          </li>)}</ul>
        </article>)}</div>
        {view.trades.length > 0 && <details className="offers-settled"><summary>{es ? 'Últimos tratos liquidados' : 'Latest confirmed settlements'}</summary><ul>{view.trades.map((trade) => <li key={`${trade.eventId}:${trade.assetId}:${trade.ref}`}>{trade.seller} → {trade.buyer} · {trade.ref} · {trade.price} P · {trade.venue} · tick {trade.tick ?? '—'}</li>)}</ul></details>}
      </>}
    </section>
  )
}
