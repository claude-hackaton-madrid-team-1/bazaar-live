import { useState, type CSSProperties, type ReactNode } from 'react'
import { nameOfRef } from '../cards.ts'
import { fmtP, RARITY_COLOR, signed } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import {
  albumRows, albumSummary, bestMoves, scoreBars, series, sparkline,
  type AlbumRow, type AlbumSort, type AlbumSummary, type Moves, type Quote, type ScoreView, type Slot,
} from '../views/album.ts'
import { Badge, Empty, Panel, Seg } from './bits.tsx'

const p0 = (v: number) => `${Math.round(v)} P`

/** What we hold is worth, what the spares would fetch, and the cash beside them. */
function Totals({ sum }: { sum: AlbumSummary }) {
  const t = useGameStrings()
  return (
    <div className="alb-tiles">
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.worth}</div>
        <div className="gm-tile-value">
          {sum.estimate && '~'}
          {Math.round(sum.worth)}
          <small>P</small>
        </div>
        <div className="gm-tile-foot">{t.album.worthFoot}</div>
      </div>
      <div className="gm-tile material">
        <div className="eyebrow">{t.album.duplicates}</div>
        <div className="gm-tile-value">
          {Math.round(sum.duplicates.worth)}
          <small>P · {t.album.copies(sum.duplicates.count)}</small>
        </div>
        <div className="gm-tile-foot">{sum.duplicates.count ? t.album.sparesFoot(p0(sum.duplicates.market)) : t.album.noneSpare}</div>
      </div>
      <div className="gm-tile material">
        <div className="eyebrow">{t.cash}</div>
        <div className="gm-tile-value">
          {Math.round(sum.cash)}
          <small>P</small>
        </div>
        <div className="gm-tile-foot">{sum.duplicates.count ? t.album.cashFoot(p0(sum.cash + sum.duplicates.market)) : t.album.cashPlain}</div>
      </div>
    </div>
  )
}

/** Where a price comes from, in words: a board's ask or bid, the last trade, or book (marked ~). */
function useWhere() {
  const t = useGameStrings()
  return (q: Quote, side: 'ask' | 'bid') => `${q.source === 'book' ? '~' : ''}${fmtP(q.price)} ${t.album.where[q.source](side, q.venue ?? '')}`
}

function Rar({ rarity }: { rarity: Slot['rarity'] }) {
  const t = useGameStrings()
  return <i className="alb-rar" style={{ background: RARITY_COLOR[rarity] }} title={t.album.rarity[rarity] ?? rarity} />
}

function Net({ v, estimate }: { v: number; estimate: boolean }) {
  return (
    <span className="alb-net" data-sign={v >= 0 ? '+' : '-'}>
      {estimate && '~'}
      {signed(v)}
    </span>
  )
}

function MoveCol({ kind, title, hint, empty, children }: { kind: string; title: string; hint: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="alb-col" data-kind={kind} aria-label={title}>
      <h3 className="alb-col-head">
        {title}
        <span>{hint}</span>
      </h3>
      {children.length ? <ol className="alb-list">{children}</ol> : <p className="alb-empty">{empty}</p>}
    </section>
  )
}

function MovesPanel({ moves }: { moves: Moves }) {
  const t = useGameStrings()
  const where = useWhere()
  return (
    <Panel title={t.album.moves} sub={t.album.movesSub}>
      <div className="alb-moves">
        <MoveCol kind="buy" title={t.album.buyNext} hint={t.album.buyHint} empty={t.album.noBuy}>
          {moves.buy.map((m) => (
            <li key={m.ref} className="alb-move">
              <span className="alb-what">
                <Rar rarity={m.rarity} />
                <b title={m.ref}>{nameOfRef(m.ref) ?? m.ref}</b>
                <span className="gm-muted">{m.page}</span>
                {m.completes && <Badge tone="good">{t.album.completes[m.completes]}</Badge>}
              </span>
              <Net v={m.net} estimate={m.estimate} />
              <span className="alb-how">{t.album.buyHow(fmtP(m.gain), where(m.quote, 'ask'))}</span>
            </li>
          ))}
        </MoveCol>
        <MoveCol kind="sell" title={t.album.sell} hint={t.album.sellHint} empty={t.album.noSell}>
          {moves.sell.map((m) => (
            <li key={m.ref} className="alb-move">
              <span className="alb-what">
                <Rar rarity={m.rarity} />
                <b title={m.ref}>{nameOfRef(m.ref) ?? m.ref}</b>
                <span className="gm-muted">{m.why === 'spare' ? t.album.spareOf(m.count) : t.album.lowSet}</span>
              </span>
              <Net v={m.net} estimate={m.estimate} />
              <span className="alb-how">{t.album.sellHow(fmtP(m.lose), where(m.quote, 'bid'))}</span>
            </li>
          ))}
        </MoveCol>
        <MoveCol kind="pages" title={t.album.closestPages} hint={t.album.pagesHint} empty={t.album.noPages}>
          {moves.pages.map((m) => (
            <li key={m.set} className="alb-move">
              <span className="alb-what">
                <i className="gm-swatch" style={{ background: m.color }} />
                <b>{m.name}</b>
                <span className="gm-muted">
                  {m.have}/{m.of}
                </span>
              </span>
              <Net v={m.net} estimate={m.estimate} />
              <span className="alb-bar" aria-hidden="true">
                <i style={{ width: `${(m.have / Math.max(1, m.of)) * 100}%` }} />
              </span>
              <span className="alb-how">
                {t.album.needs(m.missing.map((x) => `${nameOfRef(x.ref) ?? x.ref} ${where(x.quote, 'ask')}`).join(' + '))}
                <br />
                {t.album.pays(fmtP(m.gain), fmtP(m.bonus), fmtP(m.cost))}
              </span>
            </li>
          ))}
        </MoveCol>
      </div>
      <details className="alb-details">
        <summary>{t.album.howValue}</summary>
        <p>{t.album.movesNote}</p>
      </details>
    </Panel>
  )
}

