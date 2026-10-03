/**
 * `GET /api/duels?done=true` turned into the events the page already reads. `duel.message` and `duel.result`
 * are team-only in the game, so `/api/feed` never carries them; the duel list does, in its own words
 * (`from: "you"|"Rival Azul"`, `status: "live"|"deal"|"no_deal"`). Each message becomes
 * `duel.message {duel, role, rival, sender, price, days}` (sender: our team for "you", else the rival's alias) and
 * each finished duel one `duel.result {duel, rival, deal, price, points}`, the same payloads as the mock's. `rival`
 * is the duel's `rival`, the only name the game gives the other side (an alias like "Rival Azul", not a team id,
 * so there is no team to look up); null when missing. Every duel also opens with one
 * `duel.started {duel, session, role, rival, item, deadline_tick}`, so a live duel shows before anyone has
 * spoken, with what is at stake and until when, our limit (`limit`, the duel's `your_limit`) and the decay per round
 * (`decay`). The result adds what the deal kept for us (`gain`: a numeric `result`, as the real game sends it, or the
 * simulator's `result.your_gain`), the simulator's `result.points`, the `rounds` and our limit again. Our limit and
 * gain go to the token-gated game stream only (the Duels screen asks whether their price is inside our limit), never
 * to the public show. Nothing else of a duel leaves: not our days weight, our share, our own offer object, nor the words.
 */
export type Payload = Record<string, unknown>

export interface DuelEvent {
  readonly id: number
  readonly tick: number | null
  readonly type: 'duel.started' | 'duel.message' | 'duel.result'
  readonly payload: Payload
}

const isRecord = (v: unknown): v is Payload => typeof v === 'object' && v !== null && !Array.isArray(v)

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Room for a duel's messages; its start takes the slot before the last, its result the last. */
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

/** The rival's alias, trimmed and bounded; null when the duel has none. */
const rivalOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null)

/** The decay per round, a share in [0, 1); null when missing or out of range. */
const decayOf = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1 ? n : null
}

/** The card at stake (a name like "El Mesón de la Cava"), trimmed and bounded; null when missing. */
const itemOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null)

function eventsOf(d: Payload, duel: number, team: string): DuelEvent[] {
  const role = typeof d.role === 'string' ? d.role : null
  const rival = rivalOf(d.rival)
  const messages = Array.isArray(d.messages) ? d.messages.slice(0, SLOTS - 2) : []
  const firstTick = messages.map((m: unknown) => (isRecord(m) && isInt(m.tick) ? m.tick : null)).find((t) => t !== null) ?? null
  const limit = numOrNull(d.your_limit)
  const started = {
    duel, session: isInt(d.session) ? d.session : null, role, rival, item: itemOf(d.item),
    deadline_tick: isInt(d.deadline_tick) ? d.deadline_tick : null, limit, decay: decayOf(d.decay_per_round),
  }
  const out: DuelEvent[] = [{ id: duelEventId(duel, SLOTS - 2), tick: firstTick ?? (isInt(d.tick) ? d.tick : null), type: 'duel.started', payload: started }]
  let last: number | null = null
  messages.forEach((m: unknown, n) => {
    if (!isRecord(m)) return
    const tick = isInt(m.tick) ? m.tick : null
    if (tick !== null) last = last === null ? tick : Math.max(last, tick)
    const sender = m.from === 'you' ? team : typeof m.from === 'string' ? m.from : 'rival'
    out.push({ id: duelEventId(duel, n), tick, type: 'duel.message', payload: { duel, role, rival, sender, price: numOrNull(m.price), days: numOrNull(m.days) } })
  })
  if (d.status === 'deal' || d.status === 'no_deal') {
    const result = isRecord(d.result) ? d.result : {}
    const deal = d.status === 'deal'
    const gain = numOrNull(d.result) ?? numOrNull(result.your_gain)
    const payload = {
      duel, rival, deal, price: deal ? numOrNull(result.price ?? d.price) : null, points: numOrNull(result.points),
      gain, rounds: isInt(d.rounds) && d.rounds >= 0 ? d.rounds : null, limit,
    }
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
