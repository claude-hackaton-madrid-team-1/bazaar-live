/**
 * The Market Test on /history, under every team's score: where our market part stands against every team's (the public
 * board), then our own bench run (private, in its own units, never ranked) and why our venue shows no trades for it.
 */
import { useMemo, type CSSProperties } from 'react'
import type { TeamScore } from '../../../shared/history.ts'
import { whoName } from '../humanize.ts'
import { useMarketTestStrings } from '../marketTestStrings.ts'
import type { Score } from '../state.ts'
import { useGameStrings } from '../strings.ts'
import { marketTest } from '../views/market-test.ts'
import { Panel } from './bits.tsx'
import './teams.css'

/** Teams named per market level before "+N more". */
const NAMED = 4

export function MarketTestPanel({ board, us, score }: { board: readonly TeamScore[]; us: string; score: Score | null | undefined }) {
  const t = useMarketTestStrings()
  const g = useGameStrings()
  const m = useMemo(() => marketTest(board, us, score), [board, us, score])
  if (!m) return null
  const top = m.levels[0]?.value ?? 0
  const name = (team: string) => (team === us ? t.us : whoName(g, team))
  return (
    <Panel title={t.title} sub={t.sub} className="mt-panel">
      <p className="ts-headline">{t.headline(m.ours, m.place, m.teams, m.leader && { name: whoName(g, m.leader.team), value: m.leader.value, gap: m.leader.gap })}</p>
      {m.levels.length > 0 && (
        <ol className="mt-levels">
          {m.levels.map((l) => (
            <li key={l.value} className="mt-level" data-us={l.us || undefined} title={t.levelTitle(l.teams.length)}>
              <span className="gm-mono mt-value">{t.value(l.value)}</span>
              <span className="mt-bar" style={{ '--w': `${top > 0 ? Math.max(2, (l.value / top) * 100) : 0}%` } as CSSProperties} />
              <span className="mt-teams">
                {l.teams.slice(0, NAMED).map(name).join(', ')}
                {l.teams.length > NAMED && <span className="gm-muted"> {t.more(l.teams.length - NAMED)}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-bench" title={t.benchTitle}>
        <b>{t.benchHead}</b> {[t.benchPoints(m.bench.points), t.efficiency(m.bench.efficiency), t.venue(m.bench.venue), t.mm(m.bench.mm)].join(' · ')}
      </p>
      <p className="ts-note">{t.note(m.bench.venue)}</p>
    </Panel>
  )
}
