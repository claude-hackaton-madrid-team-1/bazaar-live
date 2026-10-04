/**
 * The Prices screen: the live price guide (views/prices.ts). One row per card, recomputed on every batch the
 * stream brings; the stream is a WebSocket unless the page asks for SSE (wsSource.ts), and the header says which.
 * A row that moved this tick flashes once, so a change in the order book or a new fill catches the eye.
 */
import { useMemo, useState } from 'react'
import { fmtP } from '../game.ts'
import { usePriceStrings } from '../priceStrings.ts'
import { useGame } from '../store.ts'
import { priceGuide, type BestQuote, type PriceFocus, type PriceRow } from '../views/prices.ts'
import { Badge, CardRef, Empty, Panel, Seg, Sparkline } from './bits.tsx'
import './prices.css'

function QuoteCell({ q, side }: { q: BestQuote | null; side: 'bid' | 'ask' }) {
  const t = usePriceStrings()
  const { state } = useGame()
  if (!q) return <td className="gm-r gm-muted">—</td>
  const venue = state.venues.get(q.venue)?.name ?? q.venue
  const fee = q.cost !== q.price
  return (
    <td className="gm-r prc-quote" data-side={side}>
      <b>{fmtP(q.price)}</b>
      <span className="gm-muted" title={fee ? t.feeIncluded(fmtP(q.cost)) : undefined}>
        {venue}
        {fee ? ` · ${fmtP(q.cost)}` : ''}
      </span>
    </td>
  )
}

function TrendCell({ r }: { r: PriceRow }) {
  const t = usePriceStrings()
  if (r.trend == null) {
    return (
      <td className="gm-r gm-muted" title={t.fills(r.trades)}>
        {t.noTrend}
      </td>
    )
  }
  const arrow = r.trend === 'up' ? '▲' : r.trend === 'down' ? '▼' : '='
  const pct = r.change == null ? '' : ` ${Math.abs(Math.round(r.change * 100))}%`
  return (
    <td className="gm-r prc-trend" data-trend={r.trend} title={`${t.trend[r.trend]} · ${t.fills(r.trades)}`}>
      {r.spark.length > 1 && <Sparkline values={[...r.spark]} />}
      <span>
        {arrow}
        {pct}
      </span>
    </td>
  )
}

function DealCell({ r }: { r: PriceRow }) {
  const t = usePriceStrings()
  return (
    <td className="prc-deal">
      {r.signal && (
        <Badge tone="good" title={t.signalTitle[r.signal]}>
          {t.signal[r.signal]}
        </Badge>
      )}
      <span className="prc-lines">
        {r.buyUpTo != null && <span data-side="buy">{t.buyUpTo(fmtP(r.buyUpTo))}</span>}
        {r.sellFrom != null && <span data-side="sell">{t.sellFrom(fmtP(r.sellFrom))}</span>}
        {r.buyUpTo == null && r.sellFrom == null && <span className="gm-muted">—</span>}
      </span>
    </td>
  )
}

function Row({ r, tick }: { r: PriceRow; tick: number }) {
  const t = usePriceStrings()
  return (
    // keyed on the tick it last moved: React mounts a new row, and the CSS flash plays once
    <tr className="prc-row" data-signal={r.signal ?? undefined} data-fresh={r.moved === tick || undefined}>
      <td>
        <CardRef code={r.ref} name={r.name} />
        {r.need && <Badge tone={r.need === 'missing' ? 'us' : 'neutral'}>{t.need[r.need]}</Badge>}
      </td>
      <td className="gm-r" title={r.basis === 'book' ? t.basisBook : t.fills(r.trades)}>
        <b>{fmtP(r.standard)}</b>
        {r.basis === 'book' && <span className="gm-muted"> *</span>}
      </td>
      <td className="gm-r">{r.last == null ? <span className="gm-muted">—</span> : fmtP(r.last)}</td>
      <TrendCell r={r} />
      <QuoteCell q={r.bid} side="bid" />
      <QuoteCell q={r.ask} side="ask" />
      <td className="gm-r gm-muted" title={`${t.depth(r.bids + r.asks)}${r.ours ? ` · ${t.ours(r.ours)}` : ''}`}>
        {r.spread == null ? '—' : fmtP(r.spread)}
      </td>
      <td className="gm-r">{r.worth ? (r.worth.estimated ? `~${fmtP(r.worth.value)}` : fmtP(r.worth.value)) : <span className="gm-muted">—</span>}</td>
      <DealCell r={r} />
    </tr>
  )
}

export function PricesScreen() {
  const { state, version, transport } = useGame()
  const t = usePriceStrings()
  const [focus, setFocus] = useState<PriceFocus>('all')
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () => priceGuide(state, { focus, query }),
    // the state is mutated in place: the version is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, version, focus, query],
  )
  const signals = rows.filter((r) => r.signal).length
  return (
    <Panel
      className="prc"
      title={t.title}
      sub={
        <>
          <span className="prc-live" data-transport={transport ?? undefined}>
            ● {t.live(transport, state.tick)}
          </span>{' '}
          · {t.sub}
        </>
      }
      actions={
        <>
          <Seg
            label={t.focusLabel}
            value={focus}
            options={[['all', t.focus.all], ['ours', t.focus.ours], ['signals', `${t.focus.signals}${signals ? ` (${signals})` : ''}`]]}
            onChange={setFocus}
          />
          <input type="search" className="gm-search" placeholder={t.search} aria-label={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>{focus === 'all' && !query ? t.empty : t.emptyFocus}</Empty>
      ) : (
        <div className="gm-scroll gm-scroll-tall">
          <table className="gm-table prc-table">
            <thead>
              <tr>
                <th>{t.cols.card}</th>
                <th className="gm-r">{t.cols.standard}</th>
                <th className="gm-r">{t.cols.last}</th>
                <th className="gm-r">{t.cols.trend}</th>
                <th className="gm-r">{t.cols.bid}</th>
                <th className="gm-r">{t.cols.ask}</th>
                <th className="gm-r">{t.cols.spread}</th>
                <th className="gm-r">{t.cols.worth}</th>
                <th>{t.cols.deal}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={`${r.ref}:${r.moved ?? 0}`} r={r} tick={state.tick} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="gm-sub prc-legend">{t.legend}</p>
    </Panel>
  )
}
