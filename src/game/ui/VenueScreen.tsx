/**
 * The Venue screen: our market-making venue and the Market Test, read from our database (GET /api/venue) and the game
 * stream (a session's start arrives on the stream first). The answer first, in big type: a session on now and how our
 * broker is doing with its book, or the countdown to the next one; then our venue, every session, and other teams on it.
 */
import { useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { BrokerMatch, OurVenue, VenueTrade } from '../../../shared/venue.ts'
import { nameOfRef } from '../cards.ts'
import { MOCK_BENCH } from '../mock.ts'
import { pagePush } from '../fresh.ts'
import { agoText, whoName } from '../humanize.ts'
import type { BenchRun } from '../state.ts'
import { useGame, useWallNow } from '../store.ts'
import { useGameStrings } from '../strings.ts'
import { useVenue } from '../venue.ts'
import { useVenueStrings } from '../venueStrings.ts'
import { DEFAULT_TICKS, type BenchClock } from '../views/venue-clock.ts'
import { activityOf, benchScoreOf, clockOf, madridDay, sessionRows, venueNow, type Activity, type SessionRow, type VenueNow } from '../views/venue.ts'
import { Badge, CardRef, Empty, Fresh, Panel } from './bits.tsx'
import { NoticeBar } from './GameHeader.tsx'
import './venue.css'

/** A start the stream announced in the last two sessions' worth of ticks: before the database has it (older ones it has). */
const freshRuns = (runs: readonly BenchRun[], now: number): BenchRun[] => runs.filter((b) => b.startTick <= now && now - b.startTick <= 2 * DEFAULT_TICKS)

const clockAt = (ms: number): string => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

function Stat({ label, value, tone, title }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn'; title?: string }) {
  return (
    <div className="vn-stat" title={title}>
      <span className="vn-stat-label">{label}</span>
      <b className="vn-stat-value" data-tone={tone}>{value}</b>
    </div>
  )
}

function SessionStats({ row }: { row: SessionRow }) {
  const t = useVenueStrings()
  if (!row.seen) return <p className="vn-hero-line gm-muted">{t.noBook}</p>
  const stopped = row.failed + row.refused + row.expired
  return (
    <div className="vn-stats">
      <Stat label={t.traders} value={t.tradersValue(row.buyers, row.sellers)} />
      <Stat label={t.matched} value={t.matchedValue(row.matched, row.possiblePairs)} tone={row.possiblePairs > 0 && row.matched >= row.possiblePairs ? 'good' : undefined} />
      <Stat
        label={t.captured}
        value={`${t.capturedValue(row.captured, row.possible)}${row.share === null ? '' : ` · ${Math.round(row.share * 100)} %`}`}
        tone={row.share === null ? undefined : row.share >= 0.9 ? 'good' : row.share < 0.6 ? 'warn' : undefined}
        title={t.quotedNote}
      />
      <Stat label={t.stopped} value={t.stoppedValue(row.failed, row.refused, row.expired)} tone={stopped ? 'bad' : undefined} title={row.errors.join(', ') || undefined} />
    </div>
  )
}

function Hero({ clock, rows, tickSeconds, wallNow, venue }: { clock: BenchClock; rows: readonly SessionRow[]; tickSeconds: number; wallNow: number; venue: VenueNow }) {
  const t = useVenueStrings()
  const g = useGameStrings()
  const span = (ticks: number) => g.hum.span(ticks, tickSeconds > 0 ? ticks * tickSeconds : null)
  const running = clock.running
  if (running) {
    const row = rows.find((r) => r.live) ?? null
    const fresh = running.elapsed <= 2
    return (
      <section className="vn-hero material" data-state="live" data-fresh={fresh || undefined} aria-live="polite">
        <span className="eyebrow vn-eyebrow"><span className="vn-pulse" aria-hidden="true" />{t.eyebrow}</span>
        <h1 className="vn-hero-title">{t.liveTitle(running.session)}</h1>
        <p className="vn-hero-sub">{t.left(running.left, span(running.left))}</p>
        <div className="vn-progress" style={{ '--p': `${Math.round((running.elapsed / running.ticks) * 100)}%` } as CSSProperties} role="progressbar" aria-valuemin={0} aria-valuemax={running.ticks} aria-valuenow={running.elapsed} />
        {row?.ours === false && <p className="vn-hero-line gm-bad">{t.notOurs}</p>}
        {venue.warn && <p className="vn-hero-line gm-bad">{t.warn[venue.warn]}</p>}
        {row ? <SessionStats row={row} /> : <p className="vn-hero-line gm-muted">{t.noBook}</p>}
      </section>
    )
  }
  if (!clock.next) {
    return (
      <section className="vn-hero material" data-state="none">
        <span className="eyebrow vn-eyebrow">{t.eyebrow}</span>
        <h1 className="vn-hero-title">{t.noneToday}</h1>
        <p className="vn-hero-sub gm-muted">{t.noneTodaySub}</p>
        {venue.warn && <p className="vn-hero-line gm-bad">{t.warn[venue.warn]}</p>}
      </section>
    )
  }
  const last = rows.find((r) => !r.live) ?? null
  const eta = tickSeconds > 0 ? clockAt(wallNow + clock.next.inTicks * tickSeconds * 1000) : null
  return (
    <section className="vn-hero material" data-state="next">
      <span className="eyebrow vn-eyebrow">{t.eyebrow}</span>
      <h1 className="vn-hero-title">
        {t.nextTitle(clock.next.session)} <span className="vn-count">{t.inTicks(clock.next.inTicks)}</span>
      </h1>
      <p className="vn-hero-sub">{t.eta(span(clock.next.inTicks), eta)}</p>
      {venue.warn && <p className="vn-hero-line gm-bad">{t.warn[venue.warn]}</p>}
      {last && <p className="vn-hero-line">{t.lastResult(last.session, last.matched, last.possiblePairs, last.share, last.efficiency)}</p>}
    </section>
  )
}

function VenueChips({ v }: { v: OurVenue }) {
  const t = useVenueStrings()
  return (
    <span className="vn-chips">
      <Badge tone={v.mechanism === 'board' ? 'good' : v.mechanism === 'auto' ? 'warn' : 'neutral'} title={t.kindTitle(v.mechanism)}>{t.kind(v.mechanism)}</Badge>
      <Badge>{t.fee(v.feeBps, v.feePerCard)}</Badge>
      <Badge tone={v.status === 'open' ? 'good' : v.status === null ? 'neutral' : 'bad'}>{t.status(v.status)}</Badge>
    </span>
  )
}

function OurVenuePanel({ now, score }: { now: VenueNow; score: string }) {
  const t = useVenueStrings()
  const best = now.best
  return (
    <Panel title={t.venueTitle} sub={t.venueSub}>
      {best ? (
        <p className="vn-venue">
          <b className="vn-venue-id gm-mono">{best.venue}</b>
          {best.name && <span className="vn-venue-name">{best.name}</span>}
          <VenueChips v={best} />
          {best.counted && <span className="gm-good vn-counts" title={t.countsTitle}>✓ {t.counts}</span>}
        </p>
      ) : (
        <p className="vn-venue gm-bad">{t.warn.none_open}</p>
      )}
      {best && now.warn && now.warn !== 'none_open' && <p className="vn-line gm-bad">{t.warn[now.warn]}</p>}
      {now.others.map((v) => (
        <p key={v.venue} className="vn-venue vn-venue-other">
          <span className="gm-muted">{t.alsoOpen}</span>
          <b className="gm-mono">{v.venue}</b>
          {v.name && <span className="vn-venue-name">{v.name}</span>}
          <VenueChips v={v} />
        </p>
      ))}
      <p className="vn-line" title={t.scoreTitle}>{score}</p>
    </Panel>
  )
}

function MatchList({ matches }: { matches: readonly BrokerMatch[] }) {
  const t = useVenueStrings()
  return (
    <ol className="vn-matches">
      {[...matches].sort((a, b) => a.tick - b.tick || a.id - b.id).map((m) => (
        <li key={m.id}>
          <span className="gm-mono gm-muted">{m.tick}</span>
          <span>{t.matchLine(m.ask, m.bid, m.price, m.surplus)}</span>
          <Badge tone={m.status === 'done' ? 'good' : m.status === 'approved' ? 'neutral' : 'bad'} title={m.guardrail ?? m.errorCode ?? undefined}>
            {t.matchStatus(m.status)}{m.errorCode ? ` · ${m.errorCode}` : ''}
          </Badge>
        </li>
      ))}
    </ol>
  )
}

function SessionsPanel({ rows, today, fresh }: { rows: readonly SessionRow[]; today: string; fresh: ReactNode }) {
  const t = useVenueStrings()
  return (
    <Panel
      title={t.sessionsTitle}
      sub={
        <>
          {t.sessionsSub}
          {fresh}
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>{t.noSessions}</Empty>
      ) : (
        <div className="vn-table" role="table">
          <div className="vn-row vn-row-head" role="row">
            <span role="columnheader">{t.col.session}</span>
            <span role="columnheader">{t.col.traders}</span>
            <span role="columnheader">{t.col.matched}</span>
            <span role="columnheader">{t.col.stopped}</span>
            <span role="columnheader" title={t.quotedNote}>{t.col.captured}</span>
            <span role="columnheader" title={t.scoreTitle}>{t.col.efficiency}</span>
          </div>
          {rows.map((r) => {
            const stopped = r.failed + r.refused + r.expired
            const body = (
              <>
                <span className="vn-cell-session" role="cell">
                  <b>{t.sessionName(r.session, r.startTick)}</b>
                  {r.day !== today && <span className="gm-muted"> {t.earlierDay(r.day)}</span>}
                  {r.live && <Badge tone="bad">● {t.liveTag}</Badge>}
                  {r.ours === false && <Badge tone="bad">{t.notOursRow}</Badge>}
                </span>
                <span role="cell" data-label={t.col.traders}>{r.seen ? t.tradersValue(r.buyers, r.sellers) : <span className="gm-muted">{t.noBookRow}</span>}</span>
                <span role="cell" data-label={t.col.matched}>{r.seen ? t.matchedValue(r.matched, r.possiblePairs) : '—'}</span>
                <span role="cell" data-label={t.col.stopped} className={stopped ? 'gm-bad' : 'gm-muted'} title={r.errors.join(', ') || undefined}>{stopped || '—'}</span>
                <span role="cell" data-label={t.col.captured}>
                  {r.seen ? `${t.capturedValue(r.captured, r.possible)}${r.share === null ? '' : ` · ${Math.round(r.share * 100)} %`}` : '—'}
                </span>
                <span role="cell" data-label={t.col.efficiency} className="vn-eff">
                  {r.efficiency === null ? <span className="gm-muted">{r.live ? '…' : t.pending}</span> : <b>{Math.round(r.efficiency * 100)} %</b>}
                </span>
              </>
            )
            return r.matches.length ? (
              <details key={r.key} className="vn-row-wrap" data-live={r.live || undefined} open={r.live || undefined}>
                <summary className="vn-row" role="row">{body}</summary>
                <div className="vn-row-detail">
                  <span className="gm-muted">{t.matchesOf(r.matches.length)}</span>
                  <MatchList matches={r.matches} />
                </div>
              </details>
            ) : (
              <div key={r.key} className="vn-row-wrap" data-live={r.live || undefined}>
                <div className="vn-row" role="row">{body}</div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function OthersPanel({ a, venue }: { a: Activity; venue: string | null }) {
  const t = useVenueStrings()
  const g = useGameStrings()
  const store = useGame()
  const who = (id: string | null) => (id ? whoName(g, id) : '?')
  const line = (x: VenueTrade) =>
    x.type === 'settled' ? t.sold(who(x.seller), who(x.buyer), x.price) : t.listedLine(who(x.maker), x.side, x.price)
  return (
    <Panel title={t.othersTitle} sub={t.othersSub}>
      <p className="vn-line vn-others-head" title={t.organicNote}>
        {a.settled + a.listed === 0 ? t.othersNone(venue ?? '—') : t.othersHead(a.settled, a.teams, a.volume, a.listed)}
      </p>
      {a.latest.length > 0 && (
        <ul className="vn-trades">
          {a.latest.map((x) => (
            <li key={x.id} data-type={x.type}>
              {x.card ? <CardRef code={x.card} name={nameOfRef(x.card) ?? undefined} /> : <span />}
              <span>{line(x)}</span>
              <span className="gm-muted vn-ago">{agoText(g, store.state, x.tick, store.state.tick)}</span>
            </li>
          ))}
        </ul>
      )}
      {a.brokered + a.brokerStopped > 0 && <p className="vn-line gm-muted">{t.brokered(a.brokered, a.brokerStopped)}</p>}
    </Panel>
  )
}

export function VenueScreen() {
  const store = useGame()
  const t = useVenueStrings()
  const wallNow = useWallNow(1000)
  const today = madridDay(wallNow)
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])
  const push = pagePush(store.status, store.state, 'venue')
  const now = store.state.tick
  const runs = freshRuns(store.state.bench, now)
  const latestRun = runs.at(-1)
  // a start the stream just announced reads the database at once; a session on keeps the timer short
  const wake = latestRun ? `${latestRun.session ?? ''}:${latestRun.startTick}` : ''
  const running = latestRun !== undefined && now < latestRun.startTick + latestRun.ticks
  const { status, snapshot } = useVenue(store.status === 'mock', token, now, today, push, wake, running)
  const v = useMemo(() => {
    const clock = clockOf(snapshot, runs, today, now, status === 'mock' ? MOCK_BENCH.cadence : undefined)
    return {
      clock,
      rows: sessionRows(snapshot, runs, today, now),
      venue: venueNow(snapshot.venues),
      activity: activityOf(snapshot, today),
      score: benchScoreOf(snapshot.score),
    }
    // runs is rebuilt every render from the stream; its starts are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, wake, today, now, status])
  const live = v.clock.running !== null
  useEffect(() => {
    if (!live) return
    const before = document.title
    document.title = `● ${t.eyebrow} · ${before}`
    return () => {
      document.title = before
    }
  }, [live, t.eyebrow])
  const missingParts = Object.entries(snapshot.parts).filter(([, ok]) => !ok).map(([k]) => k)
  return (
    <>
      {status !== 'live' && status !== 'mock' && <NoticeBar>{t.notice[status]}</NoticeBar>}
      {status === 'live' && missingParts.length > 0 && <NoticeBar>{`${missingParts.join(', ')}: ${t.missingView}`}</NoticeBar>}
      <Hero clock={v.clock} rows={v.rows} tickSeconds={store.state.tickSeconds} wallNow={wallNow} venue={v.venue} />
      <OurVenuePanel now={v.venue} score={t.score(v.score)} />
      <SessionsPanel rows={v.rows} today={today} fresh={<Fresh page="venue" status={status} at={snapshot.at} push={push} />} />
      <OthersPanel a={v.activity} venue={v.venue.best?.venue ?? null} />
    </>
  )
}
