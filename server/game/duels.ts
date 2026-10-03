/**
 * `GET /api/duels?done=true` turned into the events the page already reads. `duel.message` and `duel.result`
 * are team-only in the game, so `/api/feed` never carries them; the duel list does, in its own words
 * (`from: "you"|"Rival Azul"`, `status: "live"|"deal"|"no_deal"`). Each message becomes
 * `duel.message {duel, role, sender, price, days}` (sender: our team for "you", else the rival's alias) and each
 * finished duel one `duel.result {duel, deal, price, points}`, the same payloads as the mock's. Nothing else
 * of a duel leaves: not our limit, our days weight, our gain or share (they reveal our limits), nor the words.
 */
export type Payload = Record<string, unknown>

export interface DuelEvent {
  readonly id: number
  readonly tick: number | null
  readonly type: 'duel.message' | 'duel.result'
  readonly payload: Payload
}

const isRecord = (v: unknown): v is Payload => typeof v === 'object' && v !== null && !Array.isArray(v)

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Room for a duel's messages; its result takes the last slot. */
const SLOTS = 1000

/** Below every feed id (positive) and every made-up one (counting down from -1). */
const BASE = 1e12

/** The same id for the same message (or result) on every poll: `-(BASE + duel * SLOTS + n)`. */
export const duelEventId = (duel: number, n: number): number => -(BASE + duel * SLOTS + n)

/** About when it closed: the tick after the last word, the deadline at the latest. */
function closedTick(d: Payload, last: number | null): number | null {
  const deadline = isInt(d.deadline_tick) ? d.deadline_tick : null
  if (last === null) return deadline
  return deadline === null ? last + 1 : Math.min(deadline, last + 1)
}

function eventsOf(d: Payload, duel: number, team: string): DuelEvent[] {
  const role = typeof d.role === 'string' ? d.role : null
  const out: DuelEvent[] = []
  const messages = Array.isArray(d.messages) ? d.messages.slice(0, SLOTS - 1) : []
  let last: number | null = null
  messages.forEach((m: unknown, n) => {
    if (!isRecord(m)) return
    const tick = isInt(m.tick) ? m.tick : null
    if (tick !== null) last = last === null ? tick : Math.max(last, tick)
    const sender = m.from === 'you' ? team : typeof m.from === 'string' ? m.from : 'rival'
    out.push({ id: duelEventId(duel, n), tick, type: 'duel.message', payload: { duel, role, sender, price: numOrNull(m.price), days: numOrNull(m.days) } })
  })
  if (d.status === 'deal' || d.status === 'no_deal') {
    const result = isRecord(d.result) ? d.result : {}
    const deal = d.status === 'deal'
    const payload = { duel, deal, price: deal ? numOrNull(result.price ?? d.price) : null, points: numOrNull(result.points) }
    out.push({ id: duelEventId(duel, SLOTS - 1), tick: closedTick(d, last), type: 'duel.result', payload })
  }
  return out
}

/** Every event of the newest `limit` duels in the body, oldest duel first, each duel's messages before its result. */
export function duelEvents(body: unknown, team: string, limit: number): DuelEvent[] {
  const rows = isRecord(body) && Array.isArray(body.duels) ? body.duels : []
  const duels = rows.filter((d): d is Payload => isRecord(d) && isInt(d.duel) && d.duel >= 0)
    .sort((a, b) => (a.duel as number) - (b.duel as number))
    .slice(-Math.max(1, limit))
  return duels.flatMap((d) => eventsOf(d, d.duel as number, team))
}
