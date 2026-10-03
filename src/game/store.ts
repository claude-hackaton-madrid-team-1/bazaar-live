/**
 * The game screens' state, outside React: the reducer's State, fed by the server's relay (GameFeed)
 * or by the mock game (`?mock=1`), with a version that bumps at most once per animation frame, a pause
 * (the view freezes, the state keeps up) and the event the inspector shows.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { GameFeed, type GameFeedStatus } from './feed.ts'
import { MOCK_STEP_MS, MockGame } from './mock.ts'
import { apply, createState, type GameEvent, type State } from './state.ts'

export type GameStatus = GameFeedStatus | 'mock'

export interface GameSource {
  readonly mock: boolean
  /** Mock playback speed, 0.25 to 8. */
  readonly speed: number
  /** GAME_VIEW_TOKEN, from `?token=`. */
  readonly token: string | null
}

export class GameStore {
  state: State = createState()
  version = 0
  status: GameStatus = 'connecting'
  paused = false
  selected: number | null = null
  /** performance.now() of the last clock event, and the seconds it said were left in the tick. */
  clockAt = 0
  clockLeft: number | null = null
  private readonly listeners = new Set<() => void>()
  private frame: number | null = null
  private stopSource: (() => void) | null = null

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getVersion = (): number => this.version

  start(source: GameSource): void {
    this.stop()
    if (source.mock) {
      const game = new MockGame(7)
      this.status = 'mock'
      const timer = setInterval(() => this.take(game.step(), false), MOCK_STEP_MS / source.speed)
      this.take(game.step(), true)
      this.stopSource = () => clearInterval(timer)
      return
    }
    const feed = new GameFeed({
      url: '/api/game',
      token: source.token,
      onEvents: (events, replay) => this.take(events, replay),
      onStatus: (status) => {
        this.status = status
        this.notify(true)
      },
    })
    feed.start()
    this.stopSource = () => feed.stop()
  }

  stop(): void {
    this.stopSource?.()
    this.stopSource = null
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
  }

  /** A batch from the source; a replay starts again from a clean state (the relay resends everything). */
  take(events: readonly GameEvent[], replay: boolean): void {
    if (replay) this.state = createState()
    for (const e of events) {
      apply(this.state, e)
      if (e.type === 'clock') {
        this.clockAt = performance.now()
        const left = e.payload.next_tick_in
        this.clockLeft = typeof left === 'number' && Number.isFinite(left) ? left : null
      }
    }
    this.notify(replay)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.notify(true)
  }

  select(eventId: number | null): void {
    this.selected = eventId
    this.notify(true)
  }

  private notify(now: boolean): void {
    if (this.paused && !now) return
    if (now) {
      this.bump()
      return
    }
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null
      this.bump()
    })
  }

  private bump(): void {
    this.version += 1
    this.listeners.forEach((l) => l())
  }
}

export const GameContext = createContext<GameStore | null>(null)

/** The store, re-rendering the caller whenever its version changes. */
export function useGame(): GameStore {
  const store = useContext(GameContext)
  if (!store) throw new Error('useGame outside the game screens')
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion)
  return store
}

/** performance.now(), refreshed every `intervalMs`: drives the tick countdown. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
