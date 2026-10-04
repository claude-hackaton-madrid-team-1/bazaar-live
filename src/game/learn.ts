/**
 * The Learn screen's source: GET /api/learn as soon as the server says its rows changed, and on a timer as the
 * fallback (with `?token=` when the page has one), or a made-up snapshot with `?mock=1`. Keeps the last good
 * snapshot through an error.
 */
import { useMemo } from 'react'
import { usePolled } from '../net/poll.ts'
import { pollEvery, type PagePush } from './fresh.ts'
import { EMPTY_LEARN, type Learning, type LearnSnapshot } from '../../shared/learn.ts'

export type LearnStatus = 'loading' | 'live' | 'off' | 'locked' | 'error' | 'mock'

export interface LearnState {
  readonly status: LearnStatus
  readonly snapshot: LearnSnapshot
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** An answer of /api/learn → the screen's state. The server already checked every row. */
export function learnStateOf(httpStatus: number, body: unknown, prev: LearnSnapshot): LearnState {
  if (httpStatus === 401) return { status: 'locked', snapshot: EMPTY_LEARN }
  if (httpStatus !== 200 || !isObject(body)) return { status: 'error', snapshot: prev }
  if (body.enabled !== true) return { status: 'off', snapshot: EMPTY_LEARN }
  const parts = isObject(body.parts) ? body.parts : {}
  return {
    status: 'live',
    snapshot: {
      at: typeof body.at === 'string' ? body.at : null,
      parts: { learnings: parts.learnings === true, moves: parts.moves === true, dealers: parts.dealers === true, rivals: parts.rivals === true },
      learnings: list(body.learnings),
      moves: list(body.moves),
      dealers: list(body.dealers),
      rivals: list(body.rivals),
    },
  }
}

/**
 * `push`: the server's notices for this screen (./fresh.ts): a new `at` refetches now, and while they come the
 * timer only backs them up.
 */
export function useLearn(mock: boolean, token: string | null, tick: number, push: PagePush | null = null): LearnState {
  const intervalMs = pollEvery('learn', push)
  const state = usePolled<LearnState>(mock ? null : `/api/learn${token ? `?token=${encodeURIComponent(token)}` : ''}`, { status: 'loading', snapshot: EMPTY_LEARN }, intervalMs, push?.at ?? null, learnStateOf)
  // the mock follows the mock game's clock, so its cooloffs count down and lift
  const mocked = useMemo<LearnState | null>(() => (mock ? { status: 'mock', snapshot: mockLearn(tick) } : null), [mock, tick])
  return mocked ?? state
}

const L = (id: number, kind: string, subjectKind: string, subject: string, claim: string, extra: Partial<Learning> = {}): Learning => ({
  id, kind, subjectKind, subject, claim, source: 'rules', confidence: 0.8, support: 3, createdTick: 0, untilTick: null, team: null, stats: null, ...extra,
})

/** A plausible afternoon of learnings around `tick`, for `?mock=1`. Made up, and the screen says so. */
export function mockLearn(tick: number): LearnSnapshot {
  const t = Math.max(0, tick)
  const ago = (n: number) => Math.max(0, t - n)
  const learnings: Learning[] = [
    L(1, 'cooloff', 'dealer', 'chato', 'El Chato sent us away after a lowball on LAV-08: no new thread with him until it lifts.', { untilTick: t + 6, team: 't01', createdTick: ago(2), support: 2 }),
    L(2, 'quota', 'dealer', 'abuela', "Abuela's hourly allotment for us is used up.", { untilTick: t + 14, team: 't01', createdTick: ago(1), support: 1, confidence: 1 }),
    L(3, 'sold_out', 'dealer', 'tatuador', 'El Tatuador has no rare left to sell this hour.', { untilTick: t + 3, createdTick: ago(4) }),
    L(4, 'blocker', 'dealer', 'reina', 'La Reina deals only from level 3: we are level 2.', { untilTick: t + 40, team: 't01', createdTick: 1, confidence: 1, support: 1 }),
    L(5, 'cooloff', 'dealer', 'abuela', 'Abuela sent t01 away (lifted).', { untilTick: Math.max(0, t - 1), team: 't01' }),
    L(10, 'lesson', 'dealer', 'abuela', 'Abuela fills commons at ~60% of her opening ask when we concede in steps of 2-3 P; a jump above 70% ends the thread at her price.', { source: 'outcome', confidence: 0.82, support: 9, createdTick: ago(8) }),
    L(11, 'policy', 'dealer', 'chato', 'Ladder for El Chato: open at 45% of his ask, +4 P per round, walk at 75%. Learned from 6 threads.', { source: 'outcome', confidence: 0.64, support: 6, createdTick: ago(12), stats: { open: 0.45, step: 4, walk: 0.75 } }),
    L(12, 'tactic', 'team', 't03', 'Anchoring low against t03 earned nothing: they never moved after our first counter (0 of 4).', { source: 'outcome', confidence: 0.55, support: 4, createdTick: ago(5) }),
    L(13, 'lesson', 'dealer', 'tatuador', 'Rare cards from El Tatuador: paying his first final cost 18 P more than waiting one tick.', { source: 'outcome', confidence: 0.41, support: 2, createdTick: ago(3) }),
    L(20, 'price_floor', 'dealer', 'abuela', 'Abuela never went below 11 P for a common Lavapiés card (23 threads, all teams).', { confidence: 0.9, support: 23, createdTick: ago(1) }),
    L(21, 'behaviour', 'dealer', 'chato', 'El Chato answers a lowball with a final, then reopens 2 ticks later at the same price.', { source: 'llm', confidence: 0.6, support: 5, createdTick: ago(3) }),
    L(22, 'fee_change', 'venue', 'rastro', 'El Rastro raises its fee to 5% from game hour 4.', { confidence: 1, support: 1, createdTick: ago(6) }),
    L(23, 'announcement', 'organiser', 'organiser', 'Level 3 dealers open at 15:00.', { confidence: 1, support: 1, createdTick: ago(9) }),
  ]
  let id = 1000
  const move = (trader: string, thread: number, dt: number, event: string, theirPrice: number | null, ourPrice: number | null, step: number, ours: boolean) => ({
    id: id++, trader, thread, tick: Math.max(0, t - dt), event, theirPrice, ourPrice, step, final: event === 'final', ours,
  })
  const moves = [
    move('abuela', 518, 9, 'open', 24, null, 1, true), move('abuela', 518, 8, 'concede', 21, 12, 2, true), move('abuela', 518, 7, 'concede', 18, 14, 3, true),
    move('abuela', 518, 6, 'hold', 18, 15, 4, true), move('abuela', 518, 5, 'deal', 16, 16, 4, true),
    move('chato', 519, 8, 'open', 40, null, 1, true), move('chato', 519, 7, 'final', 33, 18, 2, true), move('chato', 519, 6, 'cooloff', null, 18, 2, true),
    move('abuela', 522, 4, 'open', 22, null, 1, false), move('abuela', 522, 3, 'concede', 19, 10, 2, false), move('abuela', 522, 2, 'concede', 16, 12, 3, false),
    move('tatuador', 530, 3, 'open', 80, null, 1, false), move('tatuador', 530, 2, 'hold', 80, 50, 2, false), move('tatuador', 530, 1, 'final', 74, 55, 3, false),
    move('abuela', 531, 1, 'open', 25, null, 1, true), move('abuela', 531, 0, 'concede', 22, 13, 2, true),
  ]
  return {
    at: new Date(0).toISOString(),
    parts: { learnings: true, moves: true, dealers: true, rivals: true },
    learnings,
    moves,
    dealers: [
      { dealer: 'abuela', threads: 41, deals: 23, ourThreads: 9, ourDeals: 6, avgOpen: 23.4, avgFill: 14.8, fillRatio: 0.63, ourFillRatio: 0.58, avgSteps: 3.4, avgTicks: 5.1 },
      { dealer: 'chato', threads: 27, deals: 9, ourThreads: 6, ourDeals: 1, avgOpen: 38.2, avgFill: 30.5, fillRatio: 0.8, ourFillRatio: 0.85, avgSteps: 2.1, avgTicks: 4.4 },
      { dealer: 'tatuador', threads: 12, deals: 5, ourThreads: 0, ourDeals: 0, avgOpen: 77, avgFill: 70.2, fillRatio: 0.91, ourFillRatio: null, avgSteps: 2.6, avgTicks: 3.9 },
    ],
    rivals: [
      { team: 't03', updatedTick: t, level: 2, venue: 'rastro', avgPackPrice: 22.5, dealerDealRate: 0.48, setInterest: { LAV: 6, SAL: 2 }, buys: 14, sells: 5, spent: 260, earned: 70, topSet: 'LAV' },
      { team: 't12', updatedTick: ago(1), level: 2, venue: 't12-mercadillo', avgPackPrice: null, dealerDealRate: 0.3, setInterest: { MAL: 4 }, buys: 6, sells: 11, spent: 90, earned: 180, topSet: 'MAL' },
      { team: 't17', updatedTick: ago(2), level: 1, venue: null, avgPackPrice: 19, dealerDealRate: 0.62, setInterest: { SAL: 5, LAT: 1 }, buys: 9, sells: 2, spent: 140, earned: 20, topSet: 'SAL' },
    ],
  }
}
