/**
 * Whether this server runs the Approvals screen. GET /api/approver/session answers 200 only then; off, it answers like
 * any unknown /api path (404), so the nav shows no tab and /approvals is the show, like any unknown path. Only a 404
 * means off: a 429, a 5xx or no answer keeps it unknown and asks again after Retry-After (else 5 s, at most 60 s).
 * The nav and the app share the answer; null until the server says.
 */
import { useSyncExternalStore } from 'react'

/**
 * on: the server runs approvals; off: it answered 404; unknown: it could not say yet (429, 5xx, no answer: asking
 * again); null: no answer at all yet.
 */
export type ApproverState = 'on' | 'off' | 'unknown' | null

let state: ApproverState = null
let asked = false
const listeners = new Set<() => void>()

function settle(value: ApproverState): void {
  if (value === state) return
  state = value
  listeners.forEach((listener) => listener())
}

/**
 * What /approvals renders: nothing before the first answer, the show once the server said off (like any unknown
 * path), else the screen, whose own login form stands in while the server cannot say yet.
 */
export function approvalsViewOf(s: ApproverState): 'blank' | 'show' | 'screen' {
  if (s === null) return 'blank'
  return s === 'off' ? 'show' : 'screen'
}

/** What the probe does with an answer: on, off, or ask again in `retryS` seconds. */
export function probeOutcomeOf(status: number | null, retryAfter: string | null): { readonly kind: 'on' | 'off' } | { readonly kind: 'retry'; readonly retryS: number } {
  if (status === 200) return { kind: 'on' }
  if (status === 404) return { kind: 'off' }
  const seconds = Number(retryAfter)
  return { kind: 'retry', retryS: Number.isFinite(seconds) && seconds > 0 ? Math.min(60, seconds) : 5 }
}

function probe(): void {
  const next = (status: number | null, retryAfter: string | null) => {
    const out = probeOutcomeOf(status, retryAfter)
    if (out.kind === 'retry') {
      // still unknown once on or off was said? keep the last word; else say unknown and ask again
      if (state === null) settle('unknown')
      setTimeout(probe, out.retryS * 1000)
    } else settle(out.kind)
  }
  fetch('/api/approver/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => {
      // only the status matters here; the screen reads the session itself
      void res.body?.cancel().catch(() => undefined)
      next(res.status, res.headers.get('retry-after'))
    })
    .catch(() => next(null, null))
}

function ask(): void {
  if (asked) return
  asked = true
  probe()
}

function subscribe(listener: () => void): () => void {
  ask()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useApproverState(): ApproverState {
  return useSyncExternalStore(subscribe, () => state, () => null)
}
