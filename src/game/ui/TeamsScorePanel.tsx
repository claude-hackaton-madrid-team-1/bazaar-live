/**
 * Every team's score over the day, next to ours (/history, under "Score today"): where they beat us and where we beat
 * them first, then every team's score as steps (ours highlighted, the followed teams in colour, the rest muted), our
 * place and the followed teams', and what moved our place. Hover, drag or the arrow keys read the board at a moment:
 * every team's score, highest first. Only the public board's numbers are compared (./views/teams.ts).
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { ScoreMark, TeamScore } from '../../../shared/history.ts'
import { agentName, whoName } from '../humanize.ts'
import { useGameStrings, type GameStrings } from '../strings.ts'
import { signedGap, useTeamsStrings, type TeamsStrings } from '../teamsStrings.ts'
import {
  BOARD_PAD,
  LEVEL,
  boardOf,
  boardTickAt,
  boardX,
  defaultPick,
  gapsAt,
  headline,
  lastTick,
  rankAxis,
  rankChanges,
  readAt,
  rivalsAt,
  scoreAxis,
  secondsBefore,
  standingAt,
  stepBoardTick,
  stepPath,
  timeAt,
  timeTicks,
  type Board,
  type BoardPart,
  type GapRow,
  type RankChange,
  type Versus,
} from '../views/teams.ts'
import { Empty, Panel } from './bits.tsx'
import { useWidth } from './useWidth.ts'
import './teams.css'

/** Teams drawn in colour at once: the palette's five validated slots (teams.css). */
const MAX_PICK = 5
const H = 220
const RANK_H = 130
const TIP_GAP = 14
/** The rank changes listed, the latest first. */
const CHANGES = 6
/** Teams named per crossing before "N more". */
const CROSSED = 3

const clock = (iso: string | null): string | null => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null)
const toneOf = (gap: number | null | undefined): 'in' | 'out' | undefined => (gap == null || Math.abs(gap) <= LEVEL ? undefined : gap > 0 ? 'in' : 'out')
const fmtValue = (part: BoardPart, v: number): string => (part === 'score' || part === 'negotiating' || part === 'market' ? v.toFixed(2) : String(Math.round(v * 10) / 10))

/** "17:42 · hace 25 min" for a board tick. */
function whenText(b: Board, tick: number, t: GameStrings): string {
  const last = lastTick(b) ?? tick
  return [clock(timeAt(b, tick)), t.hum.ago(last - tick, secondsBefore(b, tick))].filter(Boolean).join(' · ')
}

function GapCell({ v, part, T }: { v: Versus | null; part: BoardPart; T: TeamsStrings }) {
  const g = useGameStrings()
  if (!v) return <span className="ts-gap gm-muted">—</span>
  const title = v.team ? T.theirs(whoName(g, v.team), fmtValue(part, v.value)) : fmtValue(part, v.value)
  return (
    <span className="ts-gap gm-mono gm-amount" data-tone={toneOf(v.gap)} title={title}>
      {signedGap(v.gap)}
    </span>
  )
}

