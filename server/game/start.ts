/**
 * Brings the game screens' feed up from the environment. Everything that can go wrong here is caught: the
 * show must run exactly as before without BAZAAR_KEY, and with a refused one.
 *
 * Two sources, one hub. With the show's pool (SHOW_DATABASE_URL) and GAME_SOURCE not `api`, our own database
 * (`./dbsource.ts`, db/game.sql's views); if those views are missing, it says so once and falls back to the
 * game's API. Otherwise the API relay (`./relay.ts`) with the team key, as before.
 *
 * Other teams' set multipliers (the database source's `agent.affinity`) are relayed only when GAME_VIEW_TOKEN is set:
 * they are our intel and other teams' private thread words, never for a stream anyone with the URL can open.
 */
import type { SharedShowPool } from '../transcript/pg.ts'
import { readGameConfig, type GameTarget } from './config.ts'
import { GameDbSource } from './dbsource.ts'
import { GameHub, GameRelay } from './relay.ts'

export type GameSourceKind = 'db' | 'api'

export interface Game {
  readonly hub: GameHub | null
  readonly relay: GameRelay | null
  readonly db: GameDbSource | null
  /** True while a source is feeding the hub: the database's views are there, or the API relay's key is not refused. */
  readonly enabled: () => boolean
  /** Where the hub's events come from right now, null while off. */
  readonly source: () => GameSourceKind | null
  readonly target: GameTarget | null
  readonly token: string | null
  readonly stop: () => void
}

export function startGame(
  env: Readonly<Record<string, string | undefined>>,
  log: (entry: Record<string, unknown>) => void,
  fetchImpl?: typeof fetch,
  show?: SharedShowPool | null,
): Game {
  const off: Game = { hub: null, relay: null, db: null, enabled: () => false, source: () => null, target: null, token: null, stop: () => undefined }
  const config = readGameConfig(env)
  const token = env.GAME_VIEW_TOKEN?.trim() || null
  const fromDb = show != null && (env.GAME_SOURCE ?? '').trim().toLowerCase() !== 'api'
  if (!fromDb && !config.enabled) {
    log({ route: 'game', event: 'off', reason: config.reason })
    return off
  }
  try {
    const hub = new GameHub()
    let relay: GameRelay | null = null
    let db: GameDbSource | null = null
    const startRelay = (): void => {
      if (!config.enabled) {
        log({ route: 'game', event: 'off', reason: config.reason })
        return
      }
      relay = new GameRelay({ url: config.url, key: config.key, hub, log, pollMs: config.pollMs, ...(fetchImpl ? { fetchImpl } : {}) })
      relay.start()
      log({ route: 'game', event: 'on', source: 'api', target: config.target, pollMs: config.pollMs, token: token !== null })
    }
    if (fromDb) {
      db = new GameDbSource({ db: show.pool, hub, log, secrets: show.secrets, onMissing: startRelay, affinity: token !== null })
      db.start()
      log({ route: 'game', event: 'on', source: 'db', token: token !== null })
      if (token === null) log({ route: 'game', event: 'affinity_off', note: 'GAME_VIEW_TOKEN unset: other teams\' set multipliers and words are relayed only behind the token' })
    } else startRelay()
    if (token === null) log({ route: 'game', event: 'open_stream', note: 'GAME_VIEW_TOKEN unset: the team\'s private state (cash, assets, our duel offers) is readable by anyone with the URL' })
    const source = (): GameSourceKind | null => {
      if (db !== null && !db.viewsMissing) return 'db'
      const r = relay as GameRelay | null
      return r !== null && !r.keyRefused ? 'api' : null
    }
    return {
      hub,
      get relay() {
        return relay
      },
      db,
      enabled: () => source() !== null,
      source,
      target: fromDb ? 'real' : config.enabled ? config.target : null,
      token,
      stop: () => {
        db?.stop()
        ;(relay as GameRelay | null)?.stop()
      },
    }
  } catch (error: unknown) {
    log({ route: 'game', event: 'start_failed', message: error instanceof Error ? error.name : 'ERR' })
    return off
  }
}
