/**
 * The Rivals screen's source: GET /api/rivals as soon as the server says its rows changed, and on a timer as the
 * fallback (with `?token=` when the page has one), or a made-up market with `?mock=1`. Keeps the last good snapshot
 * through an error, like ./strategy.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import { pollEvery, type PagePush } from './fresh.ts'
import { HOW_KNOWN, EMPTY_RIVALS, type RivalCard, type RivalsSnapshot, type RivalTeam, type RivalWant } from '../../shared/rivals.ts'
import { SLOT_RARITY } from './game.ts'
import { mockBoard } from './rivalBoardMock.ts'

export type RivalsStatus = 'loading' | 'live' | 'off' | 'locked' | 'error' | 'mock'

export interface RivalsState {
  readonly status: RivalsStatus
  readonly snapshot: RivalsSnapshot
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** An answer of /api/rivals → the screen's state. The server already checked every row. */
export function rivalsStateOf(httpStatus: number, body: unknown, prev: RivalsSnapshot): RivalsState {
  if (httpStatus === 401) return { status: 'locked', snapshot: EMPTY_RIVALS }
  if (httpStatus !== 200 || !isObject(body)) return { status: 'error', snapshot: prev }
  if (body.enabled !== true) return { status: 'off', snapshot: EMPTY_RIVALS }
  const parts = isObject(body.parts) ? body.parts : {}
  return {
    status: 'live',
    snapshot: {
      at: typeof body.at === 'string' ? body.at : null,
      parts: { holdings: parts.holdings === true, teams: parts.teams === true, wants: parts.wants === true, head: parts.head === true, board: parts.board === true },
      tick: typeof body.tick === 'number' ? body.tick : null,
      holdings: list(body.holdings),
      teams: list(body.teams),
      wants: list(body.wants),
      board: list(body.board),
    },
  }
}

/** `push`: the server's notices for this screen (./fresh.ts): a new `at` refetches now; the timer backs them up. */
export function useRivals(mock: boolean, token: string | null, tick: number, push: PagePush | null = null): RivalsState {
  const intervalMs = pollEvery('rivals', push)
  const wake = push?.at ?? null
  const [state, setState] = useState<RivalsState>({ status: 'loading', snapshot: EMPTY_RIVALS })
  // the mock moves on every 20 ticks of the mock game's clock, not every tick
  const step = Math.floor(tick / 20) * 20
  const mocked = useMemo<RivalsState | null>(() => (mock ? { status: 'mock', snapshot: mockRivals(step) } : null), [mock, step])
  useEffect(() => {
    if (mock) return
    let stopped = false
    let controller: AbortController | null = null
    const read = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      try {
        const res = await fetch(`/api/rivals${token ? `?token=${encodeURIComponent(token)}` : ''}`, { signal: controller.signal, cache: 'no-store' })
        const body: unknown = await res.json().catch(() => null)
        if (!stopped) setState((s) => rivalsStateOf(res.status, body, s.snapshot))
      } catch (error: unknown) {
        if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) setState((s) => ({ status: 'error', snapshot: s.snapshot }))
      }
    }
    void read()
    const timer = setInterval(() => void read(), intervalMs)
    return () => {
      stopped = true
      clearInterval(timer)
      controller?.abort()
    }
    // a new `wake` reads now and starts the timer again from there
  }, [mock, token, intervalMs, wake])
  return mocked ?? state
}

/** A small deterministic hash: the same made-up market on every load. */
const roll = (...keys: (string | number)[]): number => {
  let h = 2166136261
  for (const ch of keys.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/**
 * A made-up market around `tick`, for `?mock=1`: seventeen rivals, each known through a few dozen public moves, the
 * rares scarce, a dealer holding one, and a few teams bidding for the rares everyone wants.
 */
export function mockRivals(tick: number): RivalsSnapshot {
  const sets = ['LAV', 'MAL', 'LAT', 'SAL', 'RET'] as const
  const teams = Array.from({ length: 17 }, (_, i) => `t${String(i + 2).padStart(2, '0')}`)
  const holdings: RivalCard[] = []
  for (const team of teams) {
    const fav = sets[Math.floor(roll(team, 'fav') * sets.length)] ?? 'LAV'
    for (const set of sets) {
      SLOT_RARITY.slice(0, 10).forEach((rarity, i) => {
        const odds = (rarity === 'rare' ? 0.18 : rarity === 'uncommon' ? 0.3 : 0.38) + (set === fav ? 0.3 : 0)
        if (roll(team, set, i) > odds) return
        const since = Math.max(0, tick - Math.floor(roll(team, set, i, 'since') * 600))
        holdings.push({
          holder: team, card: `${set}-${String(i + 1).padStart(2, '0')}`, set, rarity, name: null,
          copies: roll(team, set, i, 'n') > 0.85 ? 2 : 1, how: HOW_KNOWN[Math.floor(roll(team, set, i, 'how') * 5)] ?? 'bought',
          since, seen: since + Math.floor(roll(team, set, i, 'seen') * (tick - since)),
        })
      })
    }
  }
  holdings.push({ holder: 'chato', card: 'MAL-10', set: 'MAL', rarity: 'rare', name: null, copies: 1, how: 'bought', since: Math.max(0, tick - 11), seen: Math.max(0, tick - 11) })
  const ranked = [...teams, 't01'].sort((a, b) => roll(b, 'score') - roll(a, 'score'))
  const rows: RivalTeam[] = ranked.map((team, i) => ({
    team, rank: i + 1, score: Math.round((31 - i * 0.9 - roll(team, 'gap')) * 100) / 100, level: 3 + Math.round(roll(team, 'lvl')),
    pages: Math.floor(roll(team, 'pages') * 3), deals: 20 + Math.floor(roll(team, 'deals') * 40), tick,
    interest: Object.fromEntries(sets.map((set) => [set, Math.round((roll(team, set, 'int') - 0.6) * 100)])),
  }))
  const wants: RivalWant[] = []
  for (const team of teams) {
    for (const set of sets) {
      for (const i of [8, 9]) {
        const r = roll(team, set, i, 'want')
        if (r > 0.12) continue
        const card = `${set}-${String(i + 1).padStart(2, '0')}`
        wants.push({ team, card, via: r < 0.06 ? 'bid' : 'dealer', times: 1 + Math.floor(r * 100), last: Math.max(0, tick - Math.floor(r * 1500)), topBid: r < 0.06 ? 40 + Math.floor(r * 600) : null })
      }
    }
  }
  return { at: new Date(0).toISOString(), parts: { holdings: true, teams: true, wants: true, head: true, board: true }, tick, holdings, teams: rows, wants, board: mockBoard(rows, tick) }
}
