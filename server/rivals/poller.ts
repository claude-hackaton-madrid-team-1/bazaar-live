/**
 * Reads db/rival_albums.sql's four views every few seconds and keeps the last snapshot in memory for GET /api/rivals.
 * Like the history poller: on the server's one shared pool (the reader role has a connection limit), one capped
 * query after the other; a view not applied yet (42P01) or not granted (42501) only blanks its part, logged once;
 * any other error keeps the last good part and backs off; no exception leaves `pollOnce()`; error text is redacted.
 * `poke()` reads now (an agent's socket said something moved); `onChange` hears when a read's rows differ.
 */
import { EMPTY_RIVALS, type RivalsParts, type RivalsSnapshot } from '../../shared/rivals.ts'
import { parseAll } from '../learn/rows.ts'
import type { Db } from '../transcript/poller.ts'
import { headOf, holdingOf, teamOf, wantOf } from './rows.ts'

export const SQL = {
  holdings: 'select holder, card, set_code, rarity, name, copies, how, since_tick, seen_tick from show.rival_holdings order by holder, card limit $1',
  // `*`: album_filled / album_slots are new columns of the view; a server deployed before the view is re-applied still reads its teams.
  teams: 'select t.* from show.rival_teams t order by t.rank, t.team limit $1',
  wants: 'select team, card, via, times, last_tick, top_bid from show.rival_wants order by last_tick desc, team, card limit $1',
  head: 'select tick from show.rival_head limit $1',
} as const

/** About 500 holdings and 500 wants on Saturday afternoon, for 18 teams and three dealers: room to double. */
export const CAPS = { holdings: 3000, teams: 50, wants: 2000, head: 1 } as const

type Part = keyof RivalsParts

export interface RivalsPollerDeps {
  readonly db: Db
  readonly log: (entry: Record<string, unknown>) => void
  readonly intervalMs?: number
  readonly maxDelayMs?: number
  readonly secrets?: readonly string[]
  readonly now?: () => Date
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'ERR'
}

export class RivalsPoller {
  private snapshot: RivalsSnapshot = EMPTY_RIVALS
  private readonly missingLogged = new Set<Part>()
  private failures = 0
  private timer: unknown = null
  private running = false
  private reading = false
  private readonly listeners = new Set<(at: string) => void>()
  private readonly deps: RivalsPollerDeps
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(deps: RivalsPollerDeps) {
    this.deps = deps
    this.intervalMs = deps.intervalMs ?? 15_000
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  current(): RivalsSnapshot {
    return this.snapshot
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
  }

  /** Reads now instead of at the next interval; false when stopped or already reading. */
  poke(): boolean {
    if (!this.running || this.reading) return false
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>)
    this.timer = null
    void this.loop()
    return true
  }

  /** Called with the read's time whenever a read's rows differ from the last ones. Returns the unsubscribe. */
  onChange(listener: (at: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async loop(): Promise<void> {
    if (!this.running || this.reading) return
    this.reading = true
    try {
      await this.pollOnce()
    } finally {
      this.reading = false
    }
    if (!this.running) return
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.maxDelayMs, this.intervalMs * 2 ** this.failures)
    this.timer = (this.deps.setTimer ?? setTimeout)(() => void this.loop(), delay)
  }

  /** One read of the four views. Never throws. */
  async pollOnce(): Promise<void> {
    const prev = this.snapshot
    const parts: Record<Part, boolean> = { ...prev.parts }
    let failed = false
    const read = async <T>(part: Part, parse: (raw: unknown) => T | null, keep: readonly T[]): Promise<readonly T[]> => {
      try {
        const { rows } = await this.deps.db.query(SQL[part], [CAPS[part]])
        parts[part] = true
        this.missingLogged.delete(part)
        return parseAll(rows, parse)
      } catch (error: unknown) {
        const code = codeOf(error)
        if (code === '42P01' || code === '42501') {
          parts[part] = false
          if (!this.missingLogged.has(part)) this.deps.log({ route: 'rivals', event: 'view_missing', part, code })
          this.missingLogged.add(part)
          return []
        }
        failed = true
        this.deps.log({ route: 'rivals', event: 'poll_error', part, code, message: this.redact(error) })
        return keep
      }
    }
    const holdings = await read('holdings', holdingOf, prev.holdings)
    const teams = await read('teams', teamOf, prev.teams)
    const wants = await read('wants', wantOf, prev.wants)
    const tick = (await read('head', headOf, prev.tick === null ? [] : [prev.tick]))[0] ?? null
    this.failures = failed ? this.failures + 1 : 0
    const at = failed ? prev.at : (this.deps.now ?? (() => new Date()))().toISOString()
    const changed = JSON.stringify([parts, holdings, teams, wants]) !== JSON.stringify([prev.parts, prev.holdings, prev.teams, prev.wants])
    this.snapshot = { at, parts, tick, holdings, teams, wants }
    if (changed && at) for (const listener of this.listeners) listener(at)
  }

  private redact(error: unknown): string {
    let text = error instanceof Error ? error.message : String(error)
    for (const s of this.deps.secrets ?? []) if (s) text = text.split(s).join('***')
    return text.slice(0, 200)
  }
}
