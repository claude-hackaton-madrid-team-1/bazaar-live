import { cleanQuote } from './clean.ts'
import { looksLikeInjection } from './injections.ts'
import type { Lang } from './lang.ts'

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export const teamId = (v: unknown): v is string => typeof v === 'string' && /^t\d{1,3}$/.test(v)

/** Only an acknowledged sales decision identifies a conversation as the Sales worker's. */
export function salesThread(raw: unknown): number | null {
  if (!record(raw) || raw.type !== 'agent.decision' || !record(raw.payload)) return null
  const p = raw.payload
  return p.agent === 'sales' && p.status === 'done' && record(p.trade) && id(p.trade.threadId) ? p.trade.threadId : null
}

export function sentSalesQuote(raw: unknown, us: string, threads: ReadonlySet<number>): string | null {
  if (!record(raw) || (raw.type !== 'thread.message' && raw.type !== 'thread.message.quote') || !record(raw.payload)) return null
  const p = raw.payload
  if (!teamId(us) || p.sender !== us || !id(p.thread) || !threads.has(p.thread) || typeof p.text !== 'string' || looksLikeInjection(p.text)) return null
  return cleanQuote(p.text)
}

/** Server-side proof from its own bounded, authenticated relay, never the caller's submitted text. */
export function vouchSalesQuote(events: readonly unknown[], text: string): boolean {
  let us = ''
  const threads = new Set<number>()
  for (const event of events) {
    if (record(event) && event.type === 'agent.hello' && record(event.payload) && teamId(event.payload.team)) us = event.payload.team
    const thread = salesThread(event)
    if (thread !== null) threads.add(thread)
  }
  return events.some((event) => sentSalesQuote(event, us, threads) === text)
}

export function salesLine(team: string, offer: boolean, lang: Lang): string | null {
  if (!teamId(team)) return null
  return lang === 'es'
    ? `Ventas: ${offer ? 'propuesta estructurada enviada' : 'conversación abierta'} con el equipo ${team}.`
    : `Sales: ${offer ? 'structured proposal sent' : 'conversation opened'} with team ${team}.`
}
export function isSalesLine(text: string, lang: Lang): boolean {
  return (lang === 'es' ? /^Ventas: (propuesta estructurada enviada|conversación abierta) con el equipo t\d{1,3}\.$/ : /^Sales: (structured proposal sent|conversation opened) with team t\d{1,3}\.$/).test(text)
}
