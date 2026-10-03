import { setParam, useParam } from '../../ui/route'
import { fmtP } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import {
  conversation, dealerTactics, duelColumns, duelRows, endedGroups, negRows, rivalSummary, selectedThreadId,
  type Bubble, type Conversation, type DealerTactics, type DuelRow, type EndedGroup, type NegRow, type NegStatus, type RivalRow,
} from '../views/negotiations.ts'
import { Badge, Empty, EventLink, Injection, Panel, RefChip } from './bits.tsx'

function Pill({ state }: { state: NegStatus }) {
  const t = useGameStrings()
  return (
    <span className="neg-pill" data-state={state} title={t.neg.statusTitle[state]}>
      {t.neg.status[state]}
    </span>
  )
}

function Fig({ label, value, tone, title, warn }: { label: string; value: number | null; tone?: 'us' | 'them'; title?: string; warn?: boolean }) {
  return (
    <div className="neg-fig" title={title} data-warn={warn || undefined}>
      <span className="neg-fig-label">{label}</span>
      <b data-tone={tone}>{fmtP(value)}</b>
    </div>
  )
}

/** One live negotiation: who, what, the prices against our value and cap, the verdict, and the agent's last call. */
function NegCard({ r, selected, onSelect }: { r: NegRow; selected: boolean; onSelect: () => void }) {
  const t = useGameStrings()
  const n = r.next
  const blocked = n?.status === 'rejected'
  const capWarn = r.cap != null && r.theirPrice != null && r.theirPrice > r.cap.cap
  return (
    <li>
      <button type="button" className="neg-card" data-state={r.state} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
        <span className="neg-head">
          <Pill state={r.state} />
          <span className="neg-who" title={r.with}>
            {r.with}
          </span>
          <span className="neg-side">{r.side === 'buy' ? t.neg.buying : t.neg.selling}</span>
          <RefChip topic={r.topic} />
          {r.set && <span className="gm-muted neg-set">{r.set.name}</span>}
          <span className="gm-spacer" />
          {r.final && <Badge tone="warn">{t.badge.final}</Badge>}
          <Injection on={r.suspicious} />
          {r.ticksLeft != null && (
            <Badge tone={r.ticksLeft <= 1 ? 'warn' : 'neutral'} title={t.neg.leftTitle}>
              {t.neg.left(Math.max(0, r.ticksLeft))}
            </Badge>
          )}
        </span>
        <span className="neg-figs">
          <span className="neg-deal">
            <Fig label={t.neg.their(t.neg[r.theirLabel])} value={r.theirPrice} tone="them" />
            <span className="neg-arrow" aria-hidden="true">
              →
            </span>
            <Fig label={t.neg.our(t.neg[r.ourLabel])} value={r.ourPrice} tone="us" />
            <span className="neg-gap">
              {t.neg.gap} {fmtP(r.gap)}
            </span>
          </span>
          <Fig label={t.neg.value} value={r.value} title={t.neg.valueTitle} />
          {r.cap && <Fig label={t.neg.cap} value={r.cap.cap} title={t.neg.capTitle(r.cap.rule, r.cap.own)} warn={capWarn} />}
        </span>
        <span className="neg-verdict" data-state={r.state}>
          {t.neg.verdict(r.verdict, r.side)}
        </span>
        {n && (
          <span className="neg-next" data-blocked={blocked || undefined}>
            <span className="neg-next-label">{t.neg.agent}</span>
            <b>
              {t.neg.action[n.action]}
              {n.price != null && ` ${fmtP(n.price)}`}
            </b>
            <span>{blocked && n.rule ? t.neg.blockedBy(n.rule) : t.neg.decision[n.status]}</span>
            {blocked && n.text && <span className="neg-next-why">{n.text}</span>}
          </span>
        )}
      </button>
    </li>
  )
}

function Tactic({ id }: { id: string }) {
  const t = useGameStrings()
  return (
    <span className="neg-tactic" data-tactic={id} title={t.neg.tacticTitle}>
      {t.neg.tactic(id)}
    </span>
  )
}

/**
 * Ended threads on one dealer and card in one line: how the newest ended against our value, how far the dealer came
 * down, the tactics we used, and ×N when we tried more than once. Selecting it opens the newest.
 */