/** Per part, us against the leader, the team just above and the mean: green where we lead, red where we trail. */
function GapTable({ rows, b, us, tick }: { rows: readonly GapRow[]; b: Board; us: string; tick: number }) {
  const T = useTeamsStrings()
  const g = useGameStrings()
  const who = rivalsAt(b, us, tick)
  const rankOf = (team: string | null) => (team ? (readAt(b, team, tick)?.rank ?? 0) : 0)
  const others = Math.max(0, (rows[0]?.of ?? 1) - 1)
  return (
    <div className="ts-table" role="table" aria-label={T.title}>
      <div className="ts-row ts-row-head" role="row">
        <span role="columnheader">{T.col.part}</span>
        <span role="columnheader">{T.col.ours}</span>
        <span role="columnheader">{T.col.place}</span>
        <span role="columnheader" className="ts-col-leader">
          {who.leader ? T.col.leader(whoName(g, who.leader), rankOf(who.leader)) : ''}
        </span>
        <span role="columnheader" className="ts-col-above">
          {who.above && who.above !== who.leader ? T.col.above(whoName(g, who.above), rankOf(who.above)) : ''}
        </span>
        <span role="columnheader">{T.col.mean}</span>
      </div>
      {rows.map((r) => (
        <div key={r.part} className="ts-row" role="row" data-scored={r.scored || undefined} data-total={r.part === 'score' || undefined}>
          <span role="cell" className="ts-part">
            {T.part[r.part]}
            {!r.scored && <span className="ts-unscored">{T.notScored}</span>}
          </span>
          <span role="cell" className="gm-mono">
            {fmtValue(r.part, r.ours)}
          </span>
          <span role="cell" className="gm-mono ts-place" data-tone={r.place === 1 ? 'in' : r.place > Math.ceil(r.of / 2) ? 'out' : undefined}>
            {T.place(r.place, r.of)}
          </span>
          <span role="cell" className="ts-col-leader">
            <GapCell v={r.leader} part={r.part} T={T} />
          </span>
          <span role="cell" className="ts-col-above">
            {who.above && who.above !== who.leader ? <GapCell v={r.above} part={r.part} T={T} /> : null}
          </span>
          <span role="cell" title={r.mean ? T.meanOf(others, fmtValue(r.part, r.mean.value)) : undefined}>
            <GapCell v={r.mean} part={r.part} T={T} />
          </span>
        </div>
      ))}
    </div>
  )
}

function changeText(c: RankChange, t: GameStrings, T: TeamsStrings): string {
  const moved = (['negotiating', 'market'] as const).flatMap((p) => {
    const d = c.ours[p]
    return d !== null && Math.abs(d) > LEVEL ? [{ part: T.part[p], delta: signedGap(d) }] : []
  })
  const ours = moved.length ? T.ours(moved) : T.oursStill
  const cross = (x: RankChange['passedUs'][number]) => T.crossing(whoName(t, x.team), x.part ? T.part[x.part] : null, signedGap(x.partDelta))
  const names = (xs: RankChange['passedUs']) => [...xs.slice(0, CROSSED).map(cross), ...(xs.length > CROSSED ? [T.more(xs.length - CROSSED)] : [])]
  const theirs = [...(c.passedUs.length ? [T.passedUs(names(c.passedUs))] : []), ...(c.wePassed.length ? [T.wePassed(names(c.wePassed))] : [])]
  // what explains it first
  const parts = c.cause === 'ours' ? [ours, ...theirs] : [...theirs, ours]
  for (const m of c.marks) {
    const what = m.kind === 'start' ? T.start(agentName(t, m.agent ?? '?')) : (t.history.score.game[m.action ?? ''] ?? m.action ?? '').toLowerCase()
    if (what) parts.push(T.after(what))
  }
  return `${T.moved(c.before, c.after)}: ${parts.join(' · ')}`
}

interface Hover {
  readonly tick: number
  readonly at: { readonly x: number; readonly y: number; readonly touch: boolean } | null
}

interface EndLabel {
  readonly team: string
  readonly y: number
  readonly text: string
  readonly color: string
}

/** Line-end labels pushed apart so two close lines still read. */
function spread(labels: EndLabel[], gap: number, lo: number, hi: number): EndLabel[] {
  const out = [...labels].sort((a, b) => a.y - b.y)
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1] as EndLabel
    const cur = out[i] as EndLabel
    if (cur.y - prev.y < gap) out[i] = { ...cur, y: prev.y + gap }
  }
  const over = (out.at(-1)?.y ?? 0) - hi
  return over > 0 ? out.map((l) => ({ ...l, y: Math.max(lo, l.y - over) })) : out
}

