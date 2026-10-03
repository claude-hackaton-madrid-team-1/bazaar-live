import { useMemo, useState } from 'react'
import type { OutcomeRow } from '../decisions.ts'
import { fmtP, signed } from '../game.ts'
import { agentName, ago, denialText, kindName, percent, ruleName, whoName } from '../humanize.ts'
import { hhmm, useGameStrings, type GameStrings } from '../strings.ts'
import { useGame, useWallNow } from '../store.ts'
import { timeline, type Entry, type Filter, type Line } from '../views/agent.ts'
import { healthChips, type HealthChip } from '../views/health.ts'
import {
  agentStatuses, blocksByRule, dealTally, deals as dealsOf, isWrite, ledger as ledgerOf, nowTick, share, SILENCE, STATUS_TONE,
  type AgentState, type AgentStatus, type Blocks, type Deal, type DealTally, type Ledger, type Run,
} from '../views/decisions.ts'
import { Badge, Empty, EventLink, Panel, Seg, type Tone } from './bits.tsx'
import { toneOf } from './tone.ts'
import { Ago, ItemName } from './words.tsx'

const STATE_TONE: Readonly<Record<AgentState, Tone>> = { none: 'neutral', silent: 'bad', quiet: 'warn', stuck: 'warn', ok: 'good' }

/** Why a silent or quiet agent is quiet, from its /health: ": ledger down since 11:40", or " · /health fine" (null without one). */
function because(t: GameStrings, st: AgentStatus, chip: HealthChip | undefined): string | null {
  const h = chip?.health
  if ((st.state !== 'silent' && st.state !== 'quiet') || !h) return null
  // a fine /health is an answer too: the agent runs, its own logic is what decides nothing
  if (!h.reason || h.tone === 'good') return t.agt.healthFine
  return t.agt.because(t.health.reason(h.reason), hhmm(h.since))
}

const priceText = (run: Run): string | null =>
  run.minPrice == null || run.maxPrice == null ? null : run.minPrice === run.maxPrice ? fmtP(run.minPrice) : `${run.minPrice}–${fmtP(run.maxPrice)}`

/** What a run of decisions was and how it ended: kind · item · counterparty · price, then why a guardrail said no, or its status. */
function RunWhat({ run, agent = false }: { run: Run; agent?: boolean }) {
  const t = useGameStrings()
  const price = priceText(run)
  return (
    <>
      {agent && <b className="agt-agent-name">{agentName(t, run.agent)}</b>}
      <span>{kindName(t, run.kind)}</span>
      {run.item && <ItemName item={run.item} />}
      {run.counterparty && <span className="gm-muted">· {whoName(t, run.counterparty)}</span>}
      {price && <b className="gm-dec-price">{price}</b>}
      {run.verdict === 'denied' ? (
        <span className="agt-rule" title={ruleName(t, run.rule)}>
          <span className="gm-bad">✖</span> <b>{denialText(t, run.rule, run.last.text)}</b>
        </span>
      ) : isWrite(run.kind) ? (
        <Badge tone={STATUS_TONE[run.status]}>{t.decide.status[run.status]}</Badge>
      ) : null}
      {run.rows.length > 1 && <Badge tone={run.verdict === 'denied' ? 'bad' : 'neutral'}>×{run.rows.length}</Badge>}
    </>
  )
}

