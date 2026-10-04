/** Trade facts are evidence, not an inference from an agent's name or a venue's owner. */
import type { DecisionRow, OutcomeRow } from '../decisions.ts'
import type { BookOffer, State } from '../state.ts'

export type TradeStage = 'planned' | 'submitted' | 'listed' | 'accepted' | 'settled' | 'failed' | 'expired' | 'rejected' | 'offered' | 'noDeal'
export type TradeFacts = {
  readonly stage: TradeStage
  readonly seller: string | null
  readonly buyer: string | null
  readonly venue: string | null
  readonly dealer: boolean
  readonly offerId: number | null
  readonly threadId: number | null
  readonly openToAnyone: boolean
}

const BUY = new Set(['accept_ask', 'post_bid', 'dealer_bid', 'dealer_accept'])
const SELL = new Set(['accept_bid', 'post_ask', 'dealer_sell_offer', 'dealer_sell_accept'])

export function offerFacts(o: BookOffer): TradeFacts {
  return {
    stage: 'listed', seller: o.side === 'ask' ? o.maker : o.to,
    buyer: o.side === 'bid' ? o.maker : o.to, venue: o.venue,
    dealer: false, offerId: o.id, threadId: null, openToAnyone: o.to == null,
  }
}

export function outcomeFacts(s: State, o: OutcomeRow): TradeFacts | null {
  if (o.target === 'duel') return null // duels move no cash/cards
  const match = /^settlement:(\d+)$/.exec(o.subject)
  const trade = match ? s.tape.find((t) => t.settlementId === Number(match[1]) && (o.item == null || t.ref === o.item)) : undefined
  return {
    stage: o.price == null ? 'noDeal' : 'settled',
    seller: trade?.seller ?? (o.side === 'sell' ? s.team : o.side === 'buy' ? o.counterparty : null),
    buyer: trade?.buyer ?? (o.side === 'buy' ? s.team : o.side === 'sell' ? o.counterparty : null),
    venue: trade?.venue ?? null, dealer: o.target === 'dealer', offerId: null,
    threadId: o.target === 'dealer' ? Number(/^thread:(\d+)$/.exec(o.subject)?.[1]) || null : null,
    openToAnyone: false,
  }
}

export function decisionFacts(s: State, d: DecisionRow): TradeFacts | null {
  if (d.agent === 'duels' || d.kind.startsWith('duel')) return null
  const side = d.trade?.side ?? (BUY.has(d.kind) ? 'buy' : SELL.has(d.kind) ? 'sell' : null)
  if (side == null) return null
  const outcome = s.agents.outcomes.find((o) => o.decision === d.decision && o.agent === d.agent && o.price != null)
  if (outcome) return outcomeFacts(s, outcome)
  const posted = d.kind === 'post_ask' || d.kind === 'post_bid' || d.kind === 'team_cash_offer'
  const stage: TradeStage = d.status === 'failed' || d.error != null ? 'failed'
    : d.status === 'rejected' ? 'rejected' : d.status === 'expired' ? 'expired'
      : d.status === 'done' ? (d.method === 'accept' || d.method === 'accept_offer') ? 'accepted' : posted ? 'listed' : 'offered'
        : d.status === 'claimed' ? 'submitted' : 'planned'
  const counterparty = d.trade?.recipient ?? d.counterparty
  return {
    stage, seller: side === 'sell' ? s.team : counterparty, buyer: side === 'buy' ? s.team : counterparty,
    venue: d.trade?.venue ?? null, dealer: d.kind.startsWith('dealer'),
    offerId: d.trade?.offerId ?? null, threadId: d.trade?.threadId ?? null,
    openToAnyone: posted && d.trade != null && d.kind !== 'team_cash_offer' && counterparty == null,
  }
}
