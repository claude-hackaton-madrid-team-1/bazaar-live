/**
 * The Strategy screen's source: GET /api/strategy as soon as the server says its rows changed, and on a timer as
 * the fallback (with `?token=` when the page has one), or a made-up afternoon with `?mock=1`. Keeps the last good snapshot through an error, like ./history.ts.
 */
import { useMemo } from 'react'
import { usePolled } from '../net/poll.ts'
import { pollEvery, type PagePush } from './fresh.ts'
import type { GuardrailLimits } from '../../shared/decisions.ts'
import { GUARDRAILS_DOC } from '../../shared/guardrails.ts'
import { EMPTY_STRATEGY, type CatalogCard, type HeldCard, type OpenAsk, type StrategyDecision, type StrategySnapshot } from '../../shared/strategy.ts'
import { SETS } from './game.ts'

export type StrategyStatus = 'loading' | 'live' | 'off' | 'locked' | 'error' | 'mock'

export interface StrategyState {
  readonly status: StrategyStatus
  readonly snapshot: StrategySnapshot
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** An answer of /api/strategy → the screen's state. The server already checked every row. */
export function strategyStateOf(httpStatus: number, body: unknown, prev: StrategySnapshot): StrategyState {
  if (httpStatus === 401) return { status: 'locked', snapshot: EMPTY_STRATEGY }
  if (httpStatus !== 200 || !isObject(body)) return { status: 'error', snapshot: prev }
  if (body.enabled !== true) return { status: 'off', snapshot: EMPTY_STRATEGY }
  const parts = isObject(body.parts) ? body.parts : {}
  return {
    status: 'live',
    snapshot: {
      at: typeof body.at === 'string' ? body.at : null,
      parts: { me: parts.me === true, spend: parts.spend === true, decisions: parts.decisions === true, asks: parts.asks === true, cards: parts.cards === true },
      me: isObject(body.me) ? (body.me as unknown as StrategySnapshot['me']) : null,
      spend: isObject(body.spend) ? (body.spend as unknown as StrategySnapshot['spend']) : null,
      decisions: list(body.decisions),
      asks: list(body.asks),
      cards: list(body.cards),
      limits: isObject(body.limits) && typeof body.limits.cashFloor === 'number' && typeof body.limits.spendPerHour === 'number' ? (body.limits as unknown as GuardrailLimits) : null,
    },
  }
}

/**
 * `push`: the server's notices for this screen (./fresh.ts): a new `at` refetches now, and while they come the
 * timer only backs them up.
 */
export function useStrategy(mock: boolean, token: string | null, tick: number, push: PagePush | null = null): StrategyState {
  const intervalMs = pollEvery('strategy', push)
  const state = usePolled<StrategyState>(mock ? null : `/api/strategy${token ? `?token=${encodeURIComponent(token)}` : ''}`, { status: 'loading', snapshot: EMPTY_STRATEGY }, intervalMs, push?.at ?? null, strategyStateOf)
  const mocked = useMemo<StrategyState | null>(() => (mock ? { status: 'mock', snapshot: mockStrategy(tick) } : null), [mock, tick])
  return mocked ?? state
}

const RARITY = (i: number): string => (i <= 5 ? 'common' : i <= 8 ? 'uncommon' : 'rare')
const BOOK: Readonly<Record<string, number>> = { common: 5, uncommon: 25, rare: 70 }

/**
 * A made-up afternoon around `tick`, for `?mock=1`, shaped like Saturday's: Salamanca complete, Lavapiés and Malasaña
 * two rares short, the taker turning down MAL-10 at the cash floor again and again, an uncommon over its cap we have
 * since bought, Jev refusing swaps, and the maker selling spares.
 */
export function mockStrategy(tick: number): StrategySnapshot {
  const t = Math.max(320, tick)
  const affinity = { LAV: 1.6, SAL: 1.3, MAL: 1.1, CHA: 0.9, RET: 0.7, LAT: 0.5 }
  const sets = ['LAV', 'MAL', 'LAT', 'SAL', 'RET'] as const
  const cards: CatalogCard[] = sets.flatMap((set) =>
    Array.from({ length: 10 }, (_, k) => {
      const i = k + 1
      const rarity = RARITY(i)
      return {
        card: `${set}-${String(i).padStart(2, '0')}`, set, setName: SETS[set]?.name ?? set, name: null, rarity, book: BOOK[rarity] ?? 5,
        minted: rarity === 'rare' ? 5 : 40, printRun: rarity === 'rare' ? 30 : 300, page: true, lastFill: rarity === 'rare' ? 82 : rarity === 'uncommon' ? 24 : 7, lastFillTick: t - 12,
      }
    }),
  )
  const own: [string, number, number][] = [
    ['LAV-01', 1, 16], ['LAV-02', 1, 16], ['LAV-03', 1, 16], ['LAV-04', 2, 4], ['LAV-05', 2, 4], ['LAV-06', 2, 10], ['LAV-07', 1, 40], ['LAV-08', 1, 40],
    ['MAL-01', 1, 11], ['MAL-02', 2, 2.8], ['MAL-03', 1, 11], ['MAL-04', 1, 11], ['MAL-05', 1, 11], ['MAL-06', 1, 27.5], ['MAL-07', 1, 27.5], ['MAL-08', 2, 6.9],
    ['SAL-01', 3, 1.3], ['SAL-02', 1, 99.1], ['SAL-03', 2, 3.2], ['SAL-04', 1, 99.1], ['SAL-05', 1, 99.1], ['SAL-06', 1, 118.6], ['SAL-07', 1, 118.6], ['SAL-08', 1, 118.6], ['SAL-09', 1, 177.1], ['SAL-10', 2, 22.8],
    ['LAT-02', 2, 1.2], ['LAT-03', 2, 5], ['RET-06', 1, 17.5],
  ]
  let asset = 1
  const held: HeldCard[] = own.flatMap(([ref, copies, value]) =>
    Array.from({ length: copies }, () => ({ ref, set: ref.slice(0, 3), rarity: RARITY(Number(ref.slice(4))), asset: asset++, value })),
  )
  const assetOf = (ref: string): number | null => held.filter((h) => h.ref === ref).at(-1)?.asset ?? null
  type Defaults = Pick<StrategyDecision, 'allowed' | 'giveCard' | 'venue' | 'fee' | 'jevValue' | 'jevVerdict' | 'jevReason'>
  const base: Defaults = { allowed: false, giveCard: null, venue: 'rastro', fee: null, jevValue: null, jevVerdict: null, jevReason: null }
  let id = 2000
  const decisions: StrategyDecision[] = []
  const push = (d: Omit<StrategyDecision, 'id' | keyof Defaults> & Partial<Defaults>) => decisions.push({ ...base, ...d, id: id-- })
  for (let k = 0; k < 9; k++) {
    push({ tick: t - 4 - k * 5, agent: 'taker', kind: 'accept_ask', status: 'rejected', guardrail: `denied: cash 81 - ${k % 2 ? 83 : 79} < cash_floor ${GUARDRAILS_DOC.cashFloor}`, card: 'MAL-10', rarity: 'rare', price: k % 2 ? 78 : 74, total: k % 2 ? 83 : 79, value: 113.4, surplus: 34.4, reason: 'worth 70×1.1 + bonus share 36.4 = 113.4; ask 74 + fee 5 on rastro = 79; 5/30 minted, 4 for sale, chased by t17' })
  }
  for (let k = 0; k < 6; k++) {
    push({ tick: t - 2 - k * 3, agent: 'taker', kind: 'team_open', status: 'rejected', guardrail: null, allowed: true, card: 'LAT-07', giveCard: 'SAL-10', rarity: null, price: null, total: null, value: null, surplus: null, jevValue: 0.29 + k * 0.02, jevVerdict: 'undecided', jevReason: 'below_threshold', reason: `jev undecided (${(0.29 + k * 0.02).toFixed(2)} < 0.75 or not yes, below_threshold)` })
  }
  push({ tick: t - 1, agent: 'maker', kind: 'post_ask', status: 'done', guardrail: null, allowed: true, card: 'SAL-01', rarity: 'common', price: 10, total: null, value: 1.3, surplus: null, reason: 'ours 1.3 (SAL ×1.3, duplicate); t03, t06, t08, t16 chase SAL: 0.6×10×1.6 = 10; tape SAL-01 ×4 9' })
  push({ tick: t - 3, agent: 'maker', kind: 'post_ask', status: 'done', guardrail: null, allowed: true, card: 'LAT-03', rarity: 'common', price: 12, total: null, value: 6.8, surplus: null, reason: 'ours 5 + page bonus 1.8 (LAT ×0.5); nobody seen chasing LAT; tape LAT-03 ×2 9; spare: ours + 5' })
  push({ tick: t - 50, agent: 'maker', kind: 'cancel_ask', status: 'done', guardrail: null, allowed: true, card: 'LAT-02', rarity: null, price: 10, total: null, value: null, surplus: null, reason: 'LAT-02 is no longer a sell target' })
  for (let k = 0; k < 12; k++) {
    push({ tick: t - 200 - k * 4, agent: 'taker', kind: 'accept_ask', status: 'rejected', guardrail: k % 3 ? 'denied: price 31 > max_price_uncommon 26' : `denied: price 31 > max_price_uncommon 26; cash 33 - 31 < cash_floor ${GUARDRAILS_DOC.cashFloor}`, card: 'SAL-08', rarity: 'uncommon', price: 29, total: 31, value: 55.2, surplus: 24.2, reason: 'worth 25×1.3 + bonus share 22.7 = 55.2; ask 29 + fee 2 on rastro = 31' })
  }
  decisions.sort((a, b) => b.id - a.id)
  const ask = (offer: number, card: string, price: number, ours = false, to: string | null = null): OpenAsk => ({
    offer, tick: t - 3, expiresTick: t + 17, venue: 'rastro', maker: ours ? 't01' : 't17', to, asset: ours ? assetOf(card) : null, card, rarity: RARITY(Number(card.slice(4))), price, ours,
  })
  const asks: OpenAsk[] = [
    ask(9161, 'SAL-01', 10, true), ask(9116, 'LAT-03', 12, true),
    ask(9141, 'LAT-01', 10), ask(9123, 'LAT-04', 7), ask(9124, 'LAV-01', 7), ask(9125, 'LAV-04', 6), ask(9126, 'MAL-01', 9), ask(9127, 'MAL-02', 7),
    ask(9128, 'SAL-01', 9), ask(9129, 'LAT-03', 6), ask(9130, 'LAV-06', 23), ask(9131, 'LAT-08', 25), ask(9111, 'SAL-10', 90, false, 't01'),
  ]
  return {
    at: new Date(0).toISOString(),
    parts: { me: true, spend: true, decisions: true, asks: true, cards: true },
    me: {
      team: 't01', tick: t, at: null, cash: 81, level: 3, venue: 'v19', tickSeconds: 15, affinity,
      pages: [
        { set: 'LAV', name: 'Lavapiés', have: 8, of: 10, complete: false },
        { set: 'MAL', name: 'Malasaña', have: 8, of: 10, complete: false },
        { set: 'LAT', name: 'La Latina', have: 2, of: 10, complete: false },
        { set: 'SAL', name: 'Salamanca', have: 10, of: 10, complete: true },
        { set: 'RET', name: 'El Retiro', have: 1, of: 10, complete: false },
      ],
      cards: held,
    },
    spend: { ledgerTick: t - 1, tHours: 6.5, spent: 0, buys: 0 },
    decisions,
    asks,
    cards,
  }
}
