/**
 * The dealers' display names from GET /api/dealers (`{names: {id: name}}`), for the captions of a dealer
 * that speaks with a guest voice. Read once when a caption first needs it, then every few minutes; a failed
 * read keeps what we had, and with nothing at all the caption falls back to the dealer's id.
 */
import { useSyncExternalStore } from 'react'
import { getJson } from './http'

export type DealerNames = Readonly<Record<string, string>>

const REFRESH_MS = 5 * 60_000
const RETRY_MS = 30_000
const ID = /^[a-z][a-z0-9_-]{0,39}$/
const NAME = /^[\p{L}\p{N} _.'-]{1,32}$/u

/** Only plain ids and names survive: the page treats the server's answer as untrusted too. */
export function parseNames(body: unknown): DealerNames {
  const names = typeof body === 'object' && body !== null ? (body as { names?: unknown }).names : null
  if (typeof names !== 'object' || names === null || Array.isArray(names)) return {}
  return Object.fromEntries(Object.entries(names).filter(([id, name]) => ID.test(id) && typeof name === 'string' && NAME.test(name)))
}

let names: DealerNames = {}
let loadedAt = -Infinity
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

let failedAt = -Infinity

async function load(): Promise<void> {
  // one read at a time; after a failure, try again soon rather than in five minutes
  failedAt = Date.now()
  try {
    const next = parseNames(await getJson('/api/dealers'))
    if (Object.keys(next).length === 0) return
    loadedAt = Date.now()
    failedAt = -Infinity
    names = next
    listeners.forEach((l) => l())
  } catch {
    // keep the last list: a caption without a name shows the dealer's id
  }
}

const due = (now: number): boolean => now - loadedAt > REFRESH_MS && now - failedAt > RETRY_MS

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (due(Date.now())) void load()
  // A new dealer opens mid-game: read again while a caption is on screen.
  timer ??= setInterval(() => due(Date.now()) && void load(), RETRY_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useDealerNames(): DealerNames {
  return useSyncExternalStore(subscribe, () => names, () => names)
}
