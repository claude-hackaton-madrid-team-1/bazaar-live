import type { AgentHealth, AgentState } from '../model/events'
import { parseHealth, parseState } from '../model/sanitize'

const TIMEOUT_MS = 8000

/** GET a JSON document with a timeout; throws on network error, non-2xx or bad JSON. */
export async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`${url} answered ${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchHealth(base: string): Promise<AgentHealth | null> {
  return parseHealth(await getJson(`${base}/health`))
}

export async function fetchState(base: string): Promise<AgentState | null> {
  return parseState(await getJson(`${base}/state`))
}
