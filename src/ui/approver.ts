/**
 * Whether this server runs the Approvals screen. GET /api/approver/session answers 200 only then; off, it answers like
 * any unknown /api path (404), so the nav shows no tab and /approvals is the show, like any unknown path. Only a 404
 * means off: a 429, a 5xx or no answer keeps it unknown and asks again after Retry-After (else 5 s, at most 60 s).
 * The nav and the app share the answer; null until the server says.
 */
import { useSyncExternalStore } from 'react'

let available: boolean | null = null
let asked = false
const listeners = new Set<() => void>()

function settle(value: boolean): void {
  available = value
  listeners.forEach((listener) => listener())
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
    if (out.kind === 'retry') setTimeout(probe, out.retryS * 1000)
    else settle(out.kind === 'on')
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

/** true: the server runs approvals; false: it does not (or did not answer); null: not known yet. */
export function useApproverAvailable(): boolean | null {
  return useSyncExternalStore(subscribe, () => available, () => null)
}
