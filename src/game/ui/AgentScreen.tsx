import { Fragment, useMemo, useState } from 'react'
import type { DecisionRow } from '../decisions.ts'
import { fmtP, PHASES, setOf, signed } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { now as nowOf, timeline, type Filter, type Line, type Now, type TickCard as Card } from '../views/agent.ts'
import { blocksByRule, deals as dealsOf, isWrite, ledger as ledgerOf, share, STATUS_TONE, type Blocks, type DecideSlot, type Deal, type Ledger, type Run } from '../views/decisions.ts'
import { Badge, Empty, EventLink, Panel, RefChip, Seg } from './bits.tsx'
import { toneOf } from './tone.ts'

function NowStrip({ now }: { now: Now }) {
  const t = useGameStrings()
  return (
    <Panel title={t.agent.now} sub={`${t.tick} ${now.tick}`}>
      <div className="gm-now">
        <div className="gm-now-main">
          <ol className="gm-steps" aria-label={t.agent.loop}>
            {PHASES.map((p, i) => (
              <Fragment key={p}>
                {i > 0 && (
                  <li className="gm-step-arrow" aria-hidden="true">
                    →
                  </li>
                )}
                <li className="gm-step" data-state={i === now.phaseIndex ? 'live' : i < now.phaseIndex ? 'done' : 'next'} aria-current={i === now.phaseIndex ? 'step' : undefined}>
                  {t.phases[p]}
                </li>
              </Fragment>
            ))}
          </ol>
          <p className="gm-goal">
            <span className="eyebrow">{t.agent.goal}</span>
            {now.goal || (now.decision ? t.decide.goal(now.decision.agent, now.decision.kind, now.decision.item, now.decision.counterparty) : <span className="gm-muted">{t.agent.noGoal}</span>)}
          </p>
          <div className="gm-why">
            <div>
              <b className="eyebrow">{t.agent.why}</b>
              {now.thought ? (
                <>
                  <span>{now.thought.text}</span>
                  <EventLink id={now.thought.eventId} />
                </>
              ) : now.decision ? (
                <>
                  <span>
                    <Why row={now.decision} />
                  </span>
                  <EventLink id={now.decision.eventId}>#{now.decision.decision}</EventLink>
                </>
              ) : (
                <span className="gm-muted">{t.agent.noReasoning}</span>
              )}
            </div>
            <div>
              <b className="eyebrow">{t.agent.did}</b>
              {now.action ? (
                <>
                  <span>{`${now.action.icon} ${now.action.text}`}</span>
                  <EventLink id={now.action.eventId} />
                </>
              ) : now.executed?.method ? (
                <>
                  <span>
                    {t.decide.did(now.executed.agent, now.executed.method, now.executed.item, now.executed.price != null ? fmtP(now.executed.price) : null)}
                    {' · '}
                    {t.tick} {now.executed.tick}
                  </span>
                  <EventLink id={now.executed.eventId}>#{now.executed.decision}</EventLink>
                </>
              ) : (
                <span className="gm-muted">{t.agent.noAction}</span>
              )}
            </div>
          </div>
        </div>
        <dl className="gm-facts">
          <div>
            <dt className="eyebrow">{t.agent.openThreads}</dt>
            <dd>{now.openThreads}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t.agent.ourTrades}</dt>
            <dd>{now.trades}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t.agent.gained}</dt>
            <dd className={now.trades ? toneOf(now.gain) : undefined}>{now.trades ? signed(now.gain) : '—'}</dd>
          </div>
          <div>
            <dt className="eyebrow">{t.cash}</dt>
            <dd>{fmtP(now.cash)}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  )
}

function LineRow({ line }: { line: Line }) {
  const t = useGameStrings()
  return (
    <li className="gm-line">
      <span className="gm-line-icon" aria-hidden="true">
        {line.icon}
      </span>
      <span className="gm-line-body">
        <span className={line.type === 'agent.thought' ? 'gm-thought' : undefined} data-tone={line.tone}>
          {line.text}
        </span>
        {line.final && <Badge tone="warn">{t.badge.final}</Badge>}
        {line.suspicious && (
          <Badge tone="bad" title={t.badge.injectionTitle}>
            {t.badge.injection}
          </Badge>
        )}
        {line.gain != null && <span className={`gm-gain ${toneOf(line.gain)}`}>{signed(line.gain)}</span>}
        {line.quote && <span className="gm-quote" data-flagged={line.suspicious || undefined}>“{line.quote}”</span>}
      </span>
      <EventLink id={line.eventId} />
    </li>
  )
}

/** An item: a card with its barrio's colour, or a pack, a name or a duel as plain mono text. */
function Item({ item }: { item: string }) {
  return setOf(item) ? <RefChip topic={item} /> : <span className="gm-mono gm-dec-item">{item}</span>
}

