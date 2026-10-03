/**
 * Brings the transcript up from the environment. Everything that can go wrong here is caught: the
 * show must run exactly as before without SHOW_DATABASE_URL, and with a broken one.
 */
import { Poller, type Db } from './poller.ts'
import { createShowPool, readShowDatabase, secretsOf, type SharedShowPool, type ShowPool } from './pg.ts'
import { TranscriptStore } from './store.ts'

export interface Transcript {
  readonly store: TranscriptStore
  readonly enabled: () => boolean
  readonly stop: () => Promise<void>
  /** The read-only pool, for the other readers of the show schema (server/game/decisions.ts); null while off. */
  readonly db: Db | null
  /** What their logged errors must never contain (the url, its host, user and password). */
  readonly secrets: readonly string[]
}

/** `shared`: the server's one pool (`startShowPool`), never ended here; without it, a pool of its own. */
export function startTranscript(env: Readonly<Record<string, string | undefined>>, log: (entry: Record<string, unknown>) => void, shared?: SharedShowPool | null): Transcript {
  const store = new TranscriptStore()
  const off: Transcript = { store, enabled: () => false, stop: () => Promise.resolve(), db: null, secrets: [] }
  const config = readShowDatabase(env)
  if (!config.enabled) {
    log({ route: 'transcript', event: 'off', reason: config.reason })
    return off
  }
  let pool: ShowPool | null = null
  try {
    const secrets = shared ? shared.secrets : secretsOf(config.url)
    pool = shared ? shared.pool : createShowPool(config.url, (error) => log({ route: 'transcript', event: 'pool_error', code: (error as { code?: string } | null)?.code ?? 'ERR' }))
    // Duels are off the page unless SHOW_DUELS is set: their prices reveal our limits while rivals still play.
    const duels = ['1', 'on', 'true'].includes((env.SHOW_DUELS ?? '').trim().toLowerCase())
    const poller = new Poller({ db: pool, store, log, secrets, duels })
    poller.start()
    log({ route: 'transcript', event: 'on', duels })
    const live = pool
    return {
      store,
      db: live,
      secrets,
      enabled: () => true,
      stop: async () => {
        poller.stop()
        if (!shared) await live.end().catch(() => undefined)
      },
    }
  } catch (error: unknown) {
    log({ route: 'transcript', event: 'start_failed', code: (error as { code?: string } | null)?.code ?? 'ERR' })
    if (!shared) void pool?.end().catch(() => undefined)
    return off
  }
}
