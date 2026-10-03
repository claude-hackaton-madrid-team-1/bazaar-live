import type { MouseEvent } from 'react'
import { hrefOf, navigate, setParam, useParam } from '../../ui/route'
import { useDuelStrings } from '../duelStrings.ts'
import { nameOfRef } from '../cards.ts'
import { fmtP, signed } from '../game.ts'
import { agoText, ruleName, whoName } from '../humanize.ts'
import type { State } from '../state.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import {
  conversation, dealerTactics, endedGroups, negRows,
  type Bubble, type Conversation, type DealerTactics, type EndedGroup, type NegRow, type NegStatus, type TacticTally,
} from '../views/negotiations.ts'
import { dealerGroups, dealerOf, selectedIn, type DealerGroup } from '../views/negotiations-dealers.ts'
import { nowTick } from '../views/decisions.ts'
import { liveDuelCount } from '../views/duels.ts'
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
function NegCard({ r, selected, onSelect, who = true }: { r: NegRow; selected: boolean; onSelect: () => void; who?: boolean }) {
  const t = useGameStrings()
  const n = r.next
  const blocked = n?.status === 'rejected'
  const capWarn = r.cap != null && r.theirPrice != null && r.theirPrice > r.cap.cap
  return (
    <li>
      <button type="button" className="neg-card" data-state={r.state} aria-current={selected ? 'true' : undefined} onClick={onSelect}>
        <span className="neg-head">
          <Pill state={r.state} />
          {who && (
            <span className="neg-who" title={r.with}>
              {whoName(t, r.with)}
            </span>
          )}
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
          {r.cap && <Fig label={t.neg.cap} value={r.cap.cap} title={t.neg.capTitle(ruleName(t, r.cap.rule), r.cap.own)} warn={capWarn} />}
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
            <span>{blocked && n.rule ? t.neg.blockedBy(ruleName(t, n.rule)) : t.neg.decision[n.status]}</span>
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
function EndedLine({ g, selected, onSelect, who = true }: { g: EndedGroup; selected: number | null; onSelect: (id: number) => void; who?: boolean }) {
  const t = useGameStrings()
  const r = g.latest
  const first = r.ended?.firstAsk
  const many = g.rows.length > 1
  return (
    <li>
      <button type="button" className="neg-ended" aria-current={g.rows.some((x) => x.id === selected) ? 'true' : undefined} onClick={() => onSelect(r.id)}>
        <Pill state={r.state} />
        {who && (
          <span className="neg-who" title={r.with}>
            {whoName(t, r.with)}
          </span>
        )}
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

/** Each tactic with the threads that closed a deal out of the ones that used it, the ones that closed first. */
function Tallies({ tactics }: { tactics: readonly TacticTally[] }) {
  const t = useGameStrings()
  return tactics.map((x) => (
    <span key={x.tactic} className="neg-tactic" data-good={x.deals > 0 || undefined} title={t.neg.workedTallyTitle}>
      {t.neg.tactic(x.tactic)} <b>{t.neg.workedTally(x.deals, x.threads)}</b>
    </span>
  ))
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
              {whoName(t, d.with)}
            </span>
            <span className="neg-ended-meta">{t.neg.workedDealer(d.threads, d.deals)}</span>
            <Tallies tactics={d.tactics} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The duels have their own screen: one line pointing there while any is live. */
function DuelsLink({ live }: { live: number }) {
  const t = useDuelStrings()
  if (!live) return null
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate('duels')
  }
  return (
    <a className="neg-duels-link" href={hrefOf('duels', window.location.search)} onClick={go}>
      {t.link(live)}
    </a>
  )
}

/** Every dealer, or one: a chip each, with a badge of its live threads. On a phone, one row that scrolls sideways. */
function DealerChips({ groups, value }: { groups: readonly DealerGroup[]; value: string | null }) {
  const t = useGameStrings()
  const choose = (dealer: string | null) => {
    if (dealer === value) return
    setParam('id', null)
    setParam('dealer', dealer)
  }
  const chip = (key: string | null, label: string, live: number) => (
    <button key={key ?? ''} type="button" className="neg-dealer-chip" aria-pressed={key === value} onClick={() => choose(key)}>
      {label}
      {live > 0 && (
        <span className="neg-dealer-live" title={t.neg.liveSub(live)}>
          {live}
        </span>
      )}
    </button>
  )
  return (
    <nav className="neg-dealers" aria-label={t.neg.dealers}>
      {chip(null, t.neg.allDealers, groups.reduce((n, g) => n + g.live.length, 0))}
      {groups.map((g) => chip(g.with, whoName(t, g.with), g.live.length))}
    </nav>
  )
}

/** How it goes with one dealer: our edge on the deals, how they move, the tactics that closed, and when we last spoke. */
function DealerSummary({ g, state }: { g: DealerGroup; state: State }) {
  const t = useGameStrings()
  const worked = g.tactics.filter((x) => x.deals > 0)
  const tried = g.tactics.filter((x) => x.deals === 0)
  const finals = g.finals.n > 0
  const sub = [t.neg.workedDealer(g.threads, g.deals), g.lastTick != null && t.neg.lastContact(agoText(t, state, g.lastTick, nowTick(state)))].filter(Boolean).join(' · ')
  return (
    <Panel title={whoName(t, g.with)} sub={sub} className="neg-dealer">
      <div className="neg-dealer-body">
        <div className="neg-dealer-edge" title={t.neg.edgeTitle} data-tone={g.edge == null ? undefined : g.edge >= 0 ? 'good' : 'bad'}>
          <b>{g.edge == null ? t.neg.noDeal : signed(g.edge)}</b>
          {g.edge != null && <span className="neg-fig-label">{t.neg.edge}</span>}
        </div>
        <div className="neg-dealer-how">
          {(g.step != null || finals) && (
            <p className="neg-dealer-moves">
              {g.step != null && <span title={t.neg.movesTitle}>{t.neg.moves(g.step)}</span>}
              {g.step != null && finals && ' · '}
              {finals && t.neg.finals(g.finals.n, g.finals.of)}
            </p>
          )}
          {worked.length > 0 && (
            <p className="neg-dealer-tactics">
              <span className="eyebrow" title={t.neg.workedSub}>
                {t.neg.worked}
              </span>
              <Tallies tactics={worked} />
            </p>
          )}
          {tried.length > 0 && (
            <p className="neg-dealer-tactics">
              <span className="eyebrow" title={t.neg.workedSub}>
                {t.neg.tried}
              </span>
              <Tallies tactics={tried} />
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}

export function NegotiationsScreen() {
  const { state } = useGame()
  const t = useGameStrings()
  const requested = useParam('id')
  const requestedDealer = useParam('dealer')
  const all = negRows(state)
  const groups = dealerGroups(state, all)
  const dealer = dealerOf(groups, requestedDealer)
  const rows = dealer ? [...dealer.live, ...dealer.ended] : all
  const live = rows.filter((r) => r.status === 'open')
  const ended = rows.filter((r) => r.status !== 'open')
  const selected = selectedIn(rows, requested)
  const convo = selected == null ? null : conversation(state, selected)
  const select = (id: number) => setParam('id', String(id))
  const won = ended.filter((r) => r.state === 'won').length
  // in a dealer's view the dealer is in the title above: the card says enough
  const convoSub = (c: Conversation) => {
    const topic = nameOfRef(c.thread.topic) ?? c.thread.topic
    return dealer ? topic : t.neg.with(whoName(t, c.thread.with), topic)
  }
  return (
    <>
      {groups.length > 0 && <DealerChips groups={groups} value={dealer?.with ?? null} />}
      {dealer && <DealerSummary g={dealer} state={state} />}
      {(!dealer || live.length > 0) && (
        <Panel title={t.neg.live} sub={t.neg.liveSub(live.length)} actions={dealer ? undefined : <DuelsLink live={liveDuelCount(state)} />}>
          {!rows.length ? (
            <Empty>{t.neg.noThreads}</Empty>
          ) : live.length ? (
            <ul className="neg-list" aria-label={t.neg.ourThreads}>
              {live.map((r) => (
                <NegCard key={r.id} r={r} selected={r.id === selected} onSelect={() => select(r.id)} who={!dealer} />
              ))}
            </ul>
          ) : (
            <Empty>{t.neg.noLive}</Empty>
          )}
        </Panel>
      )}
      <div className="gm-split neg-split" data-dealer={dealer ? true : undefined}>
        <Panel title={t.neg.conversation} sub={convo ? convoSub(convo) : undefined}>
          <ConversationView convo={convo} />
        </Panel>
        {ended.length > 0 && (
          <Panel title={t.neg.ended} sub={t.neg.endedSub(won, ended.length - won)}>
            {!dealer && <Worked rows={dealerTactics(state, rows)} />}
            <ul className="neg-ended-list">
              {endedGroups(ended).map((g) => (
                <EndedLine key={g.key} g={g} selected={selected} onSelect={select} who={!dealer} />
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </>
  )
}