function Cell({ c }: { c: Slot }) {
  const style = { '--r': c.color } as CSSProperties
  return (
    <span className="alb-cell" data-have={c.count > 0 || undefined} data-tier={c.count ? c.tier : undefined} data-move={c.move ?? undefined} title={c.title} style={style}>
      {c.count ? Math.round(c.worth) : c.move === 'buy' ? `+${Math.round(c.net ?? 0)}` : ''}
      {c.spare && <span className="alb-dup">×{c.count}</span>}
    </span>
  )
}

function AlbumGrid({ rows }: { rows: AlbumRow[] }) {
  const t = useGameStrings()
  return (
    <>
      <div className="alb-pages">
        {rows.map((row) => (
          <div key={row.set} className="alb-page">
            <div className="alb-page-head">
              <span className="alb-page-name">
                <i className="gm-swatch" style={{ background: row.color }} />
                {row.name}
                <span className="alb-aff" title={t.album.affTitle} data-high={row.affinity.value > 1 || undefined}>
                  {row.affinity.known ? '' : '~'}×{row.affinity.value}
                </span>
                {row.master ? <Badge tone="warn">{t.badge.master}</Badge> : row.complete && <Badge tone="good">{t.badge.complete}</Badge>}
              </span>
              <span className="alb-page-meta">
                <span className="alb-bar" aria-hidden="true">
                  <i style={{ width: `${(Math.min(row.have, row.of) / Math.max(1, row.of)) * 100}%` }} />
                </span>
                <span className="gm-mono">
                  <b>{row.have}</b>/{row.of}
                </span>
                <span>{row.complete ? t.album.pageEarned(p0(row.worth), p0(row.bonus)) : t.album.pageWorth(p0(row.worth), p0(row.bonus))}</span>
              </span>
            </div>
            <div className="alb-cells">
              {row.slots.flatMap((c, i) => {
                const cell = <Cell key={c.ref} c={c} />
                // the page's ten slots, a gap, then the two special ones
                return i === 10 ? [<span key="gap" />, cell] : [cell]
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="alb-legend">
        <span>{t.album.valueLegend}</span>
        {([1, 2, 3, 4] as const).map((tier, i) => (
          <span key={tier}>
            <i className="alb-swatch" data-tier={tier} />
            {t.album.tiers[i]}
          </span>
        ))}
        <span>
          <i className="alb-swatch" data-move="buy" />
          {t.album.buyLegend}
        </span>
        <span>
          <span className="alb-dup alb-dup-inline">×2</span>
          {t.album.sellLegend}
        </span>
      </div>
      <details className="alb-details">
        <summary>{t.album.rarityLegend}</summary>
        <div className="alb-legend">
          {Object.entries(RARITY_COLOR).map(([r, c]) => (
            <span key={r}>
              <i className="alb-swatch" style={{ boxShadow: `inset 0 -3px 0 ${c}` }} />
              {t.album.rarity[r] ?? r}
            </span>
          ))}
          <span>
            <i className="alb-swatch" data-missing />
            {t.album.missing}
          </span>
        </div>
      </details>
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
      <Totals sum={albumSummary(state)} />
      {rows.length > 0 && <MovesPanel moves={bestMoves(state)} />}
      <Panel
        title={t.album.album}
        sub={t.album.gridSub}
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
      <details className="alb-details alb-score material">
        <summary>{t.album.scoreDetails}</summary>
        <ScorePanel score={scoreBars(state)} scores={series(state.history, 'score')} cash={series(state.history, 'cash')} />
      </details>
    </>
  )
}