/** Why a decision went the way it did: the guardrail's answer (and the rule that blocked it) and Jev's verdict. */
function Why({ row }: { row: DecisionRow }) {
  const d = useGameStrings().decide
  return (
    <>
      {row.verdict === 'allowed' && <span className="gm-good">✓ {d.allowed}</span>}
      {row.verdict === 'denied' && (
        <span className="gm-dec-rule">
          <span className="gm-bad">✖ {d.blockedBy}</span> <b className="gm-mono">{row.rule}</b>
          {row.text && <span className="gm-muted"> · {row.text}</span>}
        </span>
      )}
      {row.verdict == null && isWrite(row.kind) && <span className="gm-muted">{d.noCheck}</span>}
      {row.jev && (
        <span className="gm-dec-jev">
          {' '}
          {d.jev} <b>{row.jev}</b>
          {row.jevValue != null && <span className="gm-muted"> {row.jevValue.toFixed(2)}</span>}
        </span>
      )}
    </>
  )
}

/** One decision: agent · kind · item · counterparty · price · guardrail · Jev · status (and how it ended). */
function DecisionLine({ row, run }: { row: DecisionRow; run: Run | null }) {
  const t = useGameStrings()
  const d = t.decide
  const price = run && run.low != null && run.high != null && run.low !== run.high ? `${run.low}–${fmtP(run.high)}` : row.price != null ? fmtP(row.price) : null
  return (
    <li className="gm-dec" data-status={row.status}>
      <span className="gm-dec-agent gm-mono">{row.agent}</span>
      <span className="gm-dec-body">
        <span className="gm-dec-what">
          <span className="gm-mono">{d.kind(row.kind)}</span>
          {row.item && <Item item={row.item} />}
          {row.counterparty && <span className="gm-muted">· {row.counterparty}</span>}
          {price != null && <b className="gm-dec-price">{price}</b>}
          {isWrite(row.kind) && <Badge tone={STATUS_TONE[row.status]}>{d.status[row.status]}</Badge>}
          {run && <span className="gm-muted gm-num">{d.run(run.count, run.from, run.to)}</span>}
          {row.error && <Badge tone="bad">{d.error(row.error)}</Badge>}
        </span>
        <span className="gm-dec-why">
          <Why row={row} />
          {row.outcome && (
            <span className="gm-dec-out">
              <Badge tone={row.outcome === 'good' ? 'good' : row.outcome === 'bad' ? 'bad' : 'neutral'}>{row.outcome}</Badge>
              {row.surplus != null && <span className={`gm-gain ${toneOf(row.surplus)}`}>{signed(row.surplus)}</span>}
              {row.jevRight != null && <span className={row.jevRight ? 'gm-good' : 'gm-bad'}>{row.jevRight ? d.jevRight : d.jevWrong}</span>}
            </span>
          )}
        </span>
      </span>
      <EventLink id={row.eventId}>#{row.decision}</EventLink>
    </li>
  )
}

function DecideSlots({ slots }: { slots: DecideSlot[] }) {
  const t = useGameStrings()
  return (
    <ul className="gm-decs">
      {slots.map((slot) =>
        slot.kind === 'row' ? (
          <DecisionLine key={slot.row.decision} row={slot.row} run={slot.run} />
        ) : (
          <li key="idle" className="gm-dec gm-dec-idle">
            <span className="gm-muted">{t.decide.idle(slot.agents)}</span>
          </li>
        ),
      )}
    </ul>
  )
}

function TickCard({ card, current }: { card: Card; current: boolean }) {
  const t = useGameStrings()
  return (
    <article className="gm-tick" data-current={current || undefined}>
      <header className="gm-tick-head">
        <span className="gm-tick-no">
          {t.tick} {card.tick}
          {current && <span className="gm-muted"> · {t.agent.now_}</span>}
        </span>
        {card.deals > 0 && (
          <span className="gm-tick-meta">
            <span className="gm-muted">{t.agent.deals(card.deals)}</span>
            <span className={toneOf(card.gain)}>{signed(card.gain)}</span>
          </span>
        )}
      </header>
      {card.lanes.map(({ lane, lines }) => (
        <section key={lane} className="gm-lane" data-lane={lane}>
          <div className="gm-lane-name eyebrow">{t.lanes[lane]}</div>
          <div className="gm-lane-body">
            {lines.length > 0 && (
              <ul className="gm-lines">
                {lines.map((line, i) => (
                  <LineRow key={`${line.eventId}-${i}`} line={line} />
                ))}
              </ul>
            )}
            {lane === 'decide' && card.decide.length > 0 && <DecideSlots slots={card.decide} />}
          </div>
        </section>
      ))}
    </article>
  )
}

