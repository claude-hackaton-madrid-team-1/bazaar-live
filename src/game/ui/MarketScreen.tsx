import { useMemo, useState } from 'react'
import type { DecisionStatus } from '../../../shared/decisions.ts'
import { agentName, ruleName, spanText, whoName } from '../humanize.ts'
import { fmtP, signed } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import {
  deltaText, deltaTone, marketTape, opportunities, orderBook, ourOffers, venueRows, watchPrices,
  type Include, type Opportunity, type OurOffer, type Quote, type TapeRow, type VenueBook, type VenueRow, type WatchRow, type Worth,
} from '../views/market.ts'
import { Badge, CardRef, Empty, EventLink, Panel, Seg } from './bits.tsx'

/** Header cells; the indexes in `right` are numbers, aligned right. */
function Head({ cells, right }: { cells: readonly string[]; right: readonly number[] }) {
  return (
    <thead>
      <tr>
        {cells.map((h, i) => (
          <th key={`${i}-${h}`} className={right.includes(i) ? 'gm-r' : undefined}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  )
}

/** A value to us: "~" and a title when it is our estimate (a card we do not hold). */
function WorthText({ worth }: { worth: Worth | null }) {
  const t = useGameStrings()
  if (!worth) return <span className="gm-muted">—</span>
  return <span title={worth.estimated ? t.market.estimated : undefined}>{worth.estimated ? `~${fmtP(worth.value)}` : fmtP(worth.value)}</span>
}


// ---------------------------------------------------------------- right now for us

function Opp({ o, tickSeconds }: { o: Opportunity; tickSeconds: number }) {
  const t = useGameStrings()
  const store = useGame()
  return (
    <li className="mkt-opp" data-side={o.side} data-untaken={o.untaken || undefined} aria-selected={store.selected === o.eventId || undefined}>
      <div className="mkt-opp-card">
        <CardRef code={o.ref} name={o.name} />
        <Badge tone={o.need === 'missing' ? 'us' : 'neutral'}>{t.market.need[o.need]}</Badge>
        {o.completes && (
          <Badge tone="good" title={t.market.completesTitle}>
            {t.market.completes[o.completes]}
          </Badge>
        )}
        {o.forUs && (
          <Badge tone="good" title={t.market.forUsTitle}>
            {t.market.forUs}
          </Badge>
        )}
      </div>
      <b className="mkt-net" title={t.market.netTitle}>
        {signed(o.net)}
      </b>
      <div className="mkt-opp-meta">
        <span>
          {o.side === 'buy' ? t.market.pay : t.market.get} <b>{fmtP(o.price)}</b>
        </span>
        <span>
          {t.market.worth} <b><WorthText worth={{ value: o.value, estimated: o.estimated }} /></b>
        </span>
        <span>{t.market.from(whoName(t, o.maker), o.venueName)}</span>
        {o.expiresIn != null && <span data-soon={o.expiresIn <= 2 || undefined}>⏱ {t.market.expiresIn(o.expiresIn, o.expiresIn * tickSeconds)}</span>}
        {o.more > 0 && <span className="gm-muted">{t.market.more(o.more)}</span>}
        <EventLink id={o.eventId}>↗</EventLink>
      </div>
      {o.untaken && o.age != null && (
        <p className="mkt-flag">
          <span>
            <span aria-hidden="true">⚑</span> {t.market.untaken(o.age)}
          </span>
          <span className="mkt-flag-why">{o.agent ? t.market.agentSaid(agentName(t, o.agent.agent), t.decide.status[o.agent.status as DecisionStatus] ?? o.agent.status, o.agent.rule ? ruleName(t, o.agent.rule) : null) : t.market.noAgent}</span>
        </p>
      )}
    </li>
  )
}

function Side({ side, rows, tickSeconds, foot }: { side: 'buy' | 'sell'; rows: Opportunity[]; tickSeconds: number; foot?: string }) {
  const t = useGameStrings()
  return (
    <section className="mkt-side" data-side={side}>
      <h3 className="mkt-side-head">
        {side === 'buy' ? t.market.buy : t.market.sell}
        <span className="mkt-side-n">{rows.length}</span>
        <span className="mkt-side-hint">{side === 'buy' ? t.market.buyHint : t.market.sellHint}</span>
      </h3>
      {rows.length ? (
        <ul className="mkt-opps">
          {rows.map((o) => (
            <Opp key={o.offerId} o={o} tickSeconds={tickSeconds} />
          ))}
        </ul>
      ) : (
        <Empty>{side === 'buy' ? t.market.noBuy : t.market.noSell}</Empty>
      )}
      {foot && <p className="mkt-foot">{foot}</p>}
    </section>
  )
}

// ---------------------------------------------------------------- ours: offers and prices

function OurOffers({ rows, tickSeconds }: { rows: OurOffer[]; tickSeconds: number }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.market.noOffers}</Empty>
  return (
    <ul className="mkt-mine">
      {rows.map((o) => (
        <li key={o.offerId}>
          <Badge tone={o.side === 'ask' ? 'them' : 'us'}>{o.side === 'ask' ? t.market.weSell : t.market.weBuy}</Badge>
          <CardRef code={o.ref} />
          <span className="mkt-mine-meta">
            <b>{fmtP(o.price)}</b>
            <span className="gm-muted">
              {t.market.worth} <WorthText worth={o.worth} />
            </span>
            <span className="gm-muted">{o.venueName}</span>
            {o.expiresIn != null && <span data-soon={o.expiresIn <= 2 || undefined}>⏱ {t.market.expiresIn(o.expiresIn, o.expiresIn * tickSeconds)}</span>}
            {o.beatenBy != null ? (
              <Badge tone="warn">{t.market.beatenBy(fmtP(o.beatenBy))}</Badge>
            ) : (
              <Badge tone={o.best == null ? 'neutral' : 'good'}>{o.best == null ? t.market.alone : t.market.bestPrice}</Badge>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function OurPrices({ rows }: { rows: WatchRow[] }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.market.noOurPrices}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table mkt-prices">
        <Head cells={t.market.priceHead} right={[1, 2, 3, 4]} />
        <tbody>
          {rows.map((c) => (
            <tr key={c.ref}>
              <td>
                <CardRef code={c.ref} name={c.name} /> <Badge tone={c.need === 'missing' ? 'us' : 'neutral'}>{t.market.need[c.need]}</Badge>
              </td>
              <td className="gm-r">
                <WorthText worth={c.worth} />
              </td>
              <td className="gm-r">
                <b>{fmtP(c.last)}</b>
              </td>
              <td className="gm-r">{fmtP(c.median)}</td>
              <td className="gm-r gm-muted">{c.min === c.max ? fmtP(c.min) : `${fmtP(c.min)} – ${fmtP(c.max)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- everything else, behind the toggle

function Tape({ rows, team }: { rows: TapeRow[]; team: string }) {
  const store = useGame()
  const venueName = (id: string) => store.state.venues.get(id)?.name ?? id
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.market.noTrades}</Empty>
  const party = (p: string) => <span data-tone={p === team ? 'us' : undefined}>{whoName(t, p)}</span>
  return (
    <div className="gm-scroll gm-scroll-tall">
      <table className="gm-table">
        <Head cells={t.market.tapeHead} right={[0, 4, 5, 6]} />
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.eventId}-${r.assetId ?? r.serial}-${r.ref}`} data-ours={r.ours || undefined} aria-selected={store.selected === r.eventId || undefined}>
              <td className="gm-r">{r.tick ?? '—'}</td>
              <td>{venueName(r.venue)}</td>
              <td>
                {party(r.seller)} <span className="gm-muted">→</span> {party(r.buyer)}
              </td>
              <td>
                <CardRef code={r.ref} name={r.name} />
              </td>
              <td className="gm-r">{fmtP(r.price)}</td>
              <td className={`gm-r ${deltaTone(r.delta) ? `gm-${deltaTone(r.delta)}` : ''}`} title={r.book == null ? t.market.noBook : t.market.bookPrice(fmtP(r.book))}>
                {deltaText(r.delta)}
              </td>
              <td className="gm-r">{r.fee ? fmtP(r.fee) : <span className="gm-muted">—</span>}</td>
              <td>
                <EventLink id={r.eventId}>↗</EventLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The best offer on one side: price, maker and age, or a dash. */
function QuoteCell({ q, team }: { q: Quote | null; team: string }) {
  const t = useGameStrings()
  const { state } = useGame()
  if (!q) return <td className="gm-r gm-muted">—</td>
  return (
    <td className="gm-r gm-quote">
      <b>{fmtP(q.price)}</b> <span data-tone={q.maker === team ? 'us' : undefined}>{whoName(t, q.maker)}</span>{' '}
      <span className="gm-muted" title={q.age == null ? undefined : t.market.age(q.age)}>
        {q.age == null ? '' : spanText(t, state, q.age)}
      </span>
    </td>
  )
}

function OrderBook({ books, team }: { books: VenueBook[]; team: string }) {
  const t = useGameStrings()
  if (!books.length) return <Empty>{t.market.noOffers}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table gm-book">
        <Head cells={t.market.bookHead} right={[1, 2, 3, 4]} />
        {books.map((v) => (
          <tbody key={v.venue}>
            <tr className="gm-group">
              <td colSpan={5}>
                <b>{v.name}</b>
                {v.owner && <span data-tone={v.owner === team ? 'us' : undefined}> · {whoName(t, v.owner)}</span>}
                <span className="gm-muted">
                  {' '}
                  · {t.market.offers(v.offers)}
                  {v.ours > 0 && ` · ${t.market.oursCount(v.ours)}`}
                </span>
              </td>
            </tr>
            {v.rows.map((r) => (
              <tr key={r.ref} data-ours={r.bid?.ours || r.ask?.ours || undefined}>
                <td>
                  <CardRef code={r.ref} />
                </td>
                <QuoteCell q={r.bid} team={team} />
                <QuoteCell q={r.ask} team={team} />
                <td className="gm-r">
                  {r.bids} / {r.asks}
                </td>
                <td className="gm-r gm-muted">{fmtP(r.book)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

/** One line per venue: name, owner, open offers, fee; the status only when it is not open. */
function Venues({ venues, team }: { venues: VenueRow[]; team: string }) {
  const t = useGameStrings()
  if (!venues.length) return <Empty>{t.market.noVenues}</Empty>
  return (
    <ul className="mkt-venues">
      {venues.map((v) => (
        <li key={v.id} data-ours={v.ours || undefined} title={v.announcement ? `“${v.announcement.text}”` : undefined}>
          <b>{v.name}</b>
          <span className="gm-muted">
            {v.owner && <span data-tone={v.owner === team ? 'us' : undefined}>{whoName(t, v.owner)} · </span>}
            {t.market.offers(v.offers)}
            {(v.feeBps != null || v.feePerCard != null) && ` · ${t.market.fee(v.feeBps, v.feePerCard)}`}
          </span>
          {v.status !== 'open' && <Badge tone={v.status === 'closing' ? 'warn' : 'neutral'}>{t.market.venueStatus[v.status]}</Badge>}
        </li>
      ))}
    </ul>
  )
}

function AllActivity() {
  const { state, version } = useGame()
  const t = useGameStrings()
  const [include, setInclude] = useState<Include>('others')
  const [query, setQuery] = useState('')
  // the state is mutated in place: the version is what changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => marketTape(state, { include, query }), [state, version, include, query])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const books = useMemo(() => orderBook(state), [state, version])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const venues = useMemo(() => venueRows(state), [state, version])
  const offers = books.reduce((n, b) => n + b.offers, 0)
  const volume = rows.reduce((a, r) => a + r.price, 0)
  return (
    <>
      <div className="gm-book-layout">
        <Panel title={t.market.book} sub={t.market.bookSub(offers, books.length)}>
          <OrderBook books={books} team={state.team} />
        </Panel>
        <Panel title={t.market.venues} sub={t.market.venuesSub(venues.filter((v) => v.status === 'open').length)}>
          <Venues venues={venues} team={state.team} />
        </Panel>
      </div>
      <Panel
        title={t.market.tape}
        sub={t.market.tapeSub(rows.length, volume)}
        actions={
          <>
            <Seg
              label={t.market.which}
              value={include}
              options={[
                ['others', t.market.others],
                ['all', t.market.all],
              ]}
              onChange={setInclude}
            />
            <input type="search" className="gm-search" placeholder={t.market.search} aria-label={t.market.searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} />
          </>
        }
      >
        <Tape rows={rows} team={state.team} />
      </Panel>
    </>
  )
}

export function MarketScreen() {
  const { state, version } = useGame()
  const t = useGameStrings()
  const [all, setAll] = useState(false)
  const view = useMemo(
    () => ({ opps: opportunities(state), mine: ourOffers(state), prices: watchPrices(state) }),
    // the state is mutated in place: the version is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, version],
  )
  const { opps, mine, prices } = view
  const untaken = [...opps.buy, ...opps.sell].filter((o) => o.untaken).length
  const boardSize = [...state.book.values()].reduce((n, o) => n + o.size, 0)
  return (
    <>
      <Panel
        className="mkt-now"
        title={t.market.now}
        sub={
          <>
            {t.market.nowSub(opps.buy.length, opps.sell.length)}
            {untaken > 0 && <span className="mkt-untaken"> · ⚑ {t.market.untakenSub(untaken)}</span>}
          </>
        }
      >
        <div className="mkt-sides">
          <Side side="buy" rows={opps.buy} tickSeconds={state.tickSeconds} foot={opps.overCash ? t.market.overCash(opps.overCash, fmtP(opps.cash)) : undefined} />
          <Side side="sell" rows={opps.sell} tickSeconds={state.tickSeconds} />
        </div>
      </Panel>
      <div className="gm-two">
        <Panel title={t.market.ourOffers} sub={t.market.ourOffersSub(mine.length)}>
          <OurOffers rows={mine} tickSeconds={state.tickSeconds} />
        </Panel>
        <Panel title={t.market.ourPrices} sub={t.market.ourPricesSub(prices.rows.length, prices.untraded)}>
          <OurPrices rows={prices.rows} />
        </Panel>
      </div>
      <button type="button" className="gm-btn mkt-toggle" aria-expanded={all} onClick={() => setAll((v) => !v)}>
        <span aria-hidden="true">{all ? '▾' : '▸'}</span> {all ? t.market.hideAll : t.market.showAll}
        <span className="gm-sub">{t.market.allSub(boardSize, state.tape.length, state.venues.size)}</span>
      </button>
      {all && <AllActivity />}
    </>
  )
}