function AgentRow({ st, why }: { st: AgentStatus; why: string | null }) {
  const t = useGameStrings()
  const { state } = useGame()
  const a = t.agt
  const seconds = (ticks: number) => ago(nowTick(state), nowTick(state) - ticks, state.tickSeconds).seconds
  const alive = (st.state === 'none' ? a.noLog : st.silentFor == null ? a.never : a.ago(st.silentFor, seconds(st.silentFor))) + (why ?? '')
  const restartedAgo = st.restartedAt == null ? null : ago(nowTick(state), st.restartedAt, state.tickSeconds)
  return (
    <li className="agt-agent" data-state={st.state}>
      <div className="agt-who">
        <span className="gm-dot" aria-hidden="true" />
        <b>{agentName(t, st.agent)}</b>
        <Badge tone={STATE_TONE[st.state]}>{a.state[st.state]}</Badge>
      </div>
      <div className="agt-alive">{alive}</div>
      {st.state !== 'none' && (
        <dl className="agt-facts">
          <dt className="eyebrow">{a.last}</dt>
          <dd>
            {st.last ? <RunWhat run={st.last} /> : <span className="gm-muted">—</span>}
            {st.last && st.last.rows.length > 1 && (
              <span className="gm-muted">
                <Ago tick={st.last.toTick} from={st.last.fromTick} />
              </span>
            )}
          </dd>
          <dt className="eyebrow">{a.blockedMost}</dt>
          <dd>
            {st.topBlock ? (
              <>
                <b className="agt-rule">{ruleName(t, st.topBlock.rule)}</b>
                <b className="gm-bad">×{st.topBlock.count}</b>
                <span className="gm-muted">· {a.ofHour(st.blocks, st.decisions)}</span>
              </>
            ) : (
              <span className="gm-muted">{a.noBlocks}</span>
            )}
          </dd>
          {st.restarts > 0 && restartedAgo && <dd className="agt-restarts">↻ {a.restarted(st.restarts, t.hum.ago(restartedAgo.ticks, restartedAgo.seconds))}</dd>}
        </dl>
      )}
    </li>
  )
}

/** The answer in one line: which agent is silent or stuck, and why; worst first. */
function Alert({ statuses, why }: { statuses: AgentStatus[]; why: Partial<Record<string, string | null>> }) {
  const t = useGameStrings()
  const a = t.agt
  if (statuses.every((st) => st.state === 'none')) return null
  const silent = statuses.filter((st) => st.state === 'silent')
  const quiet = statuses.filter((st) => st.state === 'quiet')
  const stuck = statuses.filter((st) => st.state === 'stuck')
  return (
    <p className="agt-alert" role="status" data-ok={!silent.length && !quiet.length && !stuck.length ? true : undefined}>
      {silent.map((st) => (
        <span key={st.agent} className="gm-bad">
          ● {a.alertSilent(agentName(t, st.agent), st.silentFor)}
          {why[st.agent]}
        </span>
      ))}
      {quiet.map((st) => (
        <span key={st.agent} className="gm-warn">
          ● {a.alertQuiet(agentName(t, st.agent), st.silentFor ?? 0)}
          {why[st.agent]}
        </span>
      ))}
      {stuck.map((st) => (
        <span key={st.agent} className="gm-warn">
          ● {a.alertStuck(agentName(t, st.agent), st.last?.rows.length ?? 0, ruleName(t, st.last?.rule ?? null))}
        </span>
      ))}
      {!silent.length && !quiet.length && !stuck.length && <span className="gm-good">● {a.allOk}</span>}
    </p>
  )
}

function AgentsPanel({ statuses, chips }: { statuses: AgentStatus[]; chips: HealthChip[] }) {
  const t = useGameStrings()
  const why = Object.fromEntries(statuses.map((st) => [st.agent, because(t, st, chips.find((c) => c.agent === st.agent))]))
  return (
    <Panel title={t.agt.agents} sub={t.agt.agentsSub(SILENCE, t.hum.agents)} className="agt-agents-panel">
      <Alert statuses={statuses} why={why} />
      <ul className="agt-agents">
        {statuses.map((st) => (
          <AgentRow key={st.agent} st={st} why={why[st.agent] ?? null} />
        ))}
      </ul>
    </Panel>
  )
}

/** A meter against a cap: `warn` once it is nearly used up, `bad` once it is. */
function Meter({ label, value, cap, text, invert = false }: { label: string; value: number; cap: number; text: string; invert?: boolean }) {
  // invert: cash is good ABOVE its floor, so the meter shows how close the floor is.
  const used = invert ? share(cap, value) : share(value, cap)
  const tone = used >= 1 ? 'bad' : used >= 0.8 ? 'warn' : 'ok'
  return (
    <div className="gm-meter" data-level={tone}>
      <dt className="eyebrow">{label}</dt>
      <dd>
        <span className="gm-meter-num">{text}</span>
        <span className="gm-track" aria-hidden="true">
          <span className="gm-fill" style={{ width: `${Math.round(used * 100)}%` }} />
        </span>
      </dd>
    </div>
  )
}

