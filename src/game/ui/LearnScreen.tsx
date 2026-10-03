import { useMemo, useState } from 'react'
import { fmtP } from '../game.ts'
import { pagePush } from '../fresh.ts'
import { useLearn } from '../learn.ts'
import { useGameStrings, type GameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { learningGroups, moveTone, pct, recentMoves, rivalRows, traderProfiles, type LearningRow, type MoveFilter, type TraderProfile } from '../views/learn.ts'
import { useParam } from '../../ui/route'
import type { LearnParts, RivalProfile, TraderMove } from '../../../shared/learn.ts'
import { Badge, Empty, Fresh, Panel, Seg } from './bits.tsx'
import { NoticeBar } from './GameHeader.tsx'

/** Header cells; the indexes in `right` are numbers, aligned right. */
function Head({ cells, right, hints = {} }: { cells: readonly string[]; right: readonly number[]; hints?: Readonly<Record<number, string>> }) {
  return (
    <thead>
      <tr>
        {cells.map((h, i) => (
          <th key={h} className={right.includes(i) ? 'gm-r' : undefined} title={hints[i]}>
            {h}
          </th>
        ))}
      </tr>
    </thead>
  )
}

const num1 = (n: number | null): string => (n === null ? '—' : String(Math.round(n * 10) / 10))

/** Said only while the server reads the database but that view is not applied yet. */
function Missing({ part, parts, live }: { part: keyof LearnParts; parts: LearnParts; live: boolean }) {
  const t = useGameStrings()
  return !live || parts[part] ? null : <span className="gm-warn"> · {t.learn.missing}</span>
}

function LearningLine({ l, t }: { l: LearningRow; t: GameStrings }) {
  return (
    <li className="gm-learning" data-kind={l.kind}>
      <div className="gm-learning-head">
        <Badge tone={l.left !== null ? (l.left <= 2 ? 'warn' : 'bad') : l.kind === 'lesson' || l.kind === 'policy' ? 'good' : 'neutral'}>{t.learn.kinds[l.kind] ?? l.kind}</Badge>
        <b className="gm-learning-subject">{l.subject}</b>
        {l.team && <span className="gm-muted">· {l.team === 't01' ? t.learn.forUs : l.team}</span>}
        <span className="gm-spacer" />
        {l.left !== null ? (
          <span className="gm-mono">{t.learn.lifts(l.left)}</span>
        ) : (
          l.untilTick === null && ['blocker', 'cooloff', 'quota', 'sold_out'].includes(l.kind) && <span className="gm-mono gm-muted">{t.learn.liftsUnknown}</span>
        )}
      </div>
      <q className="gm-learning-claim">{l.claim}</q>
      <div className="gm-learning-meta">
        <span className="gm-learning-conf" title={`${t.learn.confidence} ${pct(l.confidence)}`}>
          <span className="gm-track">
            <span className="gm-fill" style={{ width: `${Math.round(l.confidence * 100)}%` }} />
          </span>
          <span className="gm-mono">{pct(l.confidence)}</span>
        </span>
        <span className="gm-mono gm-muted">{t.learn.support(l.support)}</span>
        <span className="gm-mono gm-muted">{t.learn.sources[l.source] ?? l.source}</span>
        {l.createdTick !== null && <span className="gm-mono gm-muted">t{l.createdTick}</span>}
      </div>
    </li>
  )
}

function Learnings({ rows, empty }: { rows: LearningRow[]; empty: string }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{empty}</Empty>
  return (
    <ul className="gm-learnings">
      {rows.map((l) => (
        <LearningLine key={l.id} l={l} t={t} />
      ))}
    </ul>
  )
}

function Dealers({ rows }: { rows: TraderProfile[] }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.learn.noDealers}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table">
        <Head cells={t.learn.dealerHead} right={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]} hints={{ 5: t.learn.dealerHint.fill, 6: t.learn.dealerHint.ourFill, 7: t.learn.dealerHint.firm, 8: t.learn.dealerHint.concession }} />
        <tbody>
          {rows.map((d) => (
            <tr key={d.trader}>
              <td>
                <b>{d.trader}</b>
              </td>
              <td className="gm-r">{d.stat?.threads ?? '—'}</td>
              <td className="gm-r">{d.stat ? `${d.stat.deals} · ${pct(d.stat.threads ? d.stat.deals / d.stat.threads : null)}` : '—'}</td>
              <td className="gm-r">{d.stat?.avgOpen == null ? '—' : fmtP(Math.round(d.stat.avgOpen))}</td>
              <td className="gm-r">{d.stat?.avgFill == null ? '—' : fmtP(Math.round(d.stat.avgFill))}</td>
              <td className="gm-r">{pct(d.stat?.fillRatio ?? null)}</td>
              <td className={`gm-r ${d.stat?.ourFillRatio != null && d.stat.fillRatio != null ? (d.stat.ourFillRatio <= d.stat.fillRatio ? 'gm-good' : 'gm-bad') : ''}`}>
                {d.stat ? `${pct(d.stat.ourFillRatio)} · ${d.stat.ourDeals}/${d.stat.ourThreads}` : '—'}
              </td>
              <td className="gm-r">{pct(d.firmness)}</td>
              <td className="gm-r">{d.avgConcession === null ? '—' : fmtP(Math.round(d.avgConcession * 10) / 10)}</td>
              <td className="gm-r">{num1(d.stat?.avgSteps ?? null)}</td>
              <td className="gm-r gm-muted">{d.lastTick ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Moves({ rows }: { rows: TraderMove[] }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.learn.noMoves}</Empty>
  return (
    <div className="gm-scroll gm-scroll-tall">
      <table className="gm-table">
        <Head cells={t.learn.moveHead} right={[0, 2, 4, 5, 6]} />
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} data-ours={m.ours || undefined}>
              <td className="gm-r">{m.tick ?? '—'}</td>
              <td>
                <b>{m.trader}</b>
              </td>
              <td className="gm-r gm-muted">{m.thread ?? '—'}</td>
              <td>
                <Badge tone={moveTone(m.event)}>{t.learn.events[m.event] ?? m.event}</Badge>
              </td>
              <td className="gm-r">{m.theirPrice === null ? '—' : fmtP(m.theirPrice)}</td>
              <td className="gm-r">{m.ourPrice === null ? '—' : fmtP(m.ourPrice)}</td>
              <td className="gm-r gm-muted">{m.step ?? '—'}</td>
              <td className="gm-muted">{m.ours ? t.learn.us : t.learn.feed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Rivals({ rows }: { rows: RivalProfile[] }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.learn.noRivals}</Empty>
  return (
    <div className="gm-scroll">
      <table className="gm-table">
        <Head cells={t.learn.rivalHead} right={[1, 3, 4, 5, 6, 8, 9, 10]} />
        <tbody>
          {rows.map((r) => (
            <tr key={r.team}>
              <td>
                <b>{r.team}</b>
              </td>
              <td className="gm-r">{r.level ?? '—'}</td>
              <td>{r.venue ?? <span className="gm-muted">—</span>}</td>
              <td className="gm-r">{r.buys ?? '—'}</td>
              <td className="gm-r">{r.sells ?? '—'}</td>
              <td className="gm-r">{r.spent === null ? '—' : fmtP(r.spent)}</td>
              <td className="gm-r">{r.earned === null ? '—' : fmtP(r.earned)}</td>
              <td className="gm-mono">
                {Object.entries(r.setInterest)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([set, n]) => `${set} ${n}`)
                  .join(' · ') || '—'}
              </td>
              <td className="gm-r">{pct(r.dealerDealRate)}</td>
              <td className="gm-r">{r.avgPackPrice === null ? '—' : fmtP(Math.round(r.avgPackPrice))}</td>
              <td className="gm-r gm-muted">{r.updatedTick ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LearnScreen() {
  const { state, status: gameStatus, version } = useGame()
  const t = useGameStrings()
  const token = useParam('token')
  const tick = state.tick > 0 ? state.tick : null
  const push = pagePush(gameStatus, state, 'learn')
  const learn = useLearn(gameStatus === 'mock', token, tick ?? 0, push)
  const [query, setQuery] = useState('')
  const [include, setInclude] = useState<MoveFilter>('ours')
  const { snapshot } = learn
  const live = learn.status === 'live'
  const view = useMemo(
    () => ({ groups: learningGroups(snapshot, tick, query), dealers: traderProfiles(snapshot), moves: recentMoves(snapshot, include, query), rivals: rivalRows(snapshot) }),
    // the game state is mutated in place: the version is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, tick, query, include, version],
  )
  // the mock game's own notice already says the screens are made up
  const notice = learn.status === 'live' || learn.status === 'mock' ? null : t.learn.notice[learn.status]
  const search = <input type="search" className="gm-search" placeholder={t.learn.search} aria-label={t.learn.searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} />
  return (
    <>
      {notice && <NoticeBar>{notice}</NoticeBar>}
      <Panel
        title={t.learn.inForce}
        sub={
          <>
            {t.learn.inForceSub(view.groups.inForce.length, view.groups.lifted)}
            <Fresh page="learn" status={learn.status} at={snapshot.at} push={push} />
            <Missing part="learnings" parts={snapshot.parts} live={live} />
          </>
        }
        actions={search}
        className="gm-learn-now"
      >
        <Learnings rows={view.groups.inForce} empty={t.learn.noneInForce} />
      </Panel>
      <div className="gm-two">
        <Panel title={t.learn.lessons} sub={t.learn.lessonsSub(view.groups.lessons.length)}>
          <Learnings rows={view.groups.lessons} empty={t.learn.noLessons} />
        </Panel>
        <Panel title={t.learn.facts} sub={t.learn.factsSub(view.groups.facts.length)}>
          <Learnings rows={view.groups.facts} empty={t.learn.noFacts} />
        </Panel>
      </div>
      <Panel
        title={t.learn.dealers}
        sub={
          <>
            {t.learn.dealersSub(view.dealers.length)}
            <Missing part="dealers" parts={snapshot.parts} live={live} />
          </>
        }
      >
        <Dealers rows={view.dealers} />
      </Panel>
      <div className="gm-two">
        <Panel
          title={t.learn.moves}
          sub={
            <>
              {t.learn.movesSub(view.moves.length)}
              <Missing part="moves" parts={snapshot.parts} live={live} />
            </>
          }
          actions={
            <Seg
              label={t.learn.which}
              value={include}
              options={[
                ['ours', t.learn.ours],
                ['all', t.learn.all],
              ]}
              onChange={setInclude}
            />
          }
        >
          <Moves rows={view.moves} />
        </Panel>
        <Panel
          title={t.learn.rivals}
          sub={
            <>
              {t.learn.rivalsSub(view.rivals.length)}
              <Missing part="rivals" parts={snapshot.parts} live={live} />
            </>
          }
        >
          <Rivals rows={view.rivals} />
        </Panel>
      </div>
    </>
  )
}
