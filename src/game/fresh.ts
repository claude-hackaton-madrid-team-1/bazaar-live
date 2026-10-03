/**
 * The screens that read their own API (/history, /learn, /strategy) and how fresh what they show is.
 *
 * The server reads their views on a timer and as soon as one of our agents' sockets says something moved; when a
 * read finds new rows it says so on the game stream (`pages.changed`, `State.changes`), and the screen refetches.
 * Its own timer stays as the fallback: short while it has only that, long while the stream carries the notices.
 */
import type { GameStatus } from './store.ts'
import type { State } from './state.ts'

export type ApiPage = 'history' | 'learn' | 'strategy'

/** Each screen's read interval with only the timer, and with the stream's notices. */
export const POLL_MS: Readonly<Record<ApiPage, { readonly timer: number; readonly pushed: number }>> = {
  history: { timer: 5_000, pushed: 30_000 },
  learn: { timer: 10_000, pushed: 60_000 },
  strategy: { timer: 5_000, pushed: 30_000 },
}

/** What wakes a screen: the server's last change for it, and whether the notices are coming at all. */
export interface PagePush {
  /** ISO; a new value means new rows. */
  readonly at: string | null
  /** The stream is up and the server sends notices: the screen's own timer can slow down. */
  readonly live: boolean
}

export function pagePush(status: GameStatus, state: Pick<State, 'changes'>, page: ApiPage): PagePush {
  return { at: state.changes?.[page] ?? null, live: status === 'live' && state.changes !== null }
}

export const pollEvery = (page: ApiPage, push: PagePush | null): number => (push?.live ? POLL_MS[page].pushed : POLL_MS[page].timer)

export interface Freshness {
  /** live: what is shown is current; stale: the last good read is older than it should be. */
  readonly tone: 'live' | 'stale'
  /** Seconds since the server's last good read, as of the copy on screen. */
  readonly ageS: number
}

/**
 * How fresh a screen's copy is: `at` is the server's last good read in the copy we hold (it stays put while the
 * database fails). With notices the copy is refetched only on a change or on the long timer, so it may be that
 * old and still current; a few server reads (5 s or 10 s each) on top of that before it counts as stale.
 * Null when there is nothing to say (no copy yet, the mock, or a notice above already says why).
 */
export function freshness(page: ApiPage, status: string, at: string | null, push: PagePush | null, nowMs: number): Freshness | null {
  if ((status !== 'live' && status !== 'error') || at === null) return null
  const read = Date.parse(at)
  if (!Number.isFinite(read)) return null
  const ageS = Math.max(0, Math.round((nowMs - read) / 1000))
  const limitMs = pollEvery(page, push) + 3 * POLL_MS[page].timer
  return { tone: status === 'live' && ageS * 1000 <= limitMs ? 'live' : 'stale', ageS }
}