function MoneyPanel({ ledger }: { ledger: Ledger | null }) {
  const t = useGameStrings()
  return (
    <Panel title={t.agt.money} sub={t.decide.ledgerSub}>
      {ledger ? (
        <>
          <dl className="gm-meters">
            <Meter label={t.decide.spent} value={ledger.spent} cap={ledger.limits.spendPerHour} text={`${fmtP(ledger.spent)} / ${fmtP(ledger.limits.spendPerHour)}`} />
            <Meter label={t.decide.cashFloor} value={ledger.cash} cap={ledger.limits.cashFloor} text={`${fmtP(ledger.cash)} / ${fmtP(ledger.limits.cashFloor)}`} invert />
          </dl>
          <p className="agt-headroom" data-zero={ledger.headroom <= 0 || undefined}>
            {t.decide.headroom(fmtP(ledger.headroom))}
          </p>
          <p className="agt-small gm-muted">{t.agt.acceptsTick(ledger.accepts, ledger.limits.acceptsPerTick)}</p>
        </>
      ) : (
        <Empty>{t.decide.noLedger}</Empty>
      )}
    </Panel>
  )
}

const RULES_SHOWN = 6

function BlocksPanel({ blocks }: { blocks: Blocks }) {
  const t = useGameStrings()
  const top = blocks.rules[0]?.count ?? 0
  const hidden = blocks.rules.length - RULES_SHOWN
  return (
    <Panel title={t.decide.blocks} sub={t.decide.blocksSub(blocks.fromTick)}>
      {blocks.rules.length ? (
        <ul className="gm-rules agt-blocks">
          {blocks.rules.slice(0, RULES_SHOWN).map((r) => (
            <li key={r.rule} className="gm-rule">
              <span className="gm-rule-head">
                <b>{ruleName(t, r.rule)}</b>
                <span className="gm-num">×{r.count}</span>
              </span>
              <span className="gm-track" aria-hidden="true">
                <span className="gm-fill gm-fill-bad" style={{ width: `${Math.round(share(r.count, top) * 100)}%` }} />
              </span>
              <span className="gm-rule-meta gm-muted">
                {r.agents.map((name) => agentName(t, name)).join(' · ')} · <Ago tick={r.lastTick} />
              </span>
            </li>
          ))}
          {hidden > 0 && <li className="agt-small gm-muted">{t.agt.more(hidden)}</li>}
        </ul>
      ) : (
        <Empty>{t.decide.noBlocks}</Empty>
      )}
    </Panel>
  )
}

/** A scored deal on one line: what, with whom, price against our value, the edge, and Jev. */
function DealWhat({ deal, details }: { deal: Deal; details: boolean }) {
  const t = useGameStrings()
  const d = t.decide
  const { row, edge, verdict } = deal
  return (
    <>
      <ItemName item={row.item ?? row.subject} />
      {/* a duel already says "duel with …" */}
      {(row.target !== 'duel' || row.counterparty) && (
        <span className="gm-muted">
          {row.target !== 'duel' && d.target[row.target]}
          {row.counterparty && ` · ${whoName(t, row.counterparty)}`}
        </span>
      )}
      {row.price != null && (
        <span>
          {fmtP(row.price)}
          {deal.value != null ? <span className="gm-muted"> vs {fmtP(deal.value)}</span> : <span className="gm-muted"> · {d.noValue}</span>}
        </span>
      )}
      {edge != null && verdict != null ? (
        <span className={toneOf(edge)}>
          <span className="gm-gain">{edge === 0 ? '±0 P' : signed(edge)}</span> {d[verdict]}
        </span>
      ) : row.label ? (
        <Badge tone={row.label === 'good' ? 'good' : row.label === 'bad' ? 'bad' : 'neutral'}>{t.agt.label[row.label]}</Badge>
      ) : (
        <span className="gm-muted">{d.unscored}</span>
      )}
      {row.jevRight != null && <span className={row.jevRight ? 'gm-good' : 'gm-bad'}>{row.jevRight ? d.jevRight : d.jevWrong}</span>}
      {details && <EventLink id={row.eventId} />}
    </>
  )
}

