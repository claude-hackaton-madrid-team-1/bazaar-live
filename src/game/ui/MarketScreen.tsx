import { useMemo, useState } from 'react'
import { fmtP } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import {
  cardStats, deltaText, deltaTone, marketTape, orderBook, teamStats, venueRows,
  type CardStat, type Include, type Quote, type TapeRow, type TeamStat, type VenueBook, type VenueRow, type Whose,
} from '../views/market.ts'
import { Badge, CardRef, Empty, EventLink, Panel, Seg, Sparkline } from './bits.tsx'

/** Header cells; the indexes in `right` are numbers, aligned right. */
function Head({ cells, right }: { cells: readonly string[]; right: readonly number[] }) {
  return (
    <thead>
      <tr>
        {cells.map((h, i) => (
          <th key={h} className={right.includes(i) ? 'gm-r' : undefined}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function Tape({ rows, team }: { rows: TapeRow[]; team: string }) {
  const store = useGame()
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.market.noTrades}</Empty>
  const party = (p: string) => <span data-tone={p === team ? 'us' : undefined}>{p}</span>
  return (
    <div className="gm-scroll gm-scroll-tall">
      <table className="gm-table">
        <Head cells={t.market.tapeHead} right={[0, 4, 5, 6]} />
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.eventId}-${r.assetId ?? r.serial}-${r.ref}`} data-ours={r.ours || undefined} aria-selected={store.selected === r.eventId || undefined}>
              <td className="gm-r">{r.tick ?? '—'}</td>
              <td>{r.venue}</td>
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
              <td className="gm-muted">{r.settlementId == null ? '—' : `s${r.settlementId}`}</td>
              <td>
                <EventLink id={r.eventId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CardPrices({ cards }: { cards: CardStat[] }) {
  const t = useGameStrings()
  if (!cards.length) return <Empty>{t.market.noCards}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table">
        <Head cells={t.market.cardHead} right={[1, 2, 3, 4, 5]} />
        <tbody>
          {cards.map((c) => (
            <tr key={c.ref}>
              <td>
                <CardRef code={c.ref} name={c.name} />
              </td>
              <td className="gm-r">{c.trades}</td>
              <td className="gm-r">{fmtP(c.last)}</td>
              <td className="gm-r">{fmtP(c.median)}</td>
              <td className="gm-r">{c.min === c.max ? fmtP(c.min) : `${fmtP(c.min)} – ${fmtP(c.max)}`}</td>
              <td className="gm-r gm-muted">{fmtP(c.book)}</td>
              <td>
                <Sparkline values={c.trend} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Teams({ teams }: { teams: TeamStat[] }) {
  const t = useGameStrings()
  if (!teams.length) return <Empty>{t.market.noTeams}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table">
        <Head cells={t.market.teamHead} right={[1, 2, 3, 4, 5]} />
        <tbody>
          {teams.map((s) => (
            <tr key={s.team}>
              <td>
                <b>{s.team}</b>
              </td>
              <td className="gm-r">{s.trades}</td>
              <td className="gm-r">{fmtP(s.volume)}</td>
              <td className="gm-r">{s.asBuyer}</td>
              <td className="gm-r">{s.asSeller}</td>
              <td className="gm-r gm-muted">{s.lastTick ?? '—'}</td>
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
  if (!q) return <td className="gm-r gm-muted">—</td>
  return (
    <td className="gm-r gm-quote">
      <b>{fmtP(q.price)}</b> <span data-tone={q.maker === team ? 'us' : undefined}>{q.maker}</span>{' '}
      <span className="gm-muted" title={q.age == null ? undefined : t.market.age(q.age)}>
        {q.age == null ? '' : `${q.age}t`}
      </span>
    </td>
  )
}

function OrderBook({ books, team, whose }: { books: VenueBook[]; team: string; whose: Whose }) {
  const t = useGameStrings()
  if (!books.length) return <Empty>{whose === 'ours' ? t.market.noOurOffers : t.market.noOffers}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table gm-book">
        <Head cells={t.market.bookHead} right={[1, 2, 3, 4]} />
        {books.map((v) => (
          <tbody key={v.venue}>
            <tr className="gm-group">
              <td colSpan={5}>
                <b>{v.name}</b>
                {v.owner && <span data-tone={v.owner === team ? 'us' : undefined}> · {v.owner}</span>}
                <span className="gm-muted">
                  {' '}
                  · {t.market.offers(v.offers)}
                  {v.ours > 0 && whose === 'all' && ` · ${t.market.oursCount(v.ours)}`}
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

function Venues({ venues, team }: { venues: VenueRow[]; team: string }) {
  const t = useGameStrings()
  if (!venues.length) return <Empty>{t.market.noVenues}</Empty>
  return (
    <ul className="gm-venues">
      {venues.map((v) => (
        <li key={v.id} data-ours={v.ours || undefined}>
          <div className="gm-venue-head">
            <b>{v.name}</b>
            {v.name !== v.id && <span className="gm-mono gm-muted">{v.id}</span>}
            {v.ours && <Badge tone="us">{t.badge.ours}</Badge>}
            <Badge tone={v.status === 'open' ? 'good' : v.status === 'closing' ? 'warn' : 'neutral'}>{t.market.venueStatus[v.status]}</Badge>
          </div>
          <div className="gm-venue-meta">
            <span>
              {t.market.owner} <span data-tone={v.owner === team ? 'us' : undefined}>{v.owner ?? '—'}</span>
            </span>
            <span>{t.market.offers(v.offers)}</span>
            {(v.feeBps != null || v.feePerCard != null) && <span>{t.market.fee(v.feeBps, v.feePerCard)}</span>}
          </div>
          {v.announcement ? (
            <p className="gm-venue-said" title={t.market.announcements(v.announcements)}>
              “{v.announcement.text}” <span className="gm-muted">t{v.announcement.tick ?? '—'}</span> <EventLink id={v.announcement.eventId} />
            </p>
          ) : (
            <p className="gm-venue-said gm-muted">{t.market.noAnnouncement}</p>
          )}
        </li>
      ))}
    </ul>
  )
}

export function MarketScreen() {
  const { state, version } = useGame()
  const t = useGameStrings()
  const [include, setInclude] = useState<Include>('others')
  const [query, setQuery] = useState('')
  const [whose, setWhose] = useState<Whose>('all')
  const view = useMemo(() => {
    const rows = marketTape(state, { include, query })
    return { rows, volume: rows.reduce((a, r) => a + r.price, 0), cards: cardStats(state, include), teams: teamStats(state, include) }
    // the state is mutated in place: the version is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, version, include, query])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const books = useMemo(() => orderBook(state, { whose }), [state, version, whose])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const venues = useMemo(() => venueRows(state), [state, version])
  const offers = books.reduce((n, b) => n + b.offers, 0)
  const actions = (
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
  )
  return (
    <>
      <div className="gm-book-layout">
        <Panel
          title={t.market.book}
          sub={t.market.bookSub(offers, books.length)}
          actions={
            <Seg
              label={t.market.whose}
              value={whose}
              options={[
                ['all', t.market.everyone],
                ['ours', t.market.ours],
              ]}
              onChange={setWhose}
            />
          }
        >
          <OrderBook books={books} team={state.team} whose={whose} />
        </Panel>
        <Panel title={t.market.venues} sub={t.market.venuesSub(venues.filter((v) => v.status === 'open').length)}>
          <Venues venues={venues} team={state.team} />
        </Panel>
      </div>
      <Panel title={t.market.tape} sub={t.market.tapeSub(view.rows.length, view.volume)} actions={actions}>
        <Tape rows={view.rows} team={state.team} />
      </Panel>
      <div className="gm-two">
        <Panel title={t.market.prices} sub={t.market.pricesSub(view.cards.length)}>
          <CardPrices cards={view.cards} />
        </Panel>
        <Panel title={t.market.teams} sub={t.market.teamsSub(view.teams.length)}>
          <Teams teams={view.teams} />
        </Panel>
      </div>
    </>
  )
}
