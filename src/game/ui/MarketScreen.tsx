import { useMemo, useState } from 'react'
import { fmtP } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { cardStats, deltaText, deltaTone, marketTape, teamStats, type CardStat, type Include, type TapeRow, type TeamStat } from '../views/market.ts'
import { CardRef, Empty, EventLink, Panel, Seg, Sparkline } from './bits.tsx'

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

export function MarketScreen() {
  const { state, version } = useGame()
  const t = useGameStrings()
  const [include, setInclude] = useState<Include>('others')
  const [query, setQuery] = useState('')
  const view = useMemo(() => {
    const rows = marketTape(state, { include, query })
    return { rows, volume: rows.reduce((a, r) => a + r.price, 0), cards: cardStats(state, include), teams: teamStats(state, include) }
    // the state is mutated in place: the version is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, version, include, query])
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
