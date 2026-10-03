/**
 * Reads db/injections.sql's views every few seconds and keeps the last snapshot in memory for GET /api/injections.
 *
 * Two small queries per poll on the server's shared pool:
 *   - show.injection_attempts, which holds only the newest CAP rows of each severity (each an ORDER BY ... LIMIT inside
 *     the view: a top-N sort with bounded memory, or an index scan that stops at CAP rows);
 *   - show.injection_counts.
 * A read that finds the same rows keeps the same snapshot object (and its `at`), so the route's cached body and ETag stay
 * valid. A view missing (42P01: db/injections.sql not applied, or bazaar's table not created yet) or not granted (42501)
 * is the empty state, logged once; any other error keeps the last good rows and backs off. No exception ever leaves
 * `pollOnce()`, and error text is redacted against the connection's secrets before it is logged.
 */
import { EMPTY_INJECTIONS, INJECTION_SOURCES, RAW_MAX, responseOf, type InjectionAttempt, type InjectionSource, type InjectionsSnapshot } from '../../shared/injections.ts'
import type { Db } from '../transcript/poller.ts'

const COLUMNS = 'id, tick, source, from_team, to_us, tags, severity, raw, our_response, proof, seen_at'

/** The view's own window: the newest CAP rows of each severity (db/injections.sql). */
export const CAP = 100

/** The window (the limit only guards against a view that holds more), and each severity's total. */
export const SQL = {
  rows: `select ${COLUMNS} from show.injection_attempts order by seen_at desc, id desc limit $1`,
  counts: 'select severity, n from show.injection_counts',
} as const

type Row = Record<string, unknown>

const int = (raw: unknown): number | null => {
  const n = typeof raw === 'string' && /^-?\d{1,15}$/.test(raw.trim()) ? Number(raw) : raw
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null
}

/** A short identifier-like word (a team, a dealer, a venue, a tag), or null. */
const word = (raw: unknown, max = 40): string | null => (typeof raw === 'string' && /^[\w:.-]{1,40}$/u.test(raw) ? raw.slice(0, max) : null)

/** Text as it was, only capped: hidden characters stay, so the page can show them (as markers). */
const text = (raw: unknown, max: number): string | null => (typeof raw === 'string' && raw.length > 0 ? Array.from(raw).slice(0, max).join('') : null)

/** One printable line, capped: our own response and the proof are short labels. */
const label = (raw: unknown, max: number): string | null => {
  if (typeof raw !== 'string') return null
  const clean = Array.from(raw, (ch) => (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : null
}

/** The proof is an endpoint and its ids ("GET /api/duels?done=true duel 85 message 3"): nothing else gets through. */
const PROOF_OTHER = /[^A-Za-z0-9 /?=&._:#,()+-]/g

const proofOf = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  const proof = raw.replace(PROOF_OTHER, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  return proof || null
}

const isSource = (v: unknown): v is InjectionSource => typeof v === 'string' && (INJECTION_SOURCES as readonly string[]).includes(v)

/** A row of the view → the wire type, or null when it lacks what the panel needs (id, source, severity, raw, proof). */
export function attemptOf(raw: unknown): InjectionAttempt | null {
  const r: Row = typeof raw === 'object' && raw !== null ? (raw as Row) : {}
  const id = int(r.id)
  const severity = r.severity === 'attempt' || r.severity === 'weak' ? r.severity : null
  const said = text(r.raw, RAW_MAX)
  const proof = proofOf(r.proof)
  if (id === null || !isSource(r.source) || severity === null || said === null || proof === null) return null
  const seen = r.seen_at instanceof Date ? r.seen_at : typeof r.seen_at === 'string' ? new Date(r.seen_at) : null
  return {
    id,
    tick: int(r.tick),
    source: r.source,
    from: word(r.from_team),
    toUs: r.to_us === true,
    tags: Array.isArray(r.tags) ? r.tags.map((t) => word(t)).filter((t): t is string => t !== null).slice(0, 12) : [],
    severity,
    raw: said,
    // the view already maps it to a verb and a reason without digits; this is the second wall
    ourResponse: responseOf(label(r.our_response, 120)),
    proof,
    seenAt: seen && Number.isFinite(seen.getTime()) ? seen.toISOString() : null,
  }
}

export interface InjectionsPollerDeps {
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

export class InjectionsPoller {
  private snapshot: InjectionsSnapshot = EMPTY_INJECTIONS
  private missingLogged = false
  private signature = ''
  private failures = 0
  private timer: unknown = null
  private running = false
  private readonly deps: InjectionsPollerDeps
  private readonly intervalMs: number
  private readonly maxDelayMs: number

  constructor(deps: InjectionsPollerDeps) {
    this.deps = deps
    this.intervalMs = deps.intervalMs ?? 10_000
    this.maxDelayMs = deps.maxDelayMs ?? 120_000
  }

  current(): InjectionsSnapshot {
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

  private async loop(): Promise<void> {
    if (!this.running) return
    await this.pollOnce()
    if (!this.running) return
    const delay = this.failures === 0 ? this.intervalMs : Math.min(this.maxDelayMs, this.intervalMs * 2 ** this.failures)
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null
      void this.loop()
    }, delay)
  }

  /** One read of the view. Never throws. */
  async pollOnce(): Promise<void> {
    const at = (this.deps.now ?? (() => new Date()))().toISOString()
    try {
      const { rows } = await this.deps.db.query(SQL.rows, [2 * CAP])
      const totals = await this.deps.db.query(SQL.counts)
      const parsed = rows.map(attemptOf).filter((r): r is InjectionAttempt => r !== null)
      // newest first across both severities
      parsed.sort((a, b) => (b.seenAt ?? '').localeCompare(a.seenAt ?? '') || b.id - a.id)
      const counts = { attempt: 0, weak: 0 }
      for (const raw of totals.rows) {
        const r: Row = typeof raw === 'object' && raw !== null ? (raw as Row) : {}
        if (r.severity === 'attempt' || r.severity === 'weak') counts[r.severity] = Math.max(0, int(r.n) ?? 0)
      }
      this.failures = 0
      this.missingLogged = false
      this.keep({ at, ready: true, counts, rows: parsed })
    } catch (error: unknown) {
      const code = codeOf(error)
      if (code === '42P01' || code === '42501') {
        this.failures = 0
        if (!this.missingLogged) this.deps.log({ route: 'injections', event: 'view_missing', code })
        this.missingLogged = true
        this.keep({ ...EMPTY_INJECTIONS, at })
        return
      }
      this.failures += 1
      this.deps.log({ route: 'injections', event: 'poll_error', code, message: this.redact(error) })
    }
  }

  /** The new snapshot, unless it holds the same rows as the current one (which then stays, `at` included). */
  private keep(next: InjectionsSnapshot): void {
    const signature = JSON.stringify([next.ready, next.counts, next.rows])
    if (signature === this.signature) return
    this.signature = signature
    this.snapshot = next
  }

  private redact(error: unknown): string {
    let msg = error instanceof Error ? error.message : String(error)
    for (const s of this.deps.secrets ?? []) if (s) msg = msg.split(s).join('***')
    return msg.slice(0, 200)
  }
}