function EndedLine({ g, selected, onSelect }: { g: EndedGroup; selected: number | null; onSelect: (id: number) => void }) {
  const t = useGameStrings()
  const r = g.latest
  const first = r.ended?.firstAsk
  const many = g.rows.length > 1
  return (
    <li>
      <button type="button" className="neg-ended" aria-current={g.rows.some((x) => x.id === selected) ? 'true' : undefined} onClick={() => onSelect(r.id)}>
        <Pill state={r.state} />
        <span className="neg-who" title={r.with}>
          {r.with}
        </span>
        <RefChip topic={r.topic} />
        {many && (
          <Badge tone="neutral">
            {t.neg.times(g.rows.length)}
          </Badge>
        )}
        <span className="neg-ended-text" data-state={r.state}>
          {t.neg.verdict(r.verdict, r.side)}
        </span>
        {r.tactics.map((id) => (
          <Tactic key={id} id={id} />
        ))}
        <span className="neg-ended-meta">
          {first != null && `${t.neg.opened(first)} · `}
          {t.neg.rounds(r.rounds)}
        </span>
      </button>
      {many && (
        <details className="neg-ended-more">
          <summary>{t.neg.timesTitle(g.rows.length - 1)}</summary>
          {g.rows.slice(1).map((x) => (
            <button key={x.id} type="button" className="gm-eid" aria-pressed={x.id === selected} onClick={() => onSelect(x.id)}>
              #{x.id}
            </button>
          ))}
        </details>
      )}
    </li>
  )
}

function BubbleItem({ b, who }: { b: Bubble; who: string }) {
  const t = useGameStrings()
  return (
    <li className="neg-msg" data-side={b.side}>
      <div className="neg-msg-body">
        <span className="neg-chip" data-side={b.side}>
          {fmtP(b.price)}
        </span>
        {b.tactic && <Tactic id={b.tactic} />}
        {b.final && <Badge tone="warn">{t.badge.final}</Badge>}
        <Injection on={b.suspicious} />
        {b.text != null ? <span className="neg-msg-text">{b.text}</span> : <span className="neg-msg-who">{who}</span>}
      </div>
      <details className="neg-msg-details">
        <summary>{t.neg.details}</summary>
        <span>
          {t.neg.detailsLine(b)} <EventLink id={b.eventId} />
        </span>
      </details>
    </li>
  )
}

function ConversationView({ convo }: { convo: Conversation | null }) {
  const t = useGameStrings()
  if (!convo) return <Empty>{t.neg.noThread}</Empty>
  const { thread: th, bubbles } = convo
  if (!bubbles.length) return <Empty>{t.neg.noOffers}</Empty>
  return (
    <ol className="neg-convo" aria-label={t.neg.convoLabel(th.id)}>
      {bubbles.map((b) => (
        <BubbleItem key={b.eventId} b={b} who={b.side === 'us' ? t.neg.we : b.maker} />
      ))}
    </ol>
  )
}

