/**
 * The Rivals screen: who is ahead, who holds the cards we need, and one team's album as far as the public feed shows it
 * (GET /api/rivals). The answer first (the cards we need and who has them), then the standings, then the album of the
 * team picked there. A card we never saw a team hold is drawn as unknown, never as missing.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { setParam, useParam } from '../../ui/route'
import { pagePush } from '../fresh.ts'
import { agoText, whoName } from '../humanize.ts'
import { useRivals } from '../rivals.ts'
import { useRivalStrings } from '../rivalStrings.ts'
import { SETS } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { nowTick } from '../views/decisions.ts'
import { compareAlbums, needRows, needsOf, pickTeam, teamRows, type ComparedPage, type NeedRow, type OurSlot, type RivalSlot, type TeamRow } from '../views/rivals.ts'
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

function Cell({ c }: { c: RivalSlot }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  const { state } = useGame()
  const style = { '--r': c.color } as CSSProperties
  const agoOf = (tick: number) => agoText(g, state, tick, nowTick(state))
  const lines = [`${c.name ?? c.ref} · ${t.rarity(c.rarity)}`]
  if (c.known) {
    lines.push(t.since(c.known.how, agoOf(c.known.since)))
    if (c.known.seen > c.known.since) lines.push(t.seen(agoOf(c.known.seen)))
  } else lines.push(t.unknown)
  if (c.need) lines.push(t.needed)
  return (
    <span className="alb-cell rv-cell" data-known={c.known ? true : undefined} data-need={c.need || undefined} title={lines.join('\n')} style={style}>
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
function CompareAlbum({ team, row, us, pages }: { team: string; row: TeamRow | null; us: TeamRow | null; pages: ComparedPage[] }) {
  const t = useRivalStrings()
  const g = useGameStrings()
  const name = whoName(g, team)
  const seen = pages.reduce((n, p) => n + p.theirs.slots.filter((s) => s.known).length, 0)
  return (
    <Panel title={t.compare(name)} sub={t.albumSub(seen)} className="rv-album">
      <div className="rv-cmp-cols">
        <span className="rv-cmp-col" data-side="us">
          <b>{t.usCol}</b>
          {us && <span>{t.albumHead(us.rank, us.score, us.pages)}</span>}
        </span>
        <span className="rv-cmp-col" data-side="them">
          <b>{name}</b>
          {row && <span>{t.albumHead(row.rank, row.score, row.pages)}</span>}
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
              </span>
              <Cells>{p.theirs.slots.map((c) => <Cell key={c.ref} c={c} />)}</Cells>
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
        <span>
          <i className="alb-swatch" data-missing />
          {t.legendUnknown}
        </span>
        <span>
          <i className="alb-swatch rv-swatch" data-need />
          {t.legendNeed}
        </span>
        <span className="gm-muted">· {t.publicOnly}</span>
      </div>
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
    return { needs: needRows(snapshot, state), teams, needList: needs }
  }, [snapshot, state])
  const team = pickTeam(v.teams, asked)
  const pages = useMemo(() => (team ? compareAlbums(snapshot, state, team, v.needList) : []), [snapshot, state, team, v.needList])
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
      <div className="rv-grid">
        <Panel title={t.standings} sub={t.standingsSub} className="rv-standings">
          <Standings rows={v.teams} selected={team} onPick={pick} />
        </Panel>
        <div id="rv-album" className="rv-album-wrap">
          {team ? <CompareAlbum team={team} row={v.teams.find((r) => r.team === team) ?? null} us={v.teams.find((r) => r.us) ?? null} pages={pages} /> : null}
        </div>
      </div>
    </>
  )
}
