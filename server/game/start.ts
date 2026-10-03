/**
 * Brings the game relay up from the environment. Everything that can go wrong here is caught: the show
 * must run exactly as before without BAZAAR_KEY, and with a refused one.
 */
import { readGameConfig, type GameTarget } from './config.ts'
import { GameHub, GameRelay } from './relay.ts'

export interface Game {
  readonly hub: GameHub | null
  readonly relay: GameRelay | null
  /** True while a relay is polling with a key the game has not refused. */
  readonly enabled: () => boolean
  readonly target: GameTarget | null
  readonly token: string | null
  readonly stop: () => void
}

export function startGame(env: Readonly<Record<string, string | undefined>>, log: (entry: Record<string, unknown>) => void, fetchImpl?: typeof fetch): Game {
  const off: Game = { hub: null, relay: null, enabled: () => false, target: null, token: null, stop: () => undefined }
  const config = readGameConfig(env)
  if (!config.enabled) {
    log({ route: 'game', event: 'off', reason: config.reason })
    return off
  }
  try {
    const hub = new GameHub()
    const relay = new GameRelay({ url: config.url, key: config.key, hub, log, pollMs: config.pollMs, ...(fetchImpl ? { fetchImpl } : {}) })
    relay.start()
    log({ route: 'game', event: 'on', target: config.target, pollMs: config.pollMs, token: config.token !== null })
    if (config.token === null) log({ route: 'game', event: 'open_stream', note: 'GAME_VIEW_TOKEN unset: the team\'s private state (cash, assets, our duel offers) is readable by anyone with the URL' })
    return { hub, relay, enabled: () => !relay.keyRefused, target: config.target, token: config.token, stop: () => relay.stop() }
  } catch (error: unknown) {
    log({ route: 'game', event: 'start_failed', message: error instanceof Error ? error.name : 'ERR' })
    return off
  }
}
