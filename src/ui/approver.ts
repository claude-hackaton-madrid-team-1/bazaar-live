/**
 * Whether this server runs the Approvals screen. GET /api/approver/session answers 200 only then; off, it answers like
 * any unknown /api path, so the nav shows no tab and /approvals is the show, like any unknown path. Asked once per
 * page load (the nav and the app share the answer); null until the server answers.
 */
import { useSyncExternalStore } from 'react'

let available: boolean | null = null
let asked = false
const listeners = new Set<() => void>()

function settle(value: boolean): void {
  available = value
  listeners.forEach((listener) => listener())
}

function ask(): void {
  if (asked) return
  asked = true
  fetch('/api/approver/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => {
      // only the status matters here; the screen reads the session itself
      void res.body?.cancel().catch(() => undefined)
      settle(res.status === 200)
    })
    .catch(() => settle(false))
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
