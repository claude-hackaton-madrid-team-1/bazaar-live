import { useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { ScoreMark, ScorePoint } from '../../../shared/history.ts'
import { fmtP, signed } from '../game.ts'
import { agentName } from '../humanize.ts'
import { useGameStrings, type GameStrings } from '../strings.ts'
import {
  PAD,
  SERIES,
  defaultMark,
  deltas,
  hasSeries,
  markGroups,
  minutesBetween,
  nearestMark,
  readingAt,
  scoreDay,
  seriesChart,
  spanOf,
  stepTick,
  valueAt,
  xScale,
  xTicks,
  type MarkGroup,
  type SeriesDelta,
  type SeriesKey,
  type Until,
} from '../views/score.ts'
import { Empty, Panel, Seg } from './bits.tsx'
import { useWidth } from './useWidth.ts'

const H = 170
const STRIP_H = 26
const STRIP_PAD = { ...PAD, t: 3, b: 3 }

const round2 = (v: number): number => Math.round(v * 100) / 100
const fmtValue = (key: SeriesKey, v: number | null): string => (v === null ? '—' : key === 'cash' ? fmtP(v) : String(round2(v)))
const fmtDelta = (key: SeriesKey, v: number | null): string => {
  if (v === null) return '—'
  if (key === 'cash') return signed(v)
  const r = round2(v)
  return r === 0 ? '0' : `${r > 0 ? '+' : '−'}${Math.abs(r)}`
}
const toneOf = (v: number | null): 'in' | 'out' | undefined => (v === null || round2(v) === 0 ? undefined : v > 0 ? 'in' : 'out')
const clock = (iso: string | null): string | null => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null)

function markText(g: MarkGroup, t: GameStrings): string {
  const S = t.history.score
  return g.kind === 'start' ? S.start(agentName(t, g.agent ?? '?'), g.count, g.tick, g.last) : (S.game[g.action ?? ''] ?? g.action ?? '?')
}

/** After the mark against the same number of ticks before it: faster, slower, the same. */
function Trend({ d }: { d: SeriesDelta }) {
  const t = useGameStrings()
  if (d.key === 'cash' || d.after === null || d.before === null) return null
  const diff = round2(d.after - d.before)
  const [glyph, tone, title] = diff > 0 ? ['▲', 'in', t.history.score.better] : diff < 0 ? ['▼', 'out', t.history.score.worse] : ['=', undefined, t.history.score.same]
  return (
    <span className="gm-score-trend" data-tone={tone} title={title} aria-label={title}>
      {glyph}
    </span>
  )
}

/** The tick under the crosshair, and where the pointer is in the box (null: the keys moved it). */
interface Hover {
  readonly tick: number
  readonly at: { readonly x: number; readonly y: number; readonly touch: boolean } | null
}

/** A mark this many px from the crosshair is the one it is on. */
const MARK_PX = 8
const TIP_GAP = 14

