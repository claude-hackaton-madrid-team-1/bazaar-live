import { useState } from 'react'
import { fmtP, RARITY_COLOR } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { albumRows, albumSummary, scoreBars, series, sparkline, type AlbumRow, type AlbumSort, type AlbumSummary, type ScoreView } from '../views/album.ts'
import { Badge, Empty, EventLink, Panel, Seg } from './bits.tsx'

function Summary({ sum }: { sum: AlbumSummary }) {
  const t = useGameStrings()
  return (
    <div className="gm-tiles">
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.pagesComplete}</div>
        <div className="gm-tile-value">
          {sum.complete}
          <small>/ {sum.pages}</small>
        </div>
        <div className="gm-tile-foot">{t.album.masters(sum.master)}</div>
      </div>
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.missingSlots}</div>
        <div className="gm-tile-value">{sum.missing}</div>
        <div className="gm-tile-foot">{t.album.slotsToFill}</div>
      </div>
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.duplicates}</div>
        <div className="gm-tile-value">{sum.duplicates.count}</div>
        <div className="gm-tile-foot gm-refs">
          {sum.duplicates.refs.length ? (
            sum.duplicates.refs.map((d) => (
              <span key={d.ref}>
                {d.ref} ×{d.spare}
              </span>
            ))
          ) : (
            <span className="gm-muted">{t.album.noneSpare}</span>
          )}
        </div>
      </div>
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.cheapest}</div>
        <div className="gm-tile-value">{sum.cheapest ? sum.cheapest.ref : '—'}</div>
        <div className="gm-tile-foot">
          {sum.cheapest ? `${t.album.rarity[sum.cheapest.rarity] ?? sum.cheapest.rarity} · ${t.album.book} ${fmtP(sum.cheapest.book)} · ${sum.cheapest.page}` : t.album.nothingMissing}
        </div>
      </div>
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.packs}</div>
        <div className="gm-tile-value">
          {sum.packs.count}
          {sum.packs.refs.length > 1 && <small>{t.album.packsFoot(sum.packs.refs.length)}</small>}
        </div>
        <div className="gm-tile-foot gm-refs">
          {sum.packs.refs.length ? (
            sum.packs.refs.map((p) => (
              <span key={p.ref} title={p.name}>
                {p.ref} ×{p.count}
              </span>
            ))
          ) : (
            <span className="gm-muted">{t.album.noPacks}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Cells({ row }: { row: AlbumRow }) {
  return (
    <div className="gm-cells">
      {row.slots.flatMap((c, i) => {
        const cell = (
          <span key={c.ref} className="gm-cell" data-have={c.count > 0 || undefined} title={c.title} style={c.count ? { background: c.color } : { borderColor: `color-mix(in srgb, ${c.color} 55%, var(--hairline))` }}>
            {c.num}
            {c.spare && <span className="gm-dup">×{c.count}</span>}
          </span>
        )
        // the page's ten slots, a gap, then the two special ones
        return i === 10 ? [<span key="gap" className="gm-cell-gap" />, cell] : [cell]
      })}
    </div>
  )
}

function AlbumGrid({ rows }: { rows: AlbumRow[] }) {
  const t = useGameStrings()
  return (
    <>
      <div className="gm-album">
        {rows.map((row) => (
          <div key={row.set} className="gm-page">
            <span className="gm-page-name">
              <i className="gm-swatch" style={{ background: row.color }} />
              <span className="gm-mono gm-muted">{row.set}</span>
              {row.name}
            </span>
            <span className="gm-page-count">
              {row.master ? <Badge tone="warn">{t.badge.master}</Badge> : row.complete && <Badge tone="good">{t.badge.complete}</Badge>}
              <span>
                <b>{row.have}</b>/{row.of}
              </span>
            </span>
            <Cells row={row} />
          </div>
        ))}
      </div>
      <div className="gm-legend">
        {Object.entries(RARITY_COLOR).map(([r, c]) => (
          <span key={r}>
            <i style={{ background: c }} />
            {t.album.rarity[r] ?? r}
          </span>
        ))}
        <span>
          <i className="gm-legend-outline" />
          {t.album.missing}
        </span>
        <span>{t.album.spare}</span>
      </div>
    </>
  )
}

const W = 160
const H = 32

function Spark({ label, values, unit, tone }: { label: string; values: number[]; unit: string; tone: string }) {
  const t = useGameStrings()
  const line = sparkline(values, { w: W, h: H })
  const last = values.at(-1)
  return (
    <div className="gm-bigspark" data-tone={tone}>
      <div className="gm-bigspark-head">
        <span className="eyebrow">{label}</span>
        <b>{last == null ? '—' : `${Math.round(last * 10) / 10}${unit}`}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.album.over(label, values.length)}>
        {line && <path d={line.d} />}
        {line && <circle cx={line.x} cy={line.y} r={3} />}
      </svg>
    </div>
  )
}

function ScorePanel({ score, scores, cash }: { score: ScoreView; scores: number[]; cash: number[] }) {
  const t = useGameStrings()
  return (
    <>
      <div className="gm-total">
        {t.album.total} <b>{score.total.toFixed(1)}</b> · {t.rank} #{score.rank ?? '—'}
        {score.deals != null && ` · ${t.album.dealsCount(score.deals)}`}
      </div>
      <div className="gm-bars">
        {score.bars.map((b) => (
          <div key={b.key} className="gm-bar" title={`${b.key} = ${b.points}`}>
            <span className="gm-bar-label">{t.album.parts[b.key as keyof typeof t.album.parts] ?? b.label}</span>
            <span className="gm-track">
              <span className="gm-fill" style={{ width: `${b.pct}%` }} />
            </span>
            <span className="gm-num">{b.points.toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="gm-bigsparks">
        <Spark label={t.score} values={scores} unit="" tone="us" />
        <Spark label={t.cash} values={cash} unit=" P" tone="them" />
      </div>
    </>
  )
}

export function AlbumScreen() {
  const { state } = useGame()
  const t = useGameStrings()
  const [sort, setSort] = useState<AlbumSort>('closest')
  const rows = albumRows(state, { sort })
  return (
    <>
      <Summary sum={albumSummary(state)} />
      <div className="gm-album-layout">
        <Panel
          title={t.album.album}
          sub={<EventLink id={state.meEventId}>agent.me</EventLink>}
          actions={
            <Seg
              label={t.album.album}
              value={sort}
              options={[
                ['closest', t.album.closest],
                ['set', t.album.setOrder],
              ]}
              onChange={setSort}
            />
          }
        >
          {rows.length ? <AlbumGrid rows={rows} /> : <Empty>{t.album.waiting}</Empty>}
        </Panel>
        <Panel title={t.album.score} sub={t.album.snapshots(state.history.length)}>
          <ScorePanel score={scoreBars(state)} scores={series(state.history, 'score')} cash={series(state.history, 'cash')} />
        </Panel>
      </div>
    </>
  )
}
