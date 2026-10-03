/**
 * Brings the transcript up from the environment. Everything that can go wrong here is caught: the
 * show must run exactly as before without SHOW_DATABASE_URL, and with a broken one.
 */
import { Poller } from './poller.ts'
import { createShowPool, readShowDatabase, secretsOf, type ShowPool } from './pg.ts'
import { TranscriptStore } from './store.ts'

export interface Transcript {
  readonly store: TranscriptStore
  readonly enabled: () => boolean
  readonly stop: () => Promise<void>
}

export function startTranscript(env: Readonly<Record<string, string | undefined>>, log: (entry: Record<string, unknown>) => void): Transcript {
  const store = new TranscriptStore()
  const off: Transcript = { store, enabled: () => false, stop: () => Promise.resolve() }
  const config = readShowDatabase(env)
  if (!config.enabled) {
    log({ route: 'transcript', event: 'off', reason: config.reason })
    return off
  }
  let pool: ShowPool | null = null
  try {
    const secrets = secretsOf(config.url)
    pool = createShowPool(config.url, (error) => log({ route: 'transcript', event: 'pool_error', code: (error as { code?: string } | null)?.code ?? 'ERR' }))
    const poller = new Poller({ db: pool, store, log, secrets })
    poller.start()
    log({ route: 'transcript', event: 'on' })
    const live = pool
    return {
      store,
      enabled: () => true,
      stop: async () => {
        poller.stop()
        await live.end().catch(() => undefined)
      },
    }
  } catch (error: unknown) {
    log({ route: 'transcript', event: 'start_failed', code: (error as { code?: string } | null)?.code ?? 'ERR' })
    void pool?.end().catch(() => undefined)
    return off
  }
}
