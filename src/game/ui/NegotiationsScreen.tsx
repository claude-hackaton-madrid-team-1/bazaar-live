import { useEffect, useRef, useState } from 'react'
import { setParam, useParam } from '../../ui/route'
import { fmtP } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { conversation, duelRows, rail, selectedThreadId, threadList, type Bubble, type Conversation, type DuelRow, type RailPoint, type ThreadRow } from '../views/negotiations.ts'
import { Badge, Empty, EventLink, Expiry, Injection, Panel, RefChip } from './bits.tsx'

const RAIL_H = 120
const PAD = { l: 34, r: 40, t: 10, b: 18 }

const path = (pts: RailPoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')

function PriceRail({ bubbles, threadId, theirLabel, ourLabel }: { bubbles: Bubble[]; threadId: number; theirLabel: string; ourLabel: string }) {
  const t = useGameStrings()
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setW(Math.max(220, Math.round(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const r = rail(bubbles, { w, h: RAIL_H, pad: PAD })
  const empty = !r.us.length && !r.them.length
  const series: [string, RailPoint[]][] = [
    ['them', r.them],
    ['us', r.us],
  ]
  return (
    <div className="gm-rail-wrap" ref={ref}>
      {!empty && (
        <>
          <div className="gm-rail-legend">
            <span data-tone="them">{t.neg.their(theirLabel)}</span>
            <span data-tone="us">{t.neg.our(ourLabel)}</span>
          </div>
          <svg className="gm-rail" viewBox={`0 0 ${w} ${RAIL_H}`} width={w} height={RAIL_H} role="img" aria-label={t.neg.railLabel(threadId)}>
            {r.grid.map((g) => (
              <g key={g.label}>
                <line className="gm-rail-grid" x1={PAD.l} x2={w - PAD.r} y1={g.y} y2={g.y} />
                <text x={PAD.l - 4} y={g.y + 3} textAnchor="end">
                  {g.label}
                </text>
              </g>
            ))}
            <text x={PAD.l} y={RAIL_H - 3}>
              {t.neg.roundsAxis}
            </text>
            {series.map(([side, pts]) => {
              const last = pts.at(-1)
              if (!last) return null
              return (
                <g key={side} data-tone={side}>
                  <path className="gm-rail-line" d={path(pts)} />
                  {pts.map((p) => (
                    <circle key={p.eventId} className="gm-rail-dot" data-final={p.final || undefined} cx={p.x} cy={p.y} r={p.final ? 5 : 3.5}>
                      <title>{`r${p.round} · ${side} ${p.price} P${p.final ? ' · FINAL' : ''}`}</title>
                    </circle>
                  ))}
                  <text x={last.x + 8} y={last.y + 3}>
                    {last.price}
                  </text>
                </g>
              )
            })}
          </svg>
        </>
      )}
    </div>
  )
}

function ThreadList({ rows, selected, onSelect }: { rows: ThreadRow[]; selected: number | null; onSelect: (id: number) => void }) {
  const t = useGameStrings()
  const label = (l: 'ask' | 'bid') => t.neg[l]
  return (
    <ul className="gm-threads" aria-label={t.neg.ourThreads}>
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="gm-thread" data-closed={r.status === 'closed' || undefined} aria-current={r.id === selected ? 'true' : undefined} onClick={() => onSelect(r.id)}>
            <span className="gm-row">
              <span className="gm-tid">#{r.id}</span>
              <span className="gm-who" title={r.with}>
                {r.with}
              </span>
              <Badge tone={r.side === 'buy' ? 'us' : 'them'}>{r.side === 'buy' ? t.badge.buy : t.badge.sell}</Badge>
              <RefChip topic={r.topic} />
              <span className="gm-spacer" />
              {r.final && r.status === 'open' && <Badge tone="warn">{t.badge.final}</Badge>}
              {r.status === 'closed' ? <Badge>{t.badge.closed}</Badge> : <Expiry left={r.expiresIn} />}
            </span>
            <span className="gm-row gm-prices">
              <span>
                {label(r.theirLabel)} <b data-tone="them">{fmtP(r.theirPrice)}</b>
              </span>
              <span>
                {label(r.ourLabel)} <b data-tone="us">{fmtP(r.ourPrice)}</b>
              </span>
              <span>
                {t.neg.gap} <b>{fmtP(r.gap)}</b>
              </span>
              <span className="gm-spacer" />
              <span>r{r.rounds}</span>
              <Injection on={r.suspicious} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function BubbleItem({ b, label }: { b: Bubble; label: string }) {
  const t = useGameStrings()
  return (
    <li className="gm-bubble" data-side={b.side}>
      <div className="gm-bubble-head">
        <span className="gm-price">{fmtP(b.price)}</span>
        <span className="gm-muted">
          {b.side === 'us' ? t.neg.we : b.maker} · {label}
        </span>
        {b.final && <Badge tone="warn">{t.badge.final}</Badge>}
        <Injection on={b.suspicious} />
      </div>
      {b.text != null && <blockquote className="gm-bubble-text">“{b.text}”</blockquote>}
      <div className="gm-bubble-meta">
        <span>r{b.round}</span>
        <span>
          {t.tick} {b.tick ?? '—'}
        </span>
        <span>o{b.offerId ?? '—'}</span>
        <span>m{b.messageId ?? '—'}</span>
        <span>
          {b.maker} → {b.to}
        </span>
        <span>
          t{b.createdTick ?? '—'} → exp t{b.expiresTick ?? '—'}
        </span>
        {b.assets.length > 0 && <span>assets {b.assets.map((a) => `#${a}`).join(' ')}</span>}
        <EventLink id={b.eventId} />
      </div>
    </li>
  )
}

function ThreadDetail({ convo }: { convo: Conversation | null }) {
  const t = useGameStrings()
  if (!convo) return <Empty>{t.neg.noThread}</Empty>
  const { thread: th, bubbles, lastText } = convo
  const last = bubbles.at(-1)
  const their = t.neg[th.theirLabel]
  const our = t.neg[th.ourLabel]
  return (
    <div className="gm-detail">
      <div className="gm-row gm-detail-head">
        <span className="gm-tid">#{th.id}</span>
        <span className="gm-who">{th.with}</span>
        <Badge tone={th.side === 'buy' ? 'us' : 'them'}>{th.side === 'buy' ? t.badge.buy : t.badge.sell}</Badge>
        <RefChip topic={th.topic} />
        {th.set && <span className="gm-muted">{th.set.name}</span>}
        {th.final && th.status === 'open' && <Badge tone="warn">{t.badge.final}</Badge>}
        {th.status === 'closed' ? <Badge>{t.badge.closed}</Badge> : <Expiry left={th.expiresIn} />}
        <span className="gm-spacer" />
        {last && <EventLink id={last.eventId}>{t.neg.last(last.eventId)}</EventLink>}
      </div>
      <dl className="gm-stats">
        <div>
          <dt className="eyebrow">{t.neg.their(their)}</dt>
          <dd data-tone="them">{fmtP(th.theirPrice)}</dd>
        </div>
        <div>
          <dt className="eyebrow">{t.neg.our(our)}</dt>
          <dd data-tone="us">{fmtP(th.ourPrice)}</dd>
        </div>
        <div>
          <dt className="eyebrow">{t.neg.gap}</dt>
          <dd>{fmtP(th.gap)}</dd>
        </div>
        <div>
          <dt className="eyebrow">{t.neg.rounds}</dt>
          <dd>{th.rounds}</dd>
        </div>
      </dl>
      {lastText != null && (
        <div className="gm-row">
          <Injection on={th.suspicious} />
          <blockquote className="gm-quote-block">“{lastText}”</blockquote>
        </div>
      )}
      <PriceRail bubbles={bubbles} threadId={th.id} theirLabel={their} ourLabel={our} />
      {bubbles.length === 0 ? (
        <Empty>{t.neg.noOffers}</Empty>
      ) : (
        <ol className="gm-convo" aria-label={t.neg.convoLabel(th.id)}>
          {bubbles.map((b) => (
            <BubbleItem key={b.eventId} b={b} label={b.side === 'us' ? our : their} />
          ))}
        </ol>
      )}
    </div>
  )
}

const days = (d: number | null) => (d == null ? '' : ` · ${d}d`)

function DuelsTable({ rows }: { rows: DuelRow[] }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.neg.noDuels}</Empty>
  const right = new Set([2, 3, 4, 5, 7, 8])
  return (
    <div className="gm-scroll">
      <table className="gm-table">
        <thead>
          <tr>
            {t.neg.duelHead.map((h, i) => (
              <th key={h} className={right.has(i) ? 'gm-r' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>#{d.id}</td>
              <td>{d.role}</td>
              <td className="gm-r" data-tone="us">
                {fmtP(d.ourPrice)}
                {days(d.ourDays)}
              </td>
              <td className="gm-r" data-tone="them">
                {fmtP(d.theirPrice)}
                {days(d.theirDays)}
              </td>
              <td className="gm-r">{fmtP(d.gap)}</td>
              <td className="gm-r">{d.rounds}</td>
              <td>
                <Badge tone={d.tone}>{t.neg.duelStatus[d.status]}</Badge>
              </td>
              <td className="gm-r">{fmtP(d.dealPrice)}</td>
              <td className="gm-r">{d.points ?? '—'}</td>
              <td>
                <EventLink id={d.lastEventId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function NegotiationsScreen() {
  const { state } = useGame()
  const t = useGameStrings()
  const requested = useParam('id')
  const rows = threadList(state)
  const selected = selectedThreadId(state, requested)
  const convo = selected == null ? null : conversation(state, selected)
  const duels = duelRows(state)
  const open = rows.filter((r) => r.status === 'open').length
  return (
    <>
      <div className="gm-split">
        <Panel title={t.neg.threads} sub={t.neg.threadsSub(open, rows.length - open)}>
          {rows.length ? <ThreadList rows={rows} selected={selected} onSelect={(id) => setParam('id', String(id))} /> : <Empty>{t.neg.noThreads}</Empty>}
        </Panel>
        <Panel title={t.neg.conversation} sub={convo ? t.neg.with(convo.thread.id, convo.thread.with) : undefined}>
          <ThreadDetail convo={convo} />
        </Panel>
      </div>
      <Panel title={t.neg.duels} sub={t.neg.duelsSub(duels.filter((d) => d.status === 'open').length)}>
        <DuelsTable rows={duels} />
      </Panel>
    </>
  )
}