function DealsPanel({ deals, tally, details }: { deals: Deal[]; tally: DealTally; details: boolean }) {
  const t = useGameStrings()
  const d = t.decide
  return (
    <Panel title={d.deals} sub={d.dealsSub}>
      {deals.length ? (
        <>
          <p className="agt-tally">
            <Badge tone="good">
              {tally.good} {t.agt.tally.good}
            </Badge>
            <Badge tone="neutral">
              {tally.ok} {t.agt.tally.ok}
            </Badge>
            <Badge tone="bad">
              {tally.bad} {t.agt.tally.bad}
            </Badge>
            {tally.jevJudged > 0 && <span className="gm-muted">{t.agt.jevScore(tally.jevRight, tally.jevJudged)}</span>}
          </p>
          <ul className="agt-deals">
            {deals.map((deal) => (
              <li key={`${deal.row.target}-${deal.row.subject}`} className="agt-deal">
                <DealWhat deal={deal} details={details} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Empty>{d.noDeals}</Empty>
      )}
    </Panel>
  )
}

/** A timeline line in the page's language: a duel's start or result is said from its parts, anything else as the feed wrote it. */
function lineText(t: GameStrings, line: Line, tick: number, tickSeconds: number): string {
  const duel = line.duel
  if (!duel) return line.text
  const rival = duel.rival ? whoName(t, duel.rival) : null
  if (!duel.start) return t.hum.duelEnd(rival, duel.deal, duel.price == null ? null : fmtP(duel.price))
  const left = duel.deadline == null ? null : duel.deadline - tick
  return t.hum.duelStart(rival, duel.role, duel.item, left == null || left <= 0 ? null : t.hum.span(left, left * tickSeconds))
}

function outcomeTone(row: OutcomeRow): Tone {
  return row.label === 'good' ? 'good' : row.label === 'bad' ? 'bad' : 'neutral'
}

/** One timeline line: when (a tick or a range), what, and its event id only with the details on. */
function EntryRow({ entry, details }: { entry: Entry; details: boolean }) {
  const t = useGameStrings()
  const { state } = useGame()
  const a = t.agt
  switch (entry.kind) {
    case 'idle':
      return (
        <li className="agt-entry" data-kind="idle">
          <span className="agt-when">
            <Ago tick={entry.to} from={entry.from} />
          </span>
          <span className="agt-what">{a.idle}</span>
        </li>
      )
    case 'restart':
      return (
        <li className="agt-entry" data-kind="restart">
          <span className="agt-when">
            <Ago tick={entry.tick} />
          </span>
          <span className="agt-what">
            ↻ <b>{agentName(t, entry.agent)}</b> {a.restart}
          </span>
          {details && <EventLink id={entry.eventId} />}
        </li>
      )
    case 'outcome':
      return (
        <li className="agt-entry" data-kind="outcome" data-tone={outcomeTone(entry.row)}>
          <span className="agt-when">
            <Ago tick={entry.tick} />
          </span>
          <span className="agt-what">
            <span aria-hidden="true">◆</span>
            <DealWhat deal={entry.deal} details={false} />
          </span>
          {details && <EventLink id={entry.row.eventId} />}
        </li>
      )
    case 'line':
      return (
        <li className="agt-entry" data-kind="line">
          <span className="agt-when">
            <Ago tick={entry.tick} />
          </span>
          <span className="agt-what">
            <span aria-hidden="true">{entry.line.icon}</span>
            <span data-tone={entry.line.tone}>{lineText(t, entry.line, entry.tick, state.tickSeconds)}</span>
            {entry.line.gain != null && <span className={`gm-gain ${toneOf(entry.line.gain)}`}>{signed(entry.line.gain)}</span>}
          </span>
          {details && <EventLink id={entry.line.eventId} />}
        </li>
      )
    case 'run': {
      const { run } = entry
      const last = run.last
      const d = t.decide
      return (
        <li className="agt-entry" data-kind="run" data-blocked={run.verdict === 'denied' || undefined} data-status={run.status}>
          <span className="agt-when">
            <Ago tick={run.toTick} from={run.fromTick} />
          </span>
          <span className="agt-what">
            <RunWhat run={run} agent />
            {last.error && <Badge tone="bad">{d.error(last.error)}</Badge>}
            {last.outcome && (
              <>
                <Badge tone={last.outcome === 'good' ? 'good' : last.outcome === 'bad' ? 'bad' : 'neutral'}>{a.label[last.outcome]}</Badge>
                {last.surplus != null && <span className={`gm-gain ${toneOf(last.surplus)}`}>{signed(last.surplus)}</span>}
                {last.jevRight != null && <span className={last.jevRight ? 'gm-good' : 'gm-bad'}>{last.jevRight ? d.jevRight : d.jevWrong}</span>}
              </>
            )}
            {details && (
              <span className="agt-detail gm-muted">
                {last.text && <span>{last.text}</span>}
                {last.jev && <span>{t.hum.jev(last.jev, percent(last.jevValue))}</span>}
                {last.method && <span className="gm-mono">{last.method}</span>}
                <span className="gm-mono">#{run.rows.map((r) => r.decision).join(' #')}</span>
              </span>
            )}
          </span>
          {details && <EventLink id={last.eventId} />}
        </li>
      )
    }
  }
}

export function AgentScreen() {
  const store = useGame()
  const t = useGameStrings()
  const { state, version } = store
  const nowMs = useWallNow(5000)
  const [filter, setFilter] = useState<Filter>('all')
  const [details, setDetails] = useState(false)
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  // the state is mutated in place: the version is what changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => timeline(state, { filter, upToTick: frozenAt }), [state, version, filter, frozenAt])
  const top = useMemo(
    () => ({ statuses: agentStatuses(state), chips: healthChips(state, nowMs), blocks: blocksByRule(state), ledger: ledgerOf(state), deals: dealsOf(state, 5), tally: dealTally(state) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, version, nowMs],
  )
  const newer = frozenAt == null ? 0 : Math.max(0, state.tick - frozenAt)
  const controls = (
    <>
      <Seg
        label={t.agent.show}
        value={filter}
        options={[
          ['all', t.agt.filters.all],
          ['blocked', t.agt.filters.blocked],
          ['deals', t.agt.filters.deals],
        ]}
        onChange={setFilter}
      />
      <button type="button" className="gm-btn" aria-pressed={details} onClick={() => setDetails(!details)} title={t.agt.detailsTitle}>
        {t.agt.details}
      </button>
      <button type="button" className="gm-btn" aria-pressed={frozenAt == null} onClick={() => setFrozenAt(frozenAt == null ? state.tick : null)} title={t.agent.followTitle}>
        {t.agent.follow}
      </button>
      {newer > 0 && (
        <button type="button" className="gm-btn gm-newer" onClick={() => setFrozenAt(null)}>
          {t.agent.newer(newer)}
        </button>
      )}
    </>
  )
  return (
    <>
      <div className="agt-top">
        <AgentsPanel statuses={top.statuses} chips={top.chips} />
        <MoneyPanel ledger={top.ledger} />
      </div>
      <div className="agt-mid">
        <BlocksPanel blocks={top.blocks} />
        <DealsPanel deals={top.deals} tally={top.tally} details={details} />
      </div>
      <Panel title={t.agent.timeline} sub={t.agt.timelineSub} actions={controls}>
        {entries.length ? (
          <ol className="agt-timeline">
            {entries.map((entry) => (
              <EntryRow key={`${entry.kind}-${entry.tick}-${entryKey(entry)}`} entry={entry} details={details} />
            ))}
          </ol>
        ) : (
          <Empty>{filter === 'all' ? t.agt.waiting : t.agent.nothingKind}</Empty>
        )}
      </Panel>
    </>
  )
}

function entryKey(e: Entry): string {
  switch (e.kind) {
    case 'run':
      return `${e.run.agent}-${e.run.last.decision}`
    case 'restart':
      return `${e.agent}-${e.eventId}`
    case 'outcome':
      return `${e.row.target}-${e.row.subject}`
    case 'line':
      return `${e.line.eventId}-${e.line.text}`
    case 'idle':
      return `${e.from}`
  }
}
