import { useDuelStrings } from '../duelStrings.ts'
import { fmtP } from '../game.ts'
import { useGame } from '../store.ts'
import { duelHealth, duelRecord, finishedDuels, liveDuels, type DuelHealth, type DuelRecord, type FinishedDuel, type LiveDuel, type Tally } from '../views/duels.ts'
import { Badge, Empty, Panel } from './bits.tsx'

function Pill({ r }: { r: LiveDuel }) {
  const t = useDuelStrings()
  return (
    <span className="neg-pill duel-pill" data-state={r.state} title={t.stateTitle[r.state]}>
      {t.state[r.state]}
    </span>
  )
}

/** The card at stake: its name, with its barrio's colour and name when the catalog knows it. */
function Stake({ item, set }: { item: string | null; set: LiveDuel['set'] }) {
  if (!item) return null
  return (
    <span className="duel-stake" title={set ? `${set.name} · ${item}` : item}>
      <i className="gm-swatch" style={{ background: set?.color ?? 'var(--text-3)' }} />
      <span className="duel-stake-name">{item}</span>
      {set && <span className="duel-stake-set">{set.name}</span>}
    </span>
  )
}

function Fig({ label, value, tone, title, days }: { label: string; value: number | null; tone?: 'us' | 'them'; title?: string; days?: number | null }) {
  return (
    <div className="neg-fig" title={title}>
      <span className="neg-fig-label">{label}</span>
      <b data-tone={tone}>
        {fmtP(value)}
        {days != null && <small className="duel-days"> · {days}d</small>}
      </b>
    </div>
  )
}

/** One live duel: is their price inside our limit, how far apart, what the rounds cost, how long is left, what the agent did. */
function LiveCard({ r }: { r: LiveDuel }) {
  const t = useDuelStrings()
  const n = r.decision
  const blocked = n?.status === 'rejected'
  const failed = n?.status === 'failed'
  const twoIssues = r.theirDays != null || r.ourDays != null
  return (
    <li className="neg-card duel-card" data-state={r.state}>
      <span className="neg-head">
        <Pill r={r} />
        <span className="neg-who duel-rival" title={r.rival ?? undefined}>
          {r.rival ?? t.unknownRival}
        </span>
        <span className="neg-side">{r.side === 'buy' ? t.buying : t.selling}</span>
        <Stake item={r.item} set={r.set} />
        <span className="gm-spacer" />
        {r.ticksLeft != null && r.deadlineTick != null && (
          <Badge tone={r.ticksLeft <= 2 ? 'warn' : 'neutral'} title={t.leftTitle(r.deadlineTick)}>
            {t.left(r.ticksLeft)}
          </Badge>
        )}
      </span>
      <span className="neg-figs">
        <span className="neg-deal">
          <Fig label={t.their} value={r.theirPrice} tone="them" days={twoIssues ? r.theirDays : null} />
          <span className="neg-arrow" aria-hidden="true">
            →
          </span>
          <Fig label={t.our} value={r.ourPrice} tone="us" days={twoIssues ? r.ourDays : null} />
          <span className="neg-gap">
            {t.gap} {fmtP(r.gap)}
          </span>
        </span>
        <span className="duel-limit" data-inside={r.inside == null ? undefined : String(r.inside)}>
          <Fig label={t.limit} value={r.limit} title={t.limitTitle(r.side)} />
          {r.margin != null && <span className="duel-margin">{r.margin > 0 ? t.inside(r.margin) : t.outside(Math.abs(r.margin))}</span>}
        </span>
      </span>
      <span className="neg-verdict" data-state={r.state}>
        {t.verdict(r)}
      </span>
      <span className="duel-meta">
        <span>{t.rounds(r.rounds)}</span>
        {r.decayShare != null && r.decay != null && r.rounds > 0 && <span title={t.decayTitle(r.decay)}>{t.decay(r.decayShare, r.decayCost)}</span>}
        {twoIssues && <span>{t.daysNote}</span>}
      </span>
      <span className="neg-next" data-blocked={blocked || failed || undefined}>
        <span className="neg-next-label">{t.agent}</span>
        {n ? (
          <>
            <b>
              {t.action[n.action]}
              {n.price != null && ` ${fmtP(n.price)}`}
            </b>
            <span>{blocked && n.rule ? t.blockedBy(n.rule) : failed && n.error ? t.failedWith(n.error) : t.decision[n.status]}</span>
            <span className="duel-tick">{t.atTick(n.tick)}</span>
          </>
        ) : (
          <span>{t.noDecision}</span>
        )}
        {r.acceptBy != null && n?.action !== 'accept' && (
          <span className="duel-plan" title={t.acceptPlanTitle}>
            {t.acceptPlan(r.acceptBy)}
          </span>
        )}
      </span>
      <details className="neg-msg-details duel-details">
        <summary>{t.details}</summary>
        <span>{t.detailsLine(r.id, r.session, r.deadlineTick)}</span>
      </details>
    </li>
  )
}

/** The duels agent in one line: alive or silent since when, and what blocks it most. Loud only when it matters. */
function Health({ h, label = false }: { h: DuelHealth; label?: boolean }) {
  const t = useDuelStrings()
  const s = h.status
  if (!s) return null
  const tone = s.state === 'ok' ? 'good' : s.state === 'none' ? 'neutral' : s.state === 'quiet' || h.live === 0 ? 'warn' : 'bad'
  return (
    <div className="duel-health" data-tone={tone}>
      {label && <span className="neg-next-label">{t.health}</span>}
      <Badge tone={tone}>{t.healthState[s.state]}</Badge>
      {s.state !== 'none' && (
        <span>{s.state === 'silent' || s.state === 'quiet' ? t.silentSince(h.lastTick, s.silentFor) : h.lastTick != null ? t.decidedAt(h.lastTick) : t.silentSince(null, null)}</span>
      )}
      {s.state !== 'none' && <span className="duel-health-block">{s.topBlock ? t.topBlock(s.topBlock.rule, s.topBlock.count) : t.noBlock}</span>}
    </div>
  )
}

