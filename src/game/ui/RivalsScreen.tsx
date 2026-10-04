/**
 * The Rivals screen: who is ahead, who holds the cards we need, and one team's album as far as the public feed shows it
 * (GET /api/rivals). The answer first (the cards we need and who has them), then the standings, then the album of the
 * team picked there. A card we never saw a team hold is drawn as unknown, never as missing.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { setParam, useParam } from '../../ui/route'
import { pagePush, type PagePush } from '../fresh.ts'
import { agoText, whoName } from '../humanize.ts'
import { useRivals } from '../rivals.ts'
import { useRivalStrings } from '../rivalStrings.ts'
import { SETS } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { nowTick } from '../views/decisions.ts'
import { albumCounts, compareAlbums, inviteRows, needRows, needsOf, pickTeam, teamRows, type AlbumCounts, type ComparedPage, type InviteRow, type NeedRow, type OurSlot, type RivalSlot, type TeamRow } from '../views/rivals.ts'
import { Badge, CardRef, Empty, Fresh, Panel } from './bits.tsx'
import { NoticeBar } from './GameHeader.tsx'
import { Ago } from './words.tsx'
import './rivals.css'

/** Holders shown per card before "+N more". */
const HOLDERS_SHOWN = 6

function SetName({ set }: { set: string }) {
  const s = SETS[set]
  return (
    <span className="rv-set" title={s?.name ?? set}>
      <i className="gm-swatch" style={{ background: s?.color ?? 'var(--text-3)' }} />
      <span className="rv-set-name">{s?.name ?? set}</span>
    </span>
  )
}