/** Per dealer, each tactic of our ended threads with how many of them closed a deal: what to try again. */
function Worked({ rows }: { rows: DealerTactics[] }) {
  const t = useGameStrings()
  if (!rows.length) return null
  return (
    <section className="neg-worked" aria-label={t.neg.worked}>
      <h3 className="eyebrow" title={t.neg.workedSub}>
        {t.neg.worked}
      </h3>
      <ul className="neg-worked-list">
        {rows.map((d) => (
          <li key={d.with} className="neg-worked-row">
            <span className="neg-who" title={d.with}>
              {d.with}
            </span>
            <span className="neg-ended-meta">{t.neg.workedDealer(d.threads, d.deals)}</span>
            {d.tactics.map((x) => (
              <span key={x.tactic} className="neg-tactic" data-good={x.deals > 0 || undefined} title={t.neg.workedTallyTitle}>
                {t.neg.tactic(x.tactic)} <b>{t.neg.workedTally(x.deals, x.threads)}</b>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Rivals({ rows }: { rows: RivalRow[] }) {
  const t = useGameStrings()
  if (!rows.length) return null
  return (
    <section className="gm-rivals-wrap" aria-label={t.neg.against}>
      <h3 className="eyebrow">{t.neg.against}</h3>
      <ul className="gm-rivals">
        {rows.map((r) => (
          <li key={r.rival ?? ''} className="gm-rival" data-live={r.open > 0 || undefined}>
            <span className="gm-row">
              <span className="gm-rival-name" data-unknown={r.rival === null || undefined} title={r.rival ?? undefined}>
                {r.rival ?? t.neg.unknownRival}
              </span>
              <span className="gm-spacer" />
              {r.open > 0 && <Badge tone="warn">{t.neg.duelsSub(r.open)}</Badge>}
            </span>
            <span className="gm-rival-meta">{t.neg.rivalDuels(r.duels, r.finished)}</span>
            <span className="gm-rival-meta">
              <span>{t.neg.rivalDeals(r.deals, r.noDeals)}</span>
              <span className="gm-spacer" />
              <span title={r.points == null ? t.neg.rivalPointsNone : undefined} className={r.points == null ? 'gm-muted' : r.points > 0 ? 'gm-good' : undefined}>
                {t.neg.rivalPoints(r.points)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const days = (d: number | null) => (d == null ? '' : ` · ${d}d`)

function DuelsTable({ rows }: { rows: DuelRow[] }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.neg.noDuels}</Empty>
  const show = duelColumns(rows)
  const c = t.neg.duelCol
  return (
    <div className="gm-scroll">
      <table className="gm-table">
        <thead>
          <tr>
            <th>{c.duel}</th>
            <th>{c.rival}</th>
            {show.role && <th>{c.role}</th>}
            <th className="gm-r">{c.us}</th>
            <th className="gm-r">{c.them}</th>
            <th className="gm-r">{c.gap}</th>
            <th className="gm-r">{c.rounds}</th>
            <th>{c.status}</th>
            <th className="gm-r">{c.deal}</th>
            {show.points && <th className="gm-r">{c.points}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} data-live={d.status === 'open' || undefined}>
              <td>
                #{d.id}
                {d.item && <span className="gm-duel-item">{d.item}</span>}
              </td>
              <td className="gm-rival-cell" data-tone="them" title={d.rival ?? undefined}>
                {d.rival ?? '—'}
              </td>
              {show.role && <td>{d.role}</td>}
              <td className="gm-r" data-tone="us">
                {fmtP(d.ourPrice)}
                {show.days && days(d.ourDays)}
              </td>
              <td className="gm-r" data-tone="them">
                {fmtP(d.theirPrice)}
                {show.days && days(d.theirDays)}
              </td>
              <td className="gm-r">{fmtP(d.gap)}</td>
              <td className="gm-r">{d.rounds}</td>
              <td>
                <Badge tone={d.tone}>{t.neg.duelStatus[d.status]}</Badge>
                {d.ticksLeft !== null && <span className="gm-duel-left">{t.neg.ticksLeft(d.ticksLeft)}</span>}
              </td>
              <td className="gm-r">{fmtP(d.dealPrice)}</td>
              {show.points && <td className="gm-r">{d.points ?? '—'}</td>}
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
  const rows = negRows(state)
  const live = rows.filter((r) => r.status === 'open')
  const ended = rows.filter((r) => r.status !== 'open')
  const selected = selectedThreadId(state, requested)
  const convo = selected == null ? null : conversation(state, selected)
  const duels = duelRows(state)
  const select = (id: number) => setParam('id', String(id))
  const won = ended.filter((r) => r.state === 'won').length
  return (
    <>
      <Panel title={t.neg.live} sub={t.neg.liveSub(live.length)}>
        {!rows.length ? (
          <Empty>{t.neg.noThreads}</Empty>
        ) : live.length ? (
          <ul className="neg-list" aria-label={t.neg.ourThreads}>
            {live.map((r) => (
              <NegCard key={r.id} r={r} selected={r.id === selected} onSelect={() => select(r.id)} />
            ))}
          </ul>
        ) : (
          <Empty>{t.neg.noLive}</Empty>
        )}
      </Panel>
      <div className="gm-split neg-split">
        <Panel title={t.neg.conversation} sub={convo ? t.neg.with(convo.thread.with, convo.thread.topic) : undefined}>
          <ConversationView convo={convo} />
        </Panel>
        {ended.length > 0 && (
          <Panel title={t.neg.ended} sub={t.neg.endedSub(won, ended.length - won)}>
            <Worked rows={dealerTactics(state, rows)} />
            <ul className="neg-ended-list">
              {endedGroups(ended).map((g) => (
                <EndedLine key={g.key} g={g} selected={selected} onSelect={select} />
              ))}
            </ul>
          </Panel>
        )}
      </div>
      <Panel title={t.neg.duels} sub={t.neg.duelsSub(duels.filter((d) => d.status === 'open').length)}>
        <Rivals rows={rivalSummary(state)} />
        <DuelsTable rows={duels} />
      </Panel>
    </>
  )
}
