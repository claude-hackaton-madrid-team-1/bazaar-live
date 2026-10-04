import { cleanQuote } from '../../shared/clean'
import { salesThread } from '../../shared/sales'
import type { State } from '../game/state'
import type { TeamThread } from '../game/teamThreads'

export type SalesConversation = TeamThread & { sales: boolean; messages: readonly { id: number; tick: number | null; sender: string; ours: boolean; text: string | null }[] }

/** Team-only display. A missing quote means unavailable, never invented dialogue. */
export function salesConversations(state: State): readonly SalesConversation[] {
  const quotes = new Map(state.events.filter((e) => e.type === 'thread.message.quote').map((e) => [e.payload.feed_id, e.payload.text]))
  const assigned = new Set(state.agents.decisions.sales.flatMap((decision) => {
    const thread = salesThread({ type: 'agent.decision', payload: decision })
    return thread === null ? [] : [thread]
  }))
  return [...state.teamThreads.values()].sort((a, b) => (b.lastTick ?? 0) - (a.lastTick ?? 0)).slice(0, 12).map((thread) => ({
    ...thread,
    sales: assigned.has(thread.id),
    messages: state.events.filter((event) => event.type === 'thread.message' && event.payload.thread === thread.id).slice(-12).map((event) => ({
      id: event.id, tick: event.tick ?? null, sender: typeof event.payload.sender === 'string' ? event.payload.sender : '?',
      ours: event.payload.sender === state.team, text: cleanQuote(event.payload.text ?? quotes.get(event.id)),
    })).sort((a, b) => a.id - b.id),
  }))
}