export function ScorePanel({ scores, marks, missing }: { scores: readonly ScorePoint[]; marks: readonly ScoreMark[]; missing?: ReactNode }) {
  const t = useGameStrings()
  const S = t.history.score
  const points = useMemo(() => scoreDay(scores), [scores])
  const groups = useMemo(() => markGroups(marks, points), [marks, points])
  const [picked, setPicked] = useState<string | null>(null)
  const [until, setUntil] = useState<Until>('now')
  const [focus, setFocus] = useState<SeriesKey>('score')
  const [hover, setHover] = useState<Hover | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const tipBox = useRef<HTMLDivElement>(null)
  const W = useWidth(box, 960)

  const from = groups.find((g) => g.key === picked) ?? defaultMark(groups)
  const span = from ? spanOf(groups, from, until, points) : null
  const lastTick = points.at(-1)?.tick ?? 0
  const rows: SeriesDelta[] = span ? deltas(points, span) : SERIES.map((key) => ({ key, now: valueAt(points, key, lastTick), after: null, before: null }))
  const shown = rows.filter((d) => hasSeries(points, d.key))
  const shownFocus = shown.some((d) => d.key === focus) ? focus : 'score'
  const { x, tick: tickAt, t0, t1 } = xScale(points, W)
  const chart = useMemo(() => seriesChart(points, shownFocus, W, H), [points, shownFocus, W])
  const strips = useMemo(() => new Map(SERIES.map((k) => [k, seriesChart(points, k, W, STRIP_H, STRIP_PAD, false)])), [points, W])
  const ticks = useMemo(() => xTicks(points, W), [points, W])
  const hasNext = from ? groups.some((g) => g.tick > from.tick) : false

  // Next to the pointer, inside the box at both edges; above a finger, so the finger doesn't cover it.
  useLayoutEffect(() => {
    const el = tipBox.current
    const b = box.current
    if (!el || !b || !hover) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const px = hover.at?.x ?? x(hover.tick)
    const py = hover.at?.y ?? PAD.t
    // a hand comes from below: above the finger, else at the top on the finger's roomier side
    const touch = hover.at?.touch ?? false
    const right = touch ? px < W / 2 : px + TIP_GAP + w <= W
    const left = right ? px + TIP_GAP : px - TIP_GAP - w
    const top = touch ? Math.max(0, py - 2 * TIP_GAP - h) : py + TIP_GAP + h <= b.clientHeight ? py + TIP_GAP : py - TIP_GAP - h
    el.style.left = `${Math.max(0, Math.min(left, W - w))}px`
    el.style.top = `${Math.max(0, Math.min(top, b.clientHeight - h))}px`
  })

  if (!points.length) return null

  const place = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    setHover({ tick: tickAt(px), at: { x: px, y: e.clientY - r.top, touch: e.pointerType === 'touch' } })
  }
  // A finger lifted (or the page took the drag to scroll): the crosshair goes with it.
  const lift = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') setHover(null)
  }
  const onChartKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const tick = hover?.tick ?? lastTick
    const to =
      e.key === 'ArrowLeft' ? stepTick(points, tick, -1) : e.key === 'ArrowRight' ? stepTick(points, tick, 1) : e.key === 'Home' ? (points[0]?.tick ?? null) : e.key === 'End' ? lastTick : null
    if (e.key === 'Escape') setHover(null)
    if (to === null) return
    e.preventDefault()
    setHover({ tick: to, at: null })
  }
  const onChartFocus = (e: FocusEvent<SVGSVGElement>) => {
    if (e.target === e.currentTarget && !hover && e.currentTarget.matches(':focus-visible')) setHover({ tick: lastTick, at: null })
  }
  const onChartBlur = (e: FocusEvent<SVGSVGElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null)
  }
  const pick = (g: MarkGroup) => {
    setPicked(g.key)
    if (until === 'next' && !groups.some((n) => n.tick > g.tick)) setUntil('now')
  }
  const onKey = (g: MarkGroup) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(g)
    }
  }
  const shade = (a: number, b: number, cls: string, h: number, pad: { t: number; b: number }) =>
    b > a ? <rect className={cls} x={x(a)} y={pad.t} width={Math.max(1, x(b) - x(a))} height={h - pad.t - pad.b} /> : null
  const markLines = (h: number, pad: { t: number; b: number }) =>
    groups.map((g) => (
      <line key={g.key} className="gm-score-markline" data-kind={g.kind} data-on={g.key === from?.key || undefined} x1={x(g.tick)} x2={x(g.tick)} y1={pad.t} y2={h - pad.b} />
    ))

  const minutes = span ? minutesBetween(points, span.start, span.end) : null
  const read = hover ? readingAt(points, hover.tick) : null
  const valueOf = (key: SeriesKey): number | null => read?.values.find((v) => v.key === key)?.value ?? null
  const mark = hover ? nearestMark(groups, hover.tick, (MARK_PX * (t1 - t0)) / Math.max(1, W - PAD.l - PAD.r)) : null
  const lastAt = points.at(-1)?.at ?? null
  const when = read
    ? [
        clock(read.at) ? `${t.tick} ${read.tick}` : null,
        clock(read.at),
        t.hum.ago(lastTick - read.tick, read.at && lastAt ? (Date.parse(lastAt) - Date.parse(read.at)) / 1000 : null),
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const tipRows = read ? read.values.filter((v) => shown.some((d) => d.key === v.key)) : []
  const crossX = hover ? x(hover.tick) : 0
  const focusValue = hover ? valueOf(shownFocus) : null

  return (
    <Panel
      title={S.title}
      sub={
        <>
          {S.sub(groups.length)}
          {missing}
        </>
      }
      actions={
        span && hasNext ? (
          <Seg
            label={S.until}
            value={until}
            options={[
              ['now', S.untilNow],
              ['next', S.untilNext],
            ]}
            onChange={setUntil}
          />
        ) : undefined
      }
    >
      {span ? (
        <p className="gm-score-span">
          <span className="gm-muted">{S.from}</span> <strong>{markText(span.from, t)}</strong>
          <span className="gm-muted">
            {' '}
            · <span title={`${t.tick} ${span.start}`}>{clock(span.from.at) ?? `${t.tick} ${span.start}`}</span>
          </span>{' '}
          → <strong>{span.to ? markText(span.to, t) : S.now}</strong>
          <span className="gm-muted"> · {S.ticks(span.end - span.start, minutes)}</span>
        </p>
      ) : (
        <p className="gm-score-span gm-muted">{S.noMarks}</p>
      )}
      <div ref={box} className="gm-score-box" onPointerMove={place} onPointerDown={place} onPointerLeave={() => setHover(null)} onPointerUp={lift} onPointerCancel={lift}>
        {chart ? (
          <svg
            className="gm-cashchart gm-score-chart"
            width={W}
            height={H}
            viewBox={`0 0 ${W} ${H}`}
            role="group"
            tabIndex={0}
            aria-label={`${S.chartLabel(S.series[shownFocus])} · ${S.keys}`}
            onKeyDown={onChartKey}
            onFocus={onChartFocus}
            onBlur={onChartBlur}
          >
            {chart.yTicks.map((y) => (
              <g key={y.value}>
                <line className="gm-grid" x1={PAD.l} x2={W - PAD.r} y1={y.y} y2={y.y} />
                <text className="gm-axis" x={PAD.l - 6} y={y.y + 4} textAnchor="end">
                  {y.value}
                </text>
              </g>
            ))}
            {ticks.map((k) => (
              <text key={k.tick} className="gm-axis" x={k.x} y={H - 6} textAnchor="middle">
                {k.tick}
              </text>
            ))}
            {span?.before && shade(span.before.start, span.before.end, 'gm-score-before', H, PAD)}
            {span && shade(span.start, span.end, 'gm-score-after', H, PAD)}
            {markLines(H, PAD)}
            <path className="gm-cash-line" d={chart.path} />
            {chart.end && <circle className="gm-cash-end" cx={chart.end.x} cy={chart.end.y} r={4.5} />}
            {hover && <line className="gm-score-cross" x1={crossX} x2={crossX} y1={PAD.t} y2={H - PAD.b} />}
            {hover && focusValue !== null && <circle className="gm-score-dot" cx={crossX} cy={chart.y(focusValue)} r={3.5} />}
            {groups.map((g) => (
              <g
                key={g.key}
                className="gm-score-flag"
                data-kind={g.kind}
                data-on={g.key === from?.key || undefined}
                role="button"
                tabIndex={0}
                aria-label={`${markText(g, t)} · t${g.tick}`}
                aria-pressed={g.key === from?.key}
                onClick={() => pick(g)}
                onKeyDown={onKey(g)}
                onFocus={(e) => e.currentTarget.matches(':focus-visible') && setHover({ tick: g.tick, at: null })}
              >
                <rect className="gm-score-hit" x={x(g.tick) - 9} y={0} width={18} height={H - PAD.b} />
                {g.kind === 'start' ? (
                  <path d={`M${x(g.tick) - 5},${PAD.t - 10} h10 l-5,7 z`} />
                ) : (
                  <circle cx={x(g.tick)} cy={PAD.t - 6} r={3.5} />
                )}
              </g>
            ))}
          </svg>
        ) : (
          <Empty>{S.noMarks}</Empty>
        )}
        {read && (
          <div ref={tipBox} className="gm-score-tip" aria-hidden="true">
            <span className="gm-muted">{when}</span>
            {mark && (
              <strong className="gm-score-tip-mark" data-kind={mark.kind}>
                {markText(mark, t)}
              </strong>
            )}
            <span className="gm-score-tip-rows">
              {tipRows.map((v) => (
                <span key={v.key} className="gm-score-tip-row" data-on={v.key === shownFocus || undefined}>
                  <span>{S.series[v.key]}</span>
                  <span className="gm-mono">{fmtValue(v.key, v.value)}</span>
                  <span className="gm-mono gm-amount" data-tone={toneOf(v.change)}>
                    {toneOf(v.change) ? fmtDelta(v.key, v.change) : ''}
                  </span>
                </span>
              ))}
            </span>
          </div>
        )}
        <div className="sr-only" aria-live="polite">
          {read && !hover?.at
            ? [when, mark ? markText(mark, t) : null, ...tipRows.map((v) => `${S.series[v.key]} ${fmtValue(v.key, v.value)}${toneOf(v.change) ? ` (${fmtDelta(v.key, v.change)})` : ''}`)]
                .filter(Boolean)
                .join(', ')
            : ''}
        </div>
        <div className="gm-score-strips">
          <div className="gm-score-strip-head">
            <span />
            <span className="gm-score-then">{read ? (clock(read.at) ?? '') : ''}</span>
            <span>{S.after}</span>
            <span>{span?.before ? S.before(span.end - span.start) : ''}</span>
          </div>
          {shown.map((d) => {
            const c = strips.get(d.key)
            return (
              <button key={d.key} type="button" className="gm-score-strip" aria-pressed={d.key === shownFocus} title={S.focus(S.series[d.key])} onClick={() => setFocus(d.key)}>
                <span className="gm-score-strip-row">
                  <span className="gm-score-strip-name">{S.series[d.key]}</span>
                  <span className="gm-mono" data-then={read ? true : undefined}>
                    {fmtValue(d.key, read ? valueOf(d.key) : d.now)}
                  </span>
                  <span className="gm-mono gm-amount" data-tone={toneOf(d.after)}>
                    {fmtDelta(d.key, d.after)}
                    <Trend d={d} />
                  </span>
                  <span className="gm-mono gm-muted">{span?.before ? fmtDelta(d.key, d.before) : ''}</span>
                </span>
                <svg width={W} height={STRIP_H} viewBox={`0 0 ${W} ${STRIP_H}`} aria-hidden="true">
                  {span?.before && shade(span.before.start, span.before.end, 'gm-score-before', STRIP_H, STRIP_PAD)}
                  {span && shade(span.start, span.end, 'gm-score-after', STRIP_H, STRIP_PAD)}
                  {markLines(STRIP_H, STRIP_PAD)}
                  {c && <path className="gm-score-spark" d={c.path} />}
                  {hover && <line className="gm-score-cross" x1={crossX} x2={crossX} y1={0} y2={STRIP_H} />}
                  {hover && c && valueOf(d.key) !== null && <circle className="gm-score-dot" cx={crossX} cy={c.y(valueOf(d.key) as number)} r={2.5} />}
                </svg>
              </button>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
