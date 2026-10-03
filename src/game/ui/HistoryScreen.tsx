import { useMemo, useRef, useState } from 'react'
import type { HistoryParts } from '../../../shared/history.ts'
import { nameOfRef } from '../cards.ts'
import { fmtP, setOf, signed } from '../game.ts'
import { pagePush } from '../fresh.ts'
import { agentName, itemOf, whoName } from '../humanize.ts'
import { useHistory } from '../history.ts'
import { useGameStrings, type GameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { nowTick } from '../views/decisions.ts'
import { agentsOf, cashChart, cashSummary, filterMovements, movements, orderLines, type MoveFilter, type MoveLine, type Movement, type OrderLine, type OrderStatus } from '../views/history.ts'
import { Badge, CardRef, Empty, Fresh, Panel, Seg } from './bits.tsx'
import { NoticeBar } from './GameHeader.tsx'
import { ByHand } from './MarketScreen.tsx'
import { ScorePanel } from './ScorePanel.tsx'
import { TeamsScorePanel } from './TeamsScorePanel.tsx'
import { useWidth } from './useWidth.ts'
import { Ago, ItemName } from './words.tsx'

const tone = (n: number | null): 'in' | 'out' | undefined => (n === null || n === 0 ? undefined : n > 0 ? 'in' : 'out')

function Missing({ part, parts, live }: { part: keyof HistoryParts; parts: HistoryParts; live: boolean }) {
  const t = useGameStrings()
  return !live || parts[part] ? null : <span className="gm-warn"> · {t.history.missing}</span>
}

function lineText(l: MoveLine, t: GameStrings): string {
  const L = t.history.line
  if (l.trade) return l.trade.side === 'buy' ? L.buy(whoName(t, l.trade.counterparty), l.trade.fee) : L.sell(whoName(t, l.trade.counterparty))
  const e = l.event
  switch (l.kind) {
    case 'bond':
      return L.bond(e?.venue ?? '?', e?.bond ?? null)
    case 'gift':
      return L.gift
    case 'pack':
      return L.pack(t.hum.item(itemOf(e?.pack ?? '?')), e?.best ? (nameOfRef(e.best) ?? e.best) : null)
    case 'level':
      return L.level(e?.level ?? null, e?.why ?? null)
    case 'failed':
      return L.failed
    case 'closed':
      return L.closed(e?.venue ?? '?')
    default:
      return L.other
  }
}

function Lines({ m }: { m: Movement }) {
  const t = useGameStrings()
  return (
    <ul className="gm-move-lines">
      {m.lines.map((l, i) => (
        <li key={i} data-kind={l.kind}>
          {l.trade?.card ? <CardRef code={l.trade.card} name={l.trade.cardName ?? undefined} /> : null}
          <span>{lineText(l, t)}</span>
          {l.amount !== null && m.lines.length > 1 && (
            <span className="gm-mono gm-amount" data-tone={tone(l.amount)}>
              {signed(l.amount)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Moves({ rows, today }: { rows: Movement[]; today: string | null }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.history.noMoves}</Empty>
  return (
    <div className="gm-scroll gm-scroll-tall">
      <table className="gm-table gm-moves">
        <thead>
          <tr>
            {t.history.head.map((h, i) => (
              <th key={h} className={i < 3 ? 'gm-r' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const flow = m.delta ?? m.lines.reduce((n, l) => n + (l.amount ?? 0), 0)
            return (
              <tr key={m.key}>
                <td className="gm-r gm-when">{m.day === today ? <Ago tick={m.tick} /> : <span title={`${t.tick} ${m.tick}`}>{m.day.slice(5)}</span>}</td>
                <td className="gm-r gm-mono gm-amount" data-tone={tone(flow)}>
                  {flow === 0 && m.delta === null ? '—' : signed(flow)}
                </td>
                <td className="gm-r gm-mono">
                  {m.cashAfter !== null ? (
                    fmtP(m.cashAfter)
                  ) : (
                    <span className="gm-muted">{m.delta === null && m.key.startsWith('y') ? t.history.pending : t.history.before}</span>
                  )}
                </td>
                <td className="gm-move-what">
                  <Lines m={m} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const H = 220

function Chart({ points }: { points: Parameters<typeof cashChart>[0] }) {
  const t = useGameStrings()
  const box = useRef<HTMLDivElement>(null)
  const W = useWidth(box, 960)
  const chart = useMemo(() => cashChart(points, W, H), [points, W])
  const today = points.filter((p) => p.day === points.at(-1)?.day)
  const cash = today.map((p) => p.cash)
  return (
    <div ref={box} className="gm-cashchart-box">
      {!chart || !today.length ? (
        <Empty>{t.history.noChart}</Empty>
      ) : (
        <svg className="gm-cashchart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.history.chartLabel(fmtP(Math.min(...cash)), fmtP(Math.max(...cash)), fmtP(cash.at(-1)))}>
          {chart.yTicks.map((y) => (
            <g key={y.value}>
              <line className="gm-grid" x1={40} x2={W - 12} y1={y.y} y2={y.y} />
              <text className="gm-axis" x={34} y={y.y + 4} textAnchor="end">
                {y.value}
              </text>
            </g>
          ))}
          {chart.xTicks.map((x) => (
            <text key={x.tick} className="gm-axis" x={x.x} y={H - 6} textAnchor="middle">
              {x.tick}
            </text>
          ))}
          <path className="gm-cash-area" d={chart.area} />
          <path className="gm-cash-line" d={chart.path} />
          {chart.marks.map((m) => (
            <circle key={m.tick} className="gm-cash-mark" data-tone={m.tone} cx={m.x} cy={m.y} r={4.5}>
              <title>{`${t.tick} ${m.tick}: ${signed(m.delta)}`}</title>
            </circle>
          ))}
          {chart.end && <circle className="gm-cash-end" cx={chart.end.x} cy={chart.end.y} r={5.5} />}
        </svg>
      )}
    </div>
  )
}

/** "a mano" for the commands a person runs, the agent's name otherwise. */
const whoLabel = (t: GameStrings, who: string): string => (who === 'hand' ? t.history.byHand : agentName(t, who))

const STATUS_TONE: Readonly<Record<OrderStatus, 'us' | 'good' | 'neutral' | 'warn'>> = { open: 'us', bought: 'good', sold: 'good', swapped: 'good', cancelled: 'neutral', expired: 'neutral' }

/** What a ledger line committed, as words: "Compramos Palacio de Velázquez RET-08 en v02 · caduca en ~4 min · abierta". */
function OrderWhat({ o }: { o: OrderLine }) {
  const t = useGameStrings()
  const { state } = useGame()
  const card = o.item !== null && setOf(o.item) ? o.item : null
  return (
    <span className="gm-order">
      <span>{t.history.verbs[o.verb]}</span>
      {card ? <CardRef code={card} /> : o.item && o.verb !== 'team' && o.verb !== 'hand' ? <ItemName item={o.item} /> : null}
      {o.venue && <span className="gm-muted">{t.history.onVenue(state.venues.get(o.venue)?.name ?? o.venue)}</span>}
      {o.expiresIn !== null && <span className="gm-muted">· {t.market.expiresIn(o.expiresIn, o.expiresIn * state.tickSeconds)}</span>}
      {o.status && <Badge tone={STATUS_TONE[o.status]}>{t.history.orderStatus[o.status]}</Badge>}
      {o.count > 1 && <span className="gm-muted">×{o.count}</span>}
    </span>
  )
}

export function HistoryScreen() {
  const store = useGame()
  const t = useGameStrings()
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])
  const push = pagePush(store.status, store.state, 'history')
  const { status, snapshot } = useHistory(store.status === 'mock', token, store.state.tick, push)
  const [filter, setFilter] = useState<MoveFilter>('all')
  const [agent, setAgent] = useState('all')
  const rows = useMemo(() => movements(snapshot), [snapshot])
  const sum = useMemo(() => cashSummary(snapshot, rows), [snapshot, rows])
  const shown = useMemo(() => filterMovements(rows, filter), [rows, filter])
  const [details, setDetails] = useState(false)
  const tickNow = nowTick(store.state)
  const orders = useMemo(() => orderLines(snapshot.orders, agent, tickNow), [snapshot.orders, agent, tickNow])
  const agents = useMemo(() => agentsOf(snapshot.orders), [snapshot.orders])
  const live = status === 'live'
  // on the real game the header's cash is the game's own, live (the database's is a few seconds behind)
  const own = live && store.state.team !== ''
  const now = own ? store.state.cash : sum.now
  const changes = snapshot.points.filter((p) => p.day === sum.day).length - 1
  return (
    <>
      {status !== 'live' && <NoticeBar>{t.history.notice[status === 'loading' ? 'loading' : status]}</NoticeBar>}
      <section className="gm-cashhero material">
        <div className="gm-cashhero-now">
          <div className="eyebrow">{t.history.now}</div>
          <div className="gm-cashhero-value">{now === null ? '—' : fmtP(now)}</div>
          <div className="gm-cashhero-sub">
            {sum.last && (
              <Badge tone={sum.last.delta > 0 ? 'good' : 'bad'} title={t.cashLast(signed(sum.last.delta), sum.last.tick)}>
                {sum.last.delta > 0 ? '▲' : '▼'} {signed(sum.last.delta)} · <Ago tick={sum.last.tick} />
              </Badge>
            )}
            <Fresh page="history" status={status} at={snapshot.at} push={push} />
          </div>
        </div>
        <dl className="gm-cashstats">
          <div>
            <dt>{t.history.stats.open}</dt>
            <dd>{sum.open === null ? '—' : fmtP(sum.open)}</dd>
          </div>
          <div>
            <dt>{t.history.stats.low}</dt>
            <dd>{sum.low === null ? '—' : fmtP(sum.low)}</dd>
          </div>
          <div>
            <dt>{t.history.stats.high}</dt>
            <dd>{sum.high === null ? '—' : fmtP(sum.high)}</dd>
          </div>
          <div>
            <dt>{t.history.stats.in}</dt>
            <dd className="gm-amount" data-tone="in">
              {signed(sum.earned)}
            </dd>
          </div>
          <div>
            <dt>{t.history.stats.out}</dt>
            <dd className="gm-amount" data-tone="out">
              {signed(-sum.spent)}
            </dd>
          </div>
          <div>
            <dt>{t.history.stats.fees}</dt>
            <dd>{fmtP(sum.fees)}</dd>
          </div>
          <div>
            <dt>{t.history.stats.trades}</dt>
            <dd className="gm-cashstats-small">{t.history.tradesValue(sum.buys, sum.sells)}</dd>
          </div>
        </dl>
      </section>
      {snapshot.scores.length ? (
        <ScorePanel scores={snapshot.scores} marks={snapshot.marks} missing={<Missing part="marks" parts={snapshot.parts} live={live} />} />
      ) : (
        <Panel
          title={t.history.chart}
          sub={
            <>
              {t.history.chartSub(Math.max(0, changes))}
              <Missing part="points" parts={snapshot.parts} live={live} />
            </>
          }
        >
          <Chart points={snapshot.points} />
        </Panel>
      )}
      {snapshot.board.length > 0 && store.state.team !== '' && <TeamsScorePanel board={snapshot.board} marks={snapshot.marks} us={store.state.team} />}
      <div className="gm-history-cols">
        <Panel
          title={t.history.moves}
          sub={
            <>
              {t.history.movesSub(shown.length)}
              <Missing part="trades" parts={snapshot.parts} live={live} />
            </>
          }
          actions={
            <Seg
              label={t.history.filter}
              value={filter}
              options={[
                ['all', t.history.filters.all],
                ['in', t.history.filters.in],
                ['out', t.history.filters.out],
              ]}
              onChange={setFilter}
            />
          }
        >
          <Moves rows={shown} today={sum.day} />
        </Panel>
        <Panel
          title={t.history.orders}
          sub={
            <>
              {t.history.ordersSub(orders.length)}
              <Missing part="orders" parts={snapshot.parts} live={live} />
            </>
          }
          actions={
            <>
              {agents.length > 1 && (
                <Seg label={t.history.agent} value={agent} options={[['all', t.history.allAgents], ...agents.map((a) => [a, whoLabel(t, a)] as const)]} onChange={setAgent} />
              )}
              <button type="button" className="gm-btn" aria-pressed={details} onClick={() => setDetails(!details)} title={t.history.orderDetailsTitle}>
                {t.history.orderDetails}
              </button>
            </>
          }
        >
          {orders.length ? (
            <div className="gm-scroll gm-scroll-tall">
              <table className="gm-table gm-orders">
                <thead>
                  <tr>
                    {t.history.ordersHead.map((h, i) => (
                      <th key={h} className={i === 0 || i === 3 ? 'gm-r' : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="gm-r gm-when">{o.day === sum.day ? <Ago tick={o.tick} /> : <span title={`${t.tick} ${o.tick}`}>{o.day.slice(5)}</span>}</td>
                      <td>{o.who === 'hand' ? <ByHand /> : agentName(t, o.who)}</td>
                      <td className="gm-order-cell">
                        <OrderWhat o={o} />
                        {details && (
                          <div className="gm-order-raw">
                            {o.raw.map((r) => `${r.kind} ${r.item ?? '—'}${r.price === null ? '' : ` ${r.price}`} · ${r.agent}`).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="gm-r gm-mono">{o.price === null || (o.price === 0 && (o.who === 'duels' || o.verb === 'team')) ? '—' : fmtP(o.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{t.history.noOrders}</Empty>
          )}
        </Panel>
      </div>
    </>
  )
}
