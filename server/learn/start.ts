/**
 * Brings /api/learn up from the environment: the same read-only role as the transcript (SHOW_DATABASE_URL)
 * on its own one-connection pool, and the game screens' GAME_VIEW_TOKEN. Without the url, or with a broken
 * one, the route answers `enabled: false` and everything else runs as before.
 */
import { EMPTY_LEARN, type LearnSnapshot } from '../../shared/learn.ts'
import { createShowPool, readShowDatabase, secretsOf, type ShowPool } from '../transcript/pg.ts'
import { LearnPoller } from './poller.ts'

export interface Learn {
  readonly enabled: () => boolean
  readonly snapshot: () => LearnSnapshot
  readonly token: string | null
  readonly stop: () => Promise<void>
}

export function startLearn(env: Readonly<Record<string, string | undefined>>, log: (entry: Record<string, unknown>) => void): Learn {
  const token = env.GAME_VIEW_TOKEN?.trim() || null
  const off: Learn = { enabled: () => false, snapshot: () => EMPTY_LEARN, token, stop: () => Promise.resolve() }
  const config = readShowDatabase(env)
  if (!config.enabled) {
    log({ route: 'learn', event: 'off', reason: config.reason })
    return off
  }
  let pool: ShowPool | null = null
  try {
    pool = createShowPool(config.url, (error) => log({ route: 'learn', event: 'pool_error', code: (error as { code?: string } | null)?.code ?? 'ERR' }), 1)
    const poller = new LearnPoller({ db: pool, log, secrets: secretsOf(config.url) })
    poller.start()
    if (token === null) log({ route: 'learn', event: 'open', note: 'GAME_VIEW_TOKEN unset: the agents\' learnings are readable by anyone with the URL' })
    log({ route: 'learn', event: 'on' })
    const live = pool
    return {
      enabled: () => true,
      snapshot: () => poller.current(),
      token,
      stop: async () => {
        poller.stop()
        await live.end().catch(() => undefined)
      },
    }
  } catch (error: unknown) {
    log({ route: 'learn', event: 'start_failed', code: (error as { code?: string } | null)?.code ?? 'ERR' })
    void pool?.end().catch(() => undefined)
    return off
  }
}
