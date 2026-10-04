import { useState } from 'react'
import type { Lang } from '../../../shared/lang.ts'
import { fmtP } from '../game.ts'
import type { TradingBook, DepthOrder } from '../views/market.ts'
import './trading-order-book.css'

const WORDS = {
  es: {
    title: 'Libro de órdenes observado', owner: 'Propietario', copy: 'Copia', venue: 'Mercado', card: 'Carta', all: 'Todos', bids: 'Compras · bids ↓', asks: 'Ventas · asks ↑',
    price: 'Precio', qty: 'Cant.', order: 'Oferta / equipo', status: 'Estado observado', own: 'Nuestra', open: 'Abierta observada',
    expiry: 'Caduca en turno', unknown: 'Caducidad desconocida', empty: 'Sin órdenes observadas para esta selección.',
    sideEmpty: 'Sin órdenes en este lado.', spread: 'Diferencial público', crossed: 'Precios cruzados', tick: 'Turno',
    note: 'Vista parcial del feed, hasta 400 ofertas retenidas. Cada escalera muestra una carta en un mercado. Precios antes de comisiones; las ofertas observadas pueden haber cambiado.',
    stale: 'Conexión interrumpida o vista pausada: las órdenes pueden haber cambiado.', mock: 'Datos de demostración',
    excluded: 'Ofertas mixtas, lotes o sin precio comparable fuera de la escalera', inspect: 'Inspeccionar oferta', to: 'Para',
    venueStatus: { open: 'Mercado abierto', closing: 'Mercado cerrando', closed: 'Mercado cerrado' }, unknownVenue: 'Estado del mercado desconocido',
  },
  en: {
    title: 'Observed order book', owner: 'Owner', copy: 'Copy', venue: 'Market', card: 'Card', all: 'All', bids: 'Buy orders · bids ↓', asks: 'Sell orders · asks ↑',
    price: 'Price', qty: 'Qty', order: 'Offer / team', status: 'Observed status', own: 'Ours', open: 'Observed open',
    expiry: 'Expires at tick', unknown: 'Expiry unknown', empty: 'No observed orders for this selection.',
    sideEmpty: 'No orders on this side.', spread: 'Public spread', crossed: 'Crossed quotes', tick: 'Tick',
    note: 'Partial feed view, up to 400 retained offers. Each ladder is one card on one market. Prices exclude fees; observed offers may have changed.',
    stale: 'Connection interrupted or view paused: orders may have changed.', mock: 'Demo data',
    excluded: 'Mixed offers, bundles or missing comparable prices excluded from ladders', inspect: 'Inspect offer', to: 'To',
    venueStatus: { open: 'Market open', closing: 'Market closing', closed: 'Market closed' }, unknownVenue: 'Market status unknown',
  },
}

type Props = { book: TradingBook; lang: Lang; tick: number; stale: boolean; mock: boolean; onInspect?: (id: number) => void }

export function TradingOrderBook({ book, lang, tick, stale, mock, onInspect }: Props) {
  const t = WORDS[lang]
  const [venue, setVenue] = useState('')
  const [card, setCard] = useState('')
  const venues = [...new Map(book.ladders.map((g) => [g.venue, g.venueName])).entries()]
  const cards = [...new Set(book.ladders.map((g) => g.ref))].sort()
  const shown = book.ladders.filter((g) => (!venue || g.venue === venue) && (!card || g.ref === card))
  const ladder = (side: 'bid' | 'ask', rows: DepthOrder[]) => (
    <section className="trading-depth-side" data-side={side}>
      <h4>{side === 'bid' ? t.bids : t.asks} <span>{rows.length}</span></h4>
      {rows.length ? <div className="gm-scroll"><table className="gm-table trading-depth-table">
        <thead><tr><th>{t.price}</th><th>{t.qty}</th><th>{t.order}</th><th>{t.status}</th></tr></thead>
        <tbody>{rows.map((o) => <tr key={o.id} data-ours={o.ours || undefined}>
          <td className="trading-depth-price">{fmtP(o.price)}</td><td>{o.quantity}</td>
          <td><button type="button" className="gm-eid" onClick={() => onInspect?.(o.eventId)} title={t.inspect}>#{o.id}</button> · {o.maker}
            {o.ours && <strong className="trading-depth-own">{t.own}</strong>}
            {o.to && <small>{t.to} {o.to}</small>}
            {(o.assetIds.length > 0 || o.wantAssetIds.length > 0) && <small>{t.copy} #{[...o.assetIds, ...o.wantAssetIds].join(', #')}</small>}
          </td>
          <td><small>{t.open}</small><small>{o.expiresTick === null ? t.unknown : `${t.expiry} ${o.expiresTick}`}</small></td>
        </tr>)}</tbody>
      </table></div> : <p className="gm-empty">{t.sideEmpty}</p>}
    </section>
  )
  return <section className="gm-panel material trading-depth" aria-label={t.title}>
    <header className="gm-panel-head"><h2>{t.title} <span className="gm-sub">{t.tick} {tick}{mock ? ` · ${t.mock}` : ''}</span></h2>
      <div className="gm-actions">
        <label>{t.venue} <select value={venue} onChange={(e) => setVenue(e.target.value)}>
          <option value="">{t.all}</option>{venue && !venues.some(([id]) => id === venue) && <option value={venue}>{venue}</option>}{venues.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}
        </select></label>
        <label>{t.card} <select value={card} onChange={(e) => setCard(e.target.value)}>
          <option value="">{t.all}</option>{card && !cards.includes(card) && <option value={card}>{card}</option>}{cards.map((ref) => <option key={ref}>{ref}</option>)}
        </select></label>
      </div>
    </header>
    <p className="trading-depth-note">{t.note}</p>
    {stale && <p className="trading-depth-warning" role="status">{t.stale}</p>}
    {book.excluded > 0 && <p className="trading-depth-note">{t.excluded}: {book.excluded}</p>}
    {!shown.length && <p className="gm-empty">{t.empty}</p>}
    {shown.map((g) => <article key={g.key} className="trading-depth-card">
      <header><h3>{g.ref} <span>{g.venueName} · {g.venue} · {t.owner}: {g.venueOwner ?? '—'}</span></h3>
        <span>{g.venueStatus ? t.venueStatus[g.venueStatus] : t.unknownVenue}</span>
        <strong>{g.spread === null ? `${t.spread}: —` : `${g.spread < 0 ? t.crossed : t.spread}: ${fmtP(g.spread)}`}</strong>
      </header>
      <div className="trading-depth-pair">{ladder('bid', g.bids)}{ladder('ask', g.asks)}</div>
    </article>)}
  </section>
}
