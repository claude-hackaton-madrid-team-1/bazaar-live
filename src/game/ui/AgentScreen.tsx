import { Fragment, useMemo, useState } from 'react'
import { fmtP, PHASES, signed } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { now as nowOf, timeline, type Filter, type Line, type Now, type TickCard as Card } from '../views/agent.ts'
import { Badge, Empty, EventLink, Panel, Seg } from './bits.tsx'
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
            {now.goal || <span className="gm-muted">{t.agent.noGoal}</span>}
          </p>
          <div className="gm-why">
            <div>
              <b className="eyebrow">{t.agent.why}</b>
              <span>{now.thought ? now.thought.text : <span className="gm-muted">{t.agent.noReasoning}</span>}</span>
              {now.thought && <EventLink id={now.thought.eventId} />}
            </div>
            <div>
              <b className="eyebrow">{t.agent.did}</b>
              <span>{now.action ? `${now.action.icon} ${now.action.text}` : <span className="gm-muted">{t.agent.noAction}</span>}</span>
              {now.action && <EventLink id={now.action.eventId} />}
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
          <ul className="gm-lines">
            {lines.map((line, i) => (
              <LineRow key={`${line.eventId}-${i}`} line={line} />
            ))}
          </ul>
        </section>
      ))}
    </article>
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
    </>
  )
}