const gainText = (g: number | null) => (g == null ? '—' : fmtP(g))

function TallyRow({ name, unknown, rival, tally, live }: { name: string; unknown?: boolean; rival?: boolean; tally: Tally; live?: boolean }) {
  const t = useDuelStrings()
  return (
    <tr data-live={live || undefined}>
      <th scope="row" className="duel-rec-name" data-unknown={unknown || undefined} data-rival={rival || undefined} title={name}>
        {name}
        {tally.live > 0 && <Badge tone="warn">{t.liveBadge(tally.live)}</Badge>}
      </th>
      <td className="gm-r">{tally.duels}</td>
      <td className={tally.deals > 0 ? 'gm-r gm-good' : 'gm-r'}>{tally.deals}</td>
      <td className="gm-r">{tally.noDeals}</td>
      <td className="gm-r">{gainText(tally.gain)}</td>
    </tr>
  )
}

function RecordTable({ caption, rows }: { caption: string; rows: { key: string; name: string; unknown?: boolean; rival?: boolean; tally: Tally }[] }) {
  const t = useDuelStrings()
  return (
    <div className="gm-scroll">
      <table className="gm-table duel-rec">
        <caption className="eyebrow">{caption}</caption>
        <thead>
          <tr>
            <th>{t.col.who}</th>
            <th className="gm-r">{t.col.duels}</th>
            <th className="gm-r">{t.col.deals}</th>
            <th className="gm-r">{t.col.noDeals}</th>
            <th className="gm-r" title={t.gainTitle}>
              {t.col.gain}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <TallyRow key={r.key} name={r.name} unknown={r.unknown} rival={r.rival} tally={r.tally} live={r.tally.live > 0} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Record({ rec }: { rec: DuelRecord }) {
  const t = useDuelStrings()
  const finished = rec.total.deals + rec.total.noDeals
  return (
    <>
      <dl className="duel-kpis">
        <div title={t.scorePointsTitle}>
          <dt>{t.scorePoints}</dt>
          <dd>{rec.scorePoints ?? '—'}</dd>
        </div>
        <div>
          <dt>{t.col.deals}</dt>
          <dd>{t.dealsOf(rec.total.deals, finished)}</dd>
        </div>
        <div title={t.gainTitle}>
          <dt>{t.gainTotal}</dt>
          <dd>{gainText(rec.total.gain)}</dd>
        </div>
      </dl>
      <RecordTable
        caption={t.perRival}
        rows={rec.rivals.map((r) => ({ key: r.rival ?? '', name: r.rival ?? t.unknownRival, unknown: r.rival === null, rival: true, tally: r }))}
      />
      {rec.sessions.length > 1 && <RecordTable caption={t.perSession} rows={rec.sessions.map((s) => ({ key: String(s.session), name: t.session(s.session), tally: s }))} />}
    </>
  )
}

function FinishedLine({ d }: { d: FinishedDuel }) {
  const t = useDuelStrings()
  return (
    <li className="duel-done" data-deal={d.deal || undefined}>
      <Badge tone={d.deal ? 'good' : 'neutral'}>{d.deal ? t.dealBadge : t.noDeal}</Badge>
      <span className="neg-who duel-rival" title={d.rival ?? undefined}>
        {d.rival ?? t.unknownRival}
      </span>
      <span className="neg-side">{d.side === 'buy' ? t.buying : t.selling}</span>
      <Stake item={d.item} set={d.set} />
      {d.deal && <span className="duel-done-text">{t.deal(d.price, d.limit, d.edge)}</span>}
      <span className="duel-done-meta">
        {d.gain != null && d.deal && <b className="gm-good">{t.kept(d.gain)}</b>}
        {d.points != null && <span>{t.pts(d.points)}</span>}
        <span>{t.rounds(d.rounds)}</span>
        {d.tick != null && d.tick > 0 && <span>{t.endedAt(d.tick)}</span>}
      </span>
    </li>
  )
}

export function DuelsScreen() {
  const { state } = useGame()
  const t = useDuelStrings()
  const live = liveDuels(state)
  const done = finishedDuels(state)
  const rec = duelRecord(state)
  const health = duelHealth(state)
  const alarm = health.status != null && live.length > 0 && (health.status.state === 'silent' || health.status.state === 'stuck')
  if (!live.length && !done.length) {
    return (
      <Panel title={t.live}>
        <Empty>{t.noDuels}</Empty>
      </Panel>
    )
  }
  return (
    <>
      <Panel title={t.live} sub={t.liveSub(live.length)}>
        {alarm && <Health h={health} label />}
        {live.length ? (
          <ul className="neg-list duel-list">
            {live.map((r) => (
              <LiveCard key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <Empty>{t.noLive}</Empty>
        )}
      </Panel>
      <div className="gm-split duel-split">
        <Panel title={t.record} sub={t.recordSub}>
          <Record rec={rec} />
        </Panel>
        <Panel title={t.finished} sub={t.finishedSub(rec.total.deals, rec.total.noDeals)}>
          {done.length ? (
            <ul className="duel-done-list">
              {done.map((d) => (
                <FinishedLine key={d.id} d={d} />
              ))}
            </ul>
          ) : (
            <Empty>{t.noFinished}</Empty>
          )}
        </Panel>
      </div>
      <Panel title={t.health}>
        <Health h={health} />
      </Panel>
    </>
  )
}
