/**
 * The read loop of the screens that show one of the server's snapshots (/api/history, /learn, /strategy, /venue,
 * /rivals, /injections): GET it now and on a timer, each read aborting the one before; keep the last good snapshot
 * through an error.
 */
import { useEffect, useState } from 'react'

/**
 * Reads `url` now and every `everyMs`. `answer` hears each answer's HTTP status and JSON body (null when it is not
 * JSON), or status 0 and no body when the request failed. The returned function stops it: no answer after that.
 */
export function pollJson(url: string, everyMs: number, cache: RequestCache, answer: (status: number, body: unknown) => void): () => void {
  let stopped = false
  let controller: AbortController | null = null
  const read = async (): Promise<void> => {
    controller?.abort()
    controller = new AbortController()
    try {
      const res = await fetch(url, { signal: controller.signal, cache })
      const body: unknown = await res.json().catch(() => null)
      if (!stopped) answer(res.status, body)
    } catch (error: unknown) {
      if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) answer(0, null)
    }
  }
  void read()
  const timer = setInterval(() => void read(), everyMs)
  return () => {
    stopped = true
    clearInterval(timer)
    controller?.abort()
  }
}

/**
 * A screen's state from `url` read every `everyMs` (null: no reads, as for the mock). A new `wake` reads now and
 * starts the timer again from there. `stateOf` turns an answer into the state; it reads status 0 as a failed request.
 */
export function usePolled<T extends { readonly snapshot: unknown }>(
  url: string | null,
  initial: T,
  everyMs: number,
  wake: unknown,
  stateOf: (httpStatus: number, body: unknown, prev: T['snapshot']) => T,
  cache: RequestCache = 'no-store',
): T {
  const [state, setState] = useState<T>(initial)
  useEffect(() => {
    if (url === null) return
    return pollJson(url, everyMs, cache, (status, body) => setState((s) => stateOf(status, body, s.snapshot)))
  }, [url, everyMs, wake, cache, stateOf])
  return state
}