function BlocksTile({ blocks }: { blocks: Blocks }) {
  const t = useGameStrings()
  const top = blocks.rules[0]?.count ?? 0
  return (
    <Panel title={t.decide.blocks} sub={t.decide.blocksSub(blocks.fromTick)}>
      {blocks.rules.length ? (
        <ul className="gm-rules">
          {blocks.rules.map((r) => (
            <li key={r.rule} className="gm-rule" title={r.agents.join(', ')}>
              <span className="gm-rule-head">
                <b className="gm-mono">{r.rule}</b>
                <span className="gm-num">{t.decide.times(r.count)}</span>
              </span>
              <span className="gm-track" aria-hidden="true">
                <span className="gm-fill gm-fill-bad" style={{ width: `${Math.round(share(r.count, top) * 100)}%` }} />
              </span>
              <span className="gm-rule-meta gm-muted">
                {r.agents.join(' · ')} · {t.tick} {r.lastTick}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t.decide.noBlocks}</Empty>
      )}
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

function LedgerTile({ ledger }: { ledger: Ledger | null }) {
  const t = useGameStrings()
  return (
    <Panel title={t.decide.ledger} sub={t.decide.ledgerSub}>
      {ledger ? (
        <>
          <dl className="gm-meters">
            <Meter label={t.decide.spent} value={ledger.spent} cap={ledger.limits.spendPerHour} text={`${fmtP(ledger.spent)} / ${fmtP(ledger.limits.spendPerHour)}`} />
            <Meter label={t.decide.cashFloor} value={ledger.cash} cap={ledger.limits.cashFloor} text={`${fmtP(ledger.cash)} / ${fmtP(ledger.limits.cashFloor)}`} invert />
            <Meter label={t.decide.accepts} value={ledger.accepts} cap={ledger.limits.acceptsPerTick} text={`${ledger.accepts} / ${ledger.limits.acceptsPerTick}`} />
          </dl>
          <p className="gm-meter-note gm-muted">{t.decide.headroom(fmtP(ledger.headroom))}</p>
        </>
      ) : (
        <Empty>{t.decide.noLedger}</Empty>
      )}
    </Panel>
  )
}

/** An outcome's subject as its real id: `thread:574` → `thread #574`. */
const subjectLabel = (subject: string): string => subject.replace(':', ' #')

function DealsTile({ deals }: { deals: Deal[] }) {
  const t = useGameStrings()
  const d = t.decide
  return (
    <Panel title={d.deals} sub={d.dealsSub}>
      {deals.length ? (
        <ul className="gm-deals">
          {deals.map(({ row, value, edge, verdict }) => (
            <li key={`${row.target}-${row.subject}`} className="gm-deal">
              <span className="gm-deal-head">
                {row.item ? <Item item={row.item} /> : <span className="gm-mono">{row.subject}</span>}
                <span className="gm-muted">
                  {d.target[row.target]}
                  {row.counterparty && ` · ${row.counterparty}`}
                </span>
                <EventLink id={row.eventId}>{subjectLabel(row.subject)}</EventLink>
              </span>
              <span className="gm-deal-body">
                {row.price != null && (
                  <span>
                    {fmtP(row.price)}
                    {value != null && <span className="gm-muted"> vs {fmtP(value)}</span>}
                  </span>
                )}
                {edge != null && verdict != null ? (
                  <span className={toneOf(edge)}>
                    <span className="gm-gain">{edge === 0 ? '±0 P' : signed(edge)}</span> {d[verdict]}
                  </span>
                ) : (
                  <span className="gm-muted">{row.price != null ? d.noValue : d.unscored}</span>
                )}
                {row.jev && (
                  <span>
                    {d.jev} <b>{row.jev}</b>
                    {row.jevRight != null && <span className={row.jevRight ? 'gm-good' : 'gm-bad'}> · {row.jevRight ? d.jevRight : d.jevWrong}</span>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{d.noDeals}</Empty>
      )}
    </Panel>
  )
}

export function AgentScreen() {
  const store = useGame()
  const t = useGameStrings()
  const { state, version } = store
  const [filter, setFilter] = useState<Filter>('all')
  const [frozenAt, setFrozenAt] = useState<number | null>(null)
  // the state is mutated in place: the version is what changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cards = useMemo(() => timeline(state, { filter, upToTick: frozenAt }), [state, version, filter, frozenAt])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const current = useMemo(() => nowOf(state), [state, version])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const side = useMemo(() => ({ blocks: blocksByRule(state), ledger: ledgerOf(state), deals: dealsOf(state) }), [state, version])
  const newer = frozenAt == null ? 0 : Math.max(0, state.tick - frozenAt)
  const controls = (
    <>
      <Seg
        label={t.agent.show}
        value={filter}
        options={[
          ['all', t.agent.filters.all],
          ['actions', t.agent.filters.actions],
          ['deals', t.agent.filters.deals],
        ]}
        onChange={setFilter}
      />
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
      <NowStrip now={current} />
      <div className="gm-agent-layout">
        <Panel title={t.agent.timeline} sub={t.agent.timelineSub} actions={controls}>
          {cards.length ? (
            <div className="gm-ticks">
              {cards.map((card) => (
                <TickCard key={card.tick} card={card} current={card.tick === state.tick} />
              ))}
            </div>
          ) : (
            <Empty>{filter === 'all' ? t.agent.waiting : t.agent.nothingKind}</Empty>
          )}
        </Panel>
        <aside className="gm-agent-side">
          <LedgerTile ledger={side.ledger} />
          <BlocksTile blocks={side.blocks} />
          <DealsTile deals={side.deals} />
        </aside>
      </div>
    </>
  )
}