function NeedCard({ n, onPick }: { n: NeedRow; onPick: (team: string) => void }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  const shown = n.holders.slice(0, HOLDERS_SHOWN)
  return (
    <li className="rv-need">
      <div className="rv-need-what">
        <CardRef code={n.ref} name={n.name ?? undefined} />
        <span className="gm-muted">
          {t.rarity(n.rarity)} · {t.page(n.page, n.have, n.of)}
        </span>
      </div>
      {n.holders.length ? (
        <ul className="rv-holders" aria-label={n.name ?? n.ref}>
          {shown.map((h) => (
            <li key={h.team}>
              <button type="button" className="rv-holder" onClick={() => onPick(h.team)} title={t.pick}>
                <b>{whoName(g, h.team)}</b>
                {h.copies > 1 && <span className="rv-copies">{t.copies(h.copies)}</span>}
                <span className="rv-how">
                  {t.how[h.how]} · <Ago tick={h.since} />
                  {h.seen > h.since && (
                    <>
                      {' · '}
                      {t.seenLast} <Ago tick={h.seen} />
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
          {n.holders.length > shown.length && <li className="gm-muted rv-more">{t.more(n.holders.length - shown.length)}</li>}
        </ul>
      ) : (
        <p className="rv-nobody">{t.nobody}</p>
      )}
      {(n.chasers.length > 0 || n.dealers.length > 0) && (
        <p className="rv-chase">
          {n.chasers.length > 0 && (
            <>
              <span className="rv-chase-head">{t.chasing}</span>{' '}
              {n.chasers.map((c, i) => (
                <span key={c.team} className="rv-chaser">
                  {i > 0 && ', '}
                  <b>{whoName(g, c.team)}</b> ({c.topBid !== null ? t.bid(c.topBid) : t.asksDealer}, <Ago tick={c.last} />)
                </span>
              ))}
            </>
          )}
          {n.dealers.length > 0 && <span className="gm-muted"> {t.dealers(n.dealers.map((d) => whoName(g, d)).join(', '))}</span>}
        </p>
      )}
    </li>
  )
}

function Standings({ rows, selected, onPick }: { rows: TeamRow[]; selected: string | null; onPick: (team: string) => void }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  if (!rows.length) return <Empty>{t.noTeam}</Empty>
  return (
    <div className="rv-table">
      <div className="rv-row rv-row-head" aria-hidden="true">
        <span>{t.col.rank}</span>
        <span>{t.col.team}</span>
        <span>{t.col.score}</span>
        <span title={t.pagesTitle}>{t.col.pages}</span>
        <span title={t.oursTitle}>{t.col.ours}</span>
        <span className="rv-col-chase">{t.col.chases}</span>
      </div>
      <ol className="rv-rows">
        {rows.map((r) => {
          const cells = (
            <>
              <span className="gm-mono">{r.rank}</span>
              <span className="rv-team" title={r.us ? whoName(g, r.team) : undefined}>
                {r.us ? t.us : whoName(g, r.team)}
              </span>
              <span className="gm-mono">{r.score.toFixed(1)}</span>
              <span className="gm-mono" title={t.pagesTitle}>{r.pages ?? '—'}</span>
              <span className="gm-mono rv-ours" data-some={r.holdsNeeds > 0 || undefined} title={r.us ? undefined : t.holdsOurs(r.holdsNeeds)}>
                {r.us ? '' : r.holdsNeeds}
              </span>
              <span className="rv-col-chase">
                {r.chases && <SetName set={r.chases} />}
                {r.rival && <Badge tone="warn" title={t.sameSetTitle}>{t.sameSet}</Badge>}
              </span>
            </>
          )
          return (
            <li key={r.team}>
              {r.us ? (
                <div className="rv-row" data-us>
                  {cells}
                </div>
              ) : (
                <button type="button" className="rv-row" aria-pressed={r.team === selected} onClick={() => onPick(r.team)} title={t.pick}>
                  {cells}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Cell({ c, probable }: { c: RivalSlot; probable: boolean }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  const { state } = useGame()
  const style = { '--r': c.color } as CSSProperties
  const agoOf = (tick: number) => agoText(g, state, tick, nowTick(state))
  const lines = [`${c.name ?? c.ref} · ${t.rarity(c.rarity)}`]
  if (c.known) {
    lines.push(t.since(c.known.how, agoOf(c.known.since)))
    if (c.known.seen > c.known.since) lines.push(t.seen(agoOf(c.known.seen)))
  } else lines.push(probable ? t.unknownProbable : t.unknown)
  // A card we need is worth a highlight only where they hold it: an unknown slot is no swap target.
  const need = c.need && c.known != null
  if (need) lines.push(t.needed)
  return (
    <span className="alb-cell rv-cell" data-known={c.known ? true : undefined} data-need={need || undefined} title={lines.join('\n')} style={style}>
      {c.known ? '✓' : '?'}
      {c.known && c.known.copies > 1 && <span className="alb-dup">×{c.known.copies}</span>}
    </span>
  )
}

/** One card of ours: held (with its copies) or missing. */
function OurCell({ c, name }: { c: OurSlot; name: string | null }) {
  const t = useRivalStrings()
  const style = { '--r': c.color } as CSSProperties
  const title = `${name ?? c.ref} · ${t.rarity(c.rarity)}\n${c.count ? t.weHave(c.count) : t.weLack}`
  return (
    <span className="alb-cell rv-cell" data-ours={c.count > 0 || undefined} title={title} style={style}>
      {c.count > 0 ? '✓' : ''}
      {c.count > 1 && <span className="alb-dup">×{c.count}</span>}
    </span>
  )
}

/** Twelve cells: the page's ten, a gap, the two special ones. */
function Cells({ children }: { children: ReactNode[] }) {
  return <div className="alb-cells">{children.flatMap((cell, i) => (i === 10 ? [<span key="gap" />, cell] : [cell]))}</div>
}

/** Our album beside the picked rival's, neighbourhood by neighbourhood, in our Album screen's order. */
function CompareAlbum({ team, row, us, pages, counts }: { team: string; row: TeamRow | null; us: TeamRow | null; pages: ComparedPage[]; counts: AlbumCounts }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  const name = whoName(g, team)
  const gap = counts.complete !== null && counts.complete > counts.seen
  return (
    <Panel title={t.compare(name)} sub={gap ? t.albumGap(counts.complete ?? 0, counts.seen) : t.publicOnly} className="rv-album">
      <div className="rv-cmp-cols">
        <span className="rv-cmp-col" data-side="us">
          <b>{t.usCol}</b>
          {us && <span>{t.albumHead(us.rank, us.score, us.pages)}</span>}
        </span>
        <span className="rv-cmp-col" data-side="them">
          <b>{name}</b>
          {row && <span>{t.albumHead(row.rank, row.score, row.pages)}</span>}
          <span title={t.heldKnownTitle(counts.held !== null)}>
            {t.heldKnown(counts.held, counts.known)}
          </span>
        </span>
      </div>
      <div className="rv-cmp-pages">
        {pages.map((p) => (
          <div key={p.set} className="rv-cmp-page">
            <div className="rv-cmp-name">
              <span className="alb-page-name">
                <i className="gm-swatch" style={{ background: p.color }} />
                {p.name}
              </span>
              {p.theirs.needs > 0 && <Badge tone="good">{t.holdsNeed(p.theirs.needs)}</Badge>}
            </div>
            <div className="rv-cmp-side" data-side="us">
              <span className="rv-cmp-meta">
                <span className="rv-cmp-who">{t.usCol}</span>
                {p.ours ? t.ourCount(p.ours.have, p.ours.of, p.ours.complete) : t.noPage}
              </span>
              {p.ours ? (
                <Cells>{p.ours.slots.map((c, i) => <OurCell key={c.ref} c={c} name={p.theirs.slots[i]?.name ?? null} />)}</Cells>
              ) : (
                <Cells>{p.theirs.slots.map((c) => <OurCell key={c.ref} c={{ ref: c.ref, rarity: c.rarity, color: c.color, count: 0 }} name={c.name} />)}</Cells>
              )}
            </div>
            <div className="rv-cmp-side" data-side="them">
              <span className="rv-cmp-meta">
                <span className="rv-cmp-who">{name}</span>
                {t.known(p.theirs.known, p.theirs.of)}
                {p.theirs.probable && (
                  <>
                    {' '}
                    <Badge title={t.probableTitle(p.theirs.known, p.theirs.of, counts.complete ?? 0, counts.seen)}>{t.probable}</Badge>
                  </>
                )}
              </span>
              <Cells>{p.theirs.slots.map((c) => <Cell key={c.ref} c={c} probable={p.theirs.probable} />)}</Cells>
            </div>
          </div>
        ))}
      </div>
      <div className="alb-legend">
        <span>
          <i className="alb-swatch rv-swatch" data-ours />
          {t.legendOurs}
        </span>
        <span>
          <i className="alb-swatch rv-swatch" data-known />
          {t.legendKnown}
        </span>
        <span>{t.legendUnknown}</span>
        <span>
          <i className="alb-swatch rv-swatch" data-need />
          {t.legendNeed}
        </span>
        <span className="gm-muted">· {t.publicOnly}</span>
      </div>
    </Panel>
  )
}

/** One rival we can pitch our market to: the cards it is missing that we list, and a ready-to-send message. */
function InviteTeam({ row }: { row: InviteRow }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  const [copied, setCopied] = useState(false)
  const name = whoName(g, row.team)
  const venues = [...new Set(row.cards.map((c) => c.venueName))]
  const venueLabel = t.inviteVenue(venues[0] ?? '', [...new Set(row.cards.map((c) => c.venue))][0] ?? '')
  const cardList = row.cards.map((c) => t.inviteCardAt(c.name ?? c.ref, c.price)).join(', ')
  const msg = t.inviteMsg(name, cardList, venueLabel)
  const copy = () => {
    void navigator.clipboard?.writeText(msg).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => undefined,
    )
  }
  return (
    <li className="rv-invite">
      <div className="rv-invite-head">
        <b className="rv-invite-team">{name}</b>
        <span className="gm-muted">
          #{row.rank} · {t.inviteCount(row.cards.length)}
        </span>
        {row.chasing && <Badge tone="good" title={t.inviteChasing}>{t.inviteChasing}</Badge>}
      </div>
      <ul className="rv-invite-cards">
        {row.cards.map((c) => (
          <li key={c.ref}>
            <CardRef code={c.ref} name={c.name ?? undefined} />
            {c.price != null && <span className="rv-invite-price">{c.price} P</span>}
          </li>
        ))}
      </ul>
      <p className="rv-invite-msg">{msg}</p>
      <button type="button" className="rv-invite-copy" onClick={copy}>
        {copied ? t.inviteCopied : t.inviteCopy}
      </button>
    </li>
  )
}

function InvitePanel({ rows, status, at, push }: { rows: InviteRow[]; status: string; at: string | null; push: PagePush | null }) {
  const t = useRivalStrings()
  return (
    <Panel
      title={t.invite}
      sub={
        <>
          {t.inviteSub}
          <Fresh page="rivals" status={status} at={at} push={push} />
        </>
      }
    >
      {rows.length ? (
        <ul className="rv-invites">
          {rows.map((r) => (
            <InviteTeam key={r.team} row={r} />
          ))}
        </ul>
      ) : (
        <Empty>{t.inviteEmpty}</Empty>
      )}
    </Panel>
  )
}

export function RivalsScreen() {
  const store = useGame()
  const t = useRivalStrings()
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])
  const push = pagePush(store.status, store.state, 'rivals')
  const { status, snapshot } = useRivals(store.status === 'mock', token, store.state.tick, push)
  const asked = useParam('team')
  const state = store.state
  const v = useMemo(() => {
    const needs = needsOf(state)
    const teams = teamRows(snapshot, state, needs)
    return { needs: needRows(snapshot, state), teams, needList: needs, invites: inviteRows(snapshot, state) }
  }, [snapshot, state])
  const team = pickTeam(v.teams, asked)
  const pages = useMemo(() => (team ? compareAlbums(snapshot, state, team, v.needList) : []), [snapshot, state, team, v.needList])
  const counts = useMemo(() => albumCounts(snapshot, team ?? '', pages.map((p) => p.theirs)), [snapshot, team, pages])
  const pick = (id: string) => {
    setParam('team', id)
    document.getElementById('rv-album')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const missingParts = Object.entries(snapshot.parts).filter(([, ok]) => !ok).map(([k]) => k)
  return (
    <>
      {status !== 'live' && status !== 'mock' && <NoticeBar>{t.notice[status]}</NoticeBar>}
      {status === 'live' && missingParts.length > 0 && <NoticeBar>{`${missingParts.join(', ')}: ${t.missingView}`}</NoticeBar>}
      <Panel
        title={t.needs}
        sub={
          <>
            {t.needsSub} · {t.publicOnly}
            <Fresh page="rivals" status={status} at={snapshot.at} push={push} />
          </>
        }
      >
        {v.needs.length ? (
          <ul className="rv-needs">
            {v.needs.map((n) => (
              <NeedCard key={n.ref} n={n} onPick={pick} />
            ))}
          </ul>
        ) : (
          <Empty>{t.noNeeds}</Empty>
        )}
      </Panel>
      <InvitePanel rows={v.invites} status={status} at={snapshot.at} push={push} />
      <div className="rv-grid">
        <Panel title={t.standings} sub={t.standingsSub} className="rv-standings">
          <Standings rows={v.teams} selected={team} onPick={pick} />
        </Panel>
        <div id="rv-album" className="rv-album-wrap">
          {team ? <CompareAlbum team={team} row={v.teams.find((r) => r.team === team) ?? null} us={v.teams.find((r) => r.us) ?? null} pages={pages} counts={counts} /> : null}
        </div>
      </div>
    </>
  )
}