/** `missing`: the page's note when db/teams_score.sql is not applied yet. */
export function TeamsScorePanel({ board: rows, marks, us, missing }: { board: readonly TeamScore[]; marks: readonly ScoreMark[]; us: string; missing?: ReactNode }) {
  const t = useGameStrings()
  const T = useTeamsStrings()
  const b = useMemo(() => boardOf(rows), [rows])
  const end = lastTick(b)
  const [slots, setSlots] = useState<readonly (string | null)[] | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const tipBox = useRef<HTMLDivElement>(null)
  const W = useWidth(box, 960)

  const picked = useMemo<readonly (string | null)[]>(() => {
    if (slots) return slots
    const d = end === null ? [] : defaultPick(b, us, end, MAX_PICK)
    return Array.from({ length: MAX_PICK }, (_, i) => d[i] ?? null)
  }, [slots, b, us, end])
  const gaps = useMemo(() => (end === null ? [] : gapsAt(b, us, end)), [b, us, end])
  const changes = useMemo(() => rankChanges(b, us, marks).slice(0, CHANGES), [b, us, marks])

  useLayoutEffect(() => {
    const el = tipBox.current
    const bx = box.current
    if (!el || !bx || !hover) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const px = hover.at?.x ?? boardX(b, W).x(hover.tick)
    const py = hover.at?.y ?? BOARD_PAD.t
    const touch = hover.at?.touch ?? false
    const right = touch ? px < W / 2 : px + TIP_GAP + w <= W
    const left = right ? px + TIP_GAP : px - TIP_GAP - w
    const top = touch ? Math.max(0, py - 2 * TIP_GAP - h) : py + TIP_GAP + h <= bx.clientHeight ? py + TIP_GAP : py - TIP_GAP - h
    el.style.left = `${Math.max(0, Math.min(left, W - w))}px`
    el.style.top = `${Math.max(0, Math.min(top, bx.clientHeight - h))}px`
  })

  if (end === null) return <Panel title={T.title} sub={missing}>{<Empty>{T.noBoard}</Empty>}</Panel>
  if (!b.series.has(us)) return <Panel title={T.title} sub={T.sub(b.teams.length)}>{<Empty>{T.noUs}</Empty>}</Panel>

  const slotOf = (team: string): number => picked.indexOf(team)
  const colorOf = (team: string): string => (team === us ? 'var(--gm-us)' : `var(--ts-${slotOf(team) + 1})`)
  const toggle = (team: string) => {
    const now = [...picked]
    const i = now.indexOf(team)
    if (i >= 0) now[i] = null
    else {
      const free = now.indexOf(null)
      if (free < 0) return
      now[free] = team
    }
    setSlots(now)
  }

  const { x, tick: tickAt } = boardX(b, W)
  const sAxis = scoreAxis(b, H)
  const rAxis = rankAxis(b, RANK_H)
  const times = timeTicks(b, W)
  const followed = b.teams.filter((team) => team !== us && slotOf(team) >= 0)
  const muted = b.teams.filter((team) => team !== us && slotOf(team) < 0)
  const nameOf = (team: string) => (team === us ? T.us : whoName(t, team))
  const endLabels = (y: (v: number) => number, value: (r: TeamScore) => number, h: number) =>
    spread(
      [us, ...followed].flatMap((team) => {
        const r = readAt(b, team, end)
        return r ? [{ team, y: y(value(r)), text: nameOf(team), color: colorOf(team) }] : []
      }),
      12,
      BOARD_PAD.t,
      h - BOARD_PAD.b,
    )

  const place = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    setHover({ tick: boardTickAt(b, tickAt(px)) ?? end, at: { x: px, y: e.clientY - r.top, touch: e.pointerType === 'touch' } })
  }
  const lift = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') setHover(null)
  }
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const tick = hover?.tick ?? end
    const to = e.key === 'ArrowLeft' ? stepBoardTick(b, tick, -1) : e.key === 'ArrowRight' ? stepBoardTick(b, tick, 1) : e.key === 'Home' ? (b.ticks[0] ?? null) : e.key === 'End' ? end : null
    if (e.key === 'Escape') setHover(null)
    if (to === null) return
    e.preventDefault()
    setHover({ tick: to, at: null })
  }
  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    if (!hover && e.currentTarget.matches(':focus-visible')) setHover({ tick: end, at: null })
  }
  const onBlur = (e: FocusEvent<SVGSVGElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null)
  }

  const crossX = hover ? x(hover.tick) : 0
  const table = hover ? standingAt(b, hover.tick) : []
  const oursThen = hover ? readAt(b, us, hover.tick) : null
  const when = hover ? whenText(b, hover.tick, t) : ''
  const swatch = (team: string): CSSProperties | undefined => (team === us || slotOf(team) >= 0 ? ({ '--c': colorOf(team) } as CSSProperties) : undefined)
  const axisX = (h: number) =>
    times.map((k) => (
      <text key={k.at} className="gm-axis" x={k.x} y={h - 6} textAnchor="middle">
        {clock(k.at)}
      </text>
    ))
  const svgProps = (label: string) => ({ role: 'group', tabIndex: 0, 'aria-label': `${label} · ${T.keys}`, onKeyDown: onKey, onFocus, onBlur })
  const h = headline(gaps)
  const sLabels = endLabels(sAxis.y, (r) => r.score, H)
  const rLabels = endLabels(rAxis.y, (r) => r.rank, RANK_H)

  return (
    <Panel title={T.title} sub={T.sub(b.teams.length)} className="ts-panel">
      <p className="ts-headline" data-tone={h.worst ? 'out' : h.best ? 'in' : undefined}>
        {T.headline(h, (team) => whoName(t, team))}
      </p>
      <GapTable rows={gaps} b={b} us={us} tick={end} />
      <p className="ts-note gm-muted">{T.note}</p>

      <div ref={box} className="ts-box gm-score-box" onPointerMove={place} onPointerDown={place} onPointerLeave={() => setHover(null)} onPointerUp={lift} onPointerCancel={lift}>
        <svg className="gm-cashchart ts-chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...svgProps(T.chartLabel)}>
          {sAxis.ticks.map((v) => (
            <g key={v}>
              <line className="gm-grid" x1={BOARD_PAD.l} x2={W - BOARD_PAD.r} y1={sAxis.y(v)} y2={sAxis.y(v)} />
              <text className="gm-axis" x={BOARD_PAD.l - 6} y={sAxis.y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {axisX(H)}
          {muted.map((team) => (
            <path key={team} className="ts-line" data-muted d={stepPath(b, team, (r) => r.score, x, sAxis.y)} />
          ))}
          {followed.map((team) => (
            <path key={team} className="ts-line" style={swatch(team)} d={stepPath(b, team, (r) => r.score, x, sAxis.y)} />
          ))}
          <path className="ts-line" data-us style={swatch(us)} d={stepPath(b, us, (r) => r.score, x, sAxis.y)} />
          {sLabels.map((l) => (
            <text key={l.team} className="ts-end" data-us={l.team === us || undefined} x={W - BOARD_PAD.r + 6} y={l.y + 4} style={swatch(l.team)}>
              {l.text}
            </text>
          ))}
          {hover && <line className="gm-score-cross" x1={crossX} x2={crossX} y1={BOARD_PAD.t} y2={H - BOARD_PAD.b} />}
          {hover && oursThen && <circle className="gm-score-dot" cx={crossX} cy={sAxis.y(oursThen.score)} r={3.5} />}
        </svg>

        <h3 className="ts-sub-title">{T.rankTitle}</h3>
        <svg className="gm-cashchart ts-chart" width={W} height={RANK_H} viewBox={`0 0 ${W} ${RANK_H}`} {...svgProps(T.rankLabel)}>
          {rAxis.ticks.map((v) => (
            <g key={v}>
              <line className="gm-grid" x1={BOARD_PAD.l} x2={W - BOARD_PAD.r} y1={rAxis.y(v)} y2={rAxis.y(v)} />
              <text className="gm-axis" x={BOARD_PAD.l - 6} y={rAxis.y(v) + 4} textAnchor="end">
                {T.rank(v)}
              </text>
            </g>
          ))}
          {axisX(RANK_H)}
          {followed.map((team) => (
            <path key={team} className="ts-line" style={swatch(team)} d={stepPath(b, team, (r) => r.rank, x, rAxis.y)} />
          ))}
          <path className="ts-line" data-us style={swatch(us)} d={stepPath(b, us, (r) => r.rank, x, rAxis.y)} />
          {rLabels.map((l) => (
            <text key={l.team} className="ts-end" data-us={l.team === us || undefined} x={W - BOARD_PAD.r + 6} y={l.y + 4} style={swatch(l.team)}>
              {l.text}
            </text>
          ))}
          {hover && <line className="gm-score-cross" x1={crossX} x2={crossX} y1={BOARD_PAD.t} y2={RANK_H - BOARD_PAD.b} />}
          {hover && oursThen && <circle className="gm-score-dot" cx={crossX} cy={rAxis.y(oursThen.rank)} r={3.5} />}
        </svg>

        {hover && (
          <div ref={tipBox} className="gm-score-tip ts-tip" aria-hidden="true">
            <span className="gm-muted">{when}</span>
            <span className="ts-tip-rows">
              {table.map((s) => (
                <span key={s.team} className="ts-tip-row" data-us={s.team === us || undefined} data-on={slotOf(s.team) >= 0 || undefined}>
                  <span className="gm-mono gm-muted">{T.rank(s.rank)}</span>
                  <span className="ts-name">
                    <i className="ts-swatch" style={swatch(s.team)} />
                    {nameOf(s.team)}
                  </span>
                  <span className="gm-mono">{s.value.toFixed(2)}</span>
                  <span className="gm-mono gm-muted">{s.team === us || !oursThen ? '' : signedGap(s.value - oursThen.score)}</span>
                </span>
              ))}
            </span>
          </div>
        )}
        <div className="sr-only" aria-live="polite">
          {hover && !hover.at ? [when, ...table.map((s) => `${T.rank(s.rank)} ${nameOf(s.team)} ${s.value.toFixed(2)}`)].join(', ') : ''}
        </div>
      </div>

      <div className="ts-follow" role="group" aria-label={T.followHint(MAX_PICK)}>
        <span className="gm-muted ts-follow-head" title={T.followHint(MAX_PICK)}>
          {T.follow}
        </span>
        {b.teams.map((team) => {
          const r = readAt(b, team, end)
          const on = team === us || slotOf(team) >= 0
          const full = !on && !picked.includes(null)
          return (
            <button
              key={team}
              type="button"
              className="ts-chip"
              data-us={team === us || undefined}
              aria-pressed={on}
              disabled={team === us || full}
              title={team === us ? undefined : T.followHint(MAX_PICK)}
              onClick={() => toggle(team)}
            >
              <i className="ts-swatch" style={swatch(team)} />
              <span className="gm-mono gm-muted">{r ? T.rank(r.rank) : ''}</span> {nameOf(team)}
              <span className="gm-mono">{r ? r.score.toFixed(1) : ''}</span>
            </button>
          )
        })}
      </div>

      <h3 className="ts-sub-title">{T.changes}</h3>
      {changes.length ? (
        <ul className="ts-changes">
          {changes.map((c) => (
            <li key={c.tick} className="ts-change">
              <span className="ts-change-glyph gm-amount" data-tone={c.after < c.before ? 'in' : 'out'} aria-hidden="true">
                {c.after < c.before ? '▲' : '▼'}
              </span>
              <span className="ts-change-when gm-muted" title={`${t.tick} ${c.tick}`}>
                {whenText(b, c.tick, t)}
              </span>
              <span>{changeText(c, t, T)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{T.noChanges}</Empty>
      )}
    </Panel>
  )
}
