/**
 * Our market: the venue we run (its facts, its board now, the matches our broker made, the bench sessions, our
 * announcements) and what people are asking of us on every board, each offer said in one plain line. Our values (and
 * the verdicts read off them) show only with GAME_VIEW_TOKEN.
 */
import { fmtP } from '../game.ts'
import { useOurMarketStrings } from '../ourMarketStrings.ts'
import { useGame } from '../store.ts'
import { askedOfUs, benchRows, brokerMatches, ourVenues, type AskRow, type OurVenue, type VenueOffer } from '../views/our-market.ts'
import { Badge, Empty, EventLink, Panel, RefChip } from './bits.tsx'
import { useLimitsVisible } from './limits.ts'
import './ourMarket.css'

function Rival({ on }: { on: boolean }) {
  const m = useOurMarketStrings()
  if (!on) return null
  return (
    <Badge tone="bad" title={m.rivalTitle}>
      {m.rival}
    </Badge>
  )
}

function Facts({ v, bench }: { v: OurVenue; bench: number | null }) {
  const m = useOurMarketStrings()
  const f = m.facts
  const fact = (label: string, value: string) => (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
  return (
    <>
      <dl className="om-facts">
        {fact(f.status, m.status[v.status])}
        {fact(f.fee, m.fee(v.feeBps, v.feePerCard))}
        {fact(f.bond, fmtP(v.bond))}
        {fact(f.opened, v.openedTick == null ? '—' : m.tick(v.openedTick))}
        {fact(f.trades, String(v.trades))}
        {fact(f.volume, fmtP(v.volume))}
        {fact(f.traders, v.traders.length ? v.traders.join(' · ') : '—')}
        {fact(f.bench, bench == null ? '—' : String(bench))}
      </dl>
      <p className="om-note gm-muted">{m.tapeNote}</p>
    </>
  )
}

function OfferRow({ o }: { o: VenueOffer }) {
  const m = useOurMarketStrings()
  return (
    <li className="om-offer" data-ours={o.ours || undefined}>
      <RefChip topic={o.ref} />
      <span className="gm-mono gm-muted">{o.ref}</span>
      {o.rarity && <span className="om-rarity">{m.rarity[o.rarity]}</span>}
      <b className="om-price">{fmtP(o.price)}</b>
      <span className="gm-mono">{o.maker}</span>
      {o.ours && <Badge tone="us">{m.ours}</Badge>}
      <Rival on={o.rival} />
      {o.expiresIn != null && <span className="gm-muted om-lapse">{m.lapses(o.expiresIn)}</span>}
      <EventLink id={o.eventId} />
    </li>
  )
}

function Side({ title, offers }: { title: string; offers: readonly VenueOffer[] }) {
  if (!offers.length) return null
  return (
    <section className="om-side" aria-label={title}>
      <h3 className="eyebrow">{title}</h3>
      <ul className="om-offers">
        {offers.map((o) => (
          <OfferRow key={o.id} o={o} />
        ))}
      </ul>
    </section>
  )
}

function Board({ v }: { v: OurVenue | null }) {
  const m = useOurMarketStrings()
  if (!v) return <Empty>{m.noVenue}</Empty>
  if (!v.asks.length && !v.bids.length && !v.swaps.length) return <Empty>{m.emptyBoard}</Empty>
  return (
    <div className="om-board">
      <Side title={m.asks} offers={v.asks} />
      <Side title={m.bids} offers={v.bids} />
      <Side title={m.swaps} offers={v.swaps} />
    </div>
  )
}

function AskLine({ r, values }: { r: AskRow; values: boolean }) {
  const m = useOurMarketStrings()
  return (
    <li className="om-ask" data-kind={r.kind}>
      <span className="om-ask-head">
        <Badge tone={r.kind === 'forUs' ? 'warn' : 'neutral'}>{m.kind[r.kind]}</Badge>
        <span className="gm-mono gm-muted">{r.venueName}</span>
        <Rival on={r.rival} />
        <RefChip topic={r.ref} />
        {r.expiresIn != null && <span className="gm-muted om-lapse">{m.lapses(r.expiresIn)}</span>}
        <EventLink id={r.eventId} />
      </span>
      <span className="om-ask-line">{m.askLine(r, values)}</span>
    </li>
  )
}

export function OurMarketScreen() {
  const { state } = useGame()
  const m = useOurMarketStrings()
  const values = useLimitsVisible()
  const v = ourVenues(state)[0] ?? null
  const matches = brokerMatches(state)
  const benches = benchRows(state)
  const asked = askedOfUs(state)
  const count = (kind: AskRow['kind']) => asked.filter((r) => r.kind === kind).length
  const bench = typeof state.score.bench_points === 'number' ? state.score.bench_points : null
  return (
    <>
      <Panel title={v ? v.name : m.title} sub={v ? m.venueSub(v.id, v.mechanism) : undefined} className="om-venue">
        {v ? <Facts v={v} bench={bench} /> : <Empty>{m.noVenue}</Empty>}
      </Panel>
      <div className="gm-split om-split">
        <Panel title={m.board} sub={v ? m.boardSub(v.asks.length, v.bids.length, v.swaps.length) : undefined}>
          <Board v={v} />
        </Panel>
        <Panel title={m.asked} sub={m.askedSub(count('forUs'), count('bidHeld'), count('askMissing'))}>
          {asked.length ? (
            <ul className="om-asks">
              {asked.map((r) => (
                <AskLine key={`${r.venue}-${r.id}`} r={r} values={values} />
              ))}
            </ul>
          ) : (
            <Empty>{m.noAsked}</Empty>
          )}
          {!values && asked.some((r) => r.valueVerdict || r.worth != null) && <p className="om-note gm-muted">{m.valuesHidden}</p>}
        </Panel>
      </div>
      <div className="gm-split om-split">
        <Panel title={m.matches} sub={m.matchesSub(matches.length, matches.filter((x) => x.bench).length)}>
          {matches.length ? (
            <ul className="om-matches">
              {matches.slice(0, 30).map((x) => (
                <li key={x.decision} className="om-match" data-bench={x.bench || undefined}>
                  <span className="gm-muted">{m.tick(x.tick)}</span>
                  <Badge tone={x.bench ? 'neutral' : 'us'}>{x.bench ? m.benchTag : m.liveTag}</Badge>
                  {x.item && !x.item.startsWith('bench:') && <RefChip topic={x.item} />}
                  <span className="gm-mono">{m.match(x)}</span>
                  {x.surplus != null && <span className="gm-muted">{m.surplus(x.surplus)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{m.noMatches}</Empty>
          )}
        </Panel>
        <Panel title={m.benches} sub={m.benchesSub(bench)}>
          {benches.length ? (
            <ul className="om-benches">
              {benches.map((b) => (
                <li key={b.eventId} className="om-bench" data-live={b.live || undefined}>
                  <b>{m.benchLine(b.session, b.startTick, b.endTick)}</b>
                  {b.live && <Badge tone="warn">{m.benchLive}</Badge>}
                  <span className="gm-muted">{b.ours ? m.benchOurs(b.matches, b.surplus) : m.benchNotOurs}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{m.noBenches}</Empty>
          )}
        </Panel>
      </div>
      <Panel title={m.announcements} sub={v?.id}>
        {v?.announcements.length ? (
          <ul className="om-announcements">
            {v.announcements.map((a) => (
              <li key={a.eventId}>
                {a.tick != null && <span className="gm-muted">{m.tick(a.tick)} · </span>}
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{m.noAnnouncements}</Empty>
        )}
      </Panel>
    </>
  )
}
