/**
 * The header's health strip: one chip per agent (taker, maker, duels), green, amber or red with the one reason
 * that matters. The taker and the maker: their /health as the server relays it (shared/health.ts) merged with
 * what their decisions say, the worse of the two; on a tie the /health reason wins, since it says why. The duels
 * have no /health: their decisions alone, as the Agent screen reads them.
 */
import { AGENTS, type AgentName } from '../../../shared/decisions.ts'
import { healthVerdict, type HealthReport, type HealthTone, type HealthVerdict, type Reason } from '../../../shared/health.ts'
import type { State } from '../state.ts'
import { agentStatuses, type AgentStatus } from './decisions.ts'

/** A report older than this (the stream dropped, the poller stopped) no longer speaks for the agent. */
export const HEALTH_STALE_MS = 45_000

export type ChipReason =
  | Reason
  | { readonly kind: 'silent'; readonly ticks: number | null }
  | { readonly kind: 'quiet'; readonly ticks: number }
  | { readonly kind: 'stuck'; readonly count: number; readonly rule: string }
  | { readonly kind: 'stale'; readonly ageS: number }

export type HealthChip = {
  readonly agent: AgentName
  readonly tone: HealthTone
  /** null: healthy, nothing to say. */
  readonly reason: ChipReason | null
  /** Since when that reason holds (ISO), when /health knows it. */
  readonly since: string | null
  /** Its latest /health (taker, maker), stale or not; null for the duels or before the first. */
  readonly report: HealthReport | null
  /** What a fresh /health says, null when there is none (the duels, no report, a stale one). */
  readonly health: HealthVerdict | null
  readonly status: AgentStatus
}

const RANK: Readonly<Record<HealthTone, number>> = { good: 0, neutral: 1, warn: 2, bad: 3 }

const worse = (a: HealthTone, b: HealthTone): boolean => RANK[a] > RANK[b]

/** What the decisions alone say: silent is red, quiet and blocked amber. */
function fromDecisions(st: AgentStatus): { tone: HealthTone; reason: ChipReason | null } {
  if (st.state === 'silent') return { tone: 'bad', reason: { kind: 'silent', ticks: st.silentFor } }
  if (st.state === 'quiet') return { tone: 'warn', reason: { kind: 'quiet', ticks: st.silentFor ?? 0 } }
  if (st.state === 'stuck') return { tone: 'warn', reason: { kind: 'stuck', count: st.last?.rows.length ?? 0, rule: st.last?.rule ?? 'other' } }
  return { tone: st.state === 'none' ? 'neutral' : 'good', reason: null }
}

export function healthChips(s: State, nowMs: number): HealthChip[] {
  const statuses = agentStatuses(s)
  return AGENTS.map((agent, i): HealthChip => {
    const status = statuses[i] as AgentStatus
    const own = fromDecisions(status)
    const report = s.health.find((r) => r.agent === agent) ?? null
    if (!report) return { agent, ...own, since: null, report, health: null, status }
    const age = nowMs - Date.parse(report.checkedAt)
    if (!(age <= HEALTH_STALE_MS)) {
      const stale = { kind: 'stale', ageS: Number.isFinite(age) ? Math.round(age / 1000) : 0 } as const
      return worse(own.tone, 'neutral') ? { agent, ...own, since: null, report, health: null, status } : { agent, tone: 'neutral', reason: stale, since: null, report, health: null, status }
    }
    const health = healthVerdict(report)
    // the doors are shut or the game paused: no decision is expected, and that is the reason
    const stopped = health.reason?.kind === 'closed' || health.reason?.kind === 'paused'
    const useHealth = status.state === 'none' || (health.reason !== null && (stopped || !worse(own.tone, health.tone)))
    return useHealth
      ? { agent, tone: health.tone, reason: health.reason, since: health.since, report, health, status }
      : { agent, ...own, since: null, report, health, status }
  })
}
