export interface BackoffOptions {
  /** First delay, in ms. */
  readonly baseMs: number
  /** Ceiling for any delay, in ms. */
  readonly maxMs: number
  /** Growth per failed attempt. */
  readonly factor: number
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 15_000, factor: 2 }

/**
 * Exponential backoff with "equal jitter": half the step is fixed, half random, so a fleet of
 * screens reconnecting after a deploy does not hit the agent in lockstep, and no delay is ever 0.
 * `attempt` counts from 0. `random` is injectable for tests.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const step = Math.min(opts.maxMs, opts.baseMs * opts.factor ** Math.max(0, attempt))
  return Math.round(step / 2 + random() * (step / 2))
}
