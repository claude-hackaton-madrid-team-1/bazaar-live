/**
 * The connection to the show's read-only role (SHOW_DATABASE_URL). Only a `*.railway.internal` or loopback
 * host is accepted: the private network carries no TLS and needs none, and a public proxy url (with a
 * password in it) is refused rather than sent across the internet. Absent → the feature is off and the
 * show runs exactly as before. The url is a secret: it is read once here, never logged, and every error
 * text is redacted against `secretsOf(url)` before it leaves the process.
 */
import pg from 'pg'
import type { Db } from './poller.ts'

export type ShowDatabase =
  | { readonly enabled: true; readonly url: string }
  | { readonly enabled: false; readonly reason: 'absent' | 'not_postgres' | 'host_not_allowed' }

/** Railway's private network (no TLS, never leaves the project) or this machine. Nothing else. */
const ALLOWED_HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*\.railway\.internal|localhost|127\.0\.0\.1|\[::1\])$/i

export function readShowDatabase(env: Readonly<Record<string, string | undefined>>): ShowDatabase {
  const url = env.SHOW_DATABASE_URL?.trim()
  if (!url) return { enabled: false, reason: 'absent' }
  if (!/^postgres(?:ql)?:\/\//i.test(url)) return { enabled: false, reason: 'not_postgres' }
  try {
    // The url carries a password: it must only ever be sent over the private network (or to this machine).
    return ALLOWED_HOST.test(new URL(url).hostname) ? { enabled: true, url } : { enabled: false, reason: 'host_not_allowed' }
  } catch {
    return { enabled: false, reason: 'not_postgres' }
  }
}

/** A tiny pool: two connections, and no statement may run longer than 2 s. */
export function poolOptions(url: string): pg.PoolConfig {
  return {
    connectionString: url,
    max: 2,
    statement_timeout: 2000,
    query_timeout: 4000,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    application_name: 'bazaar-live',
  }
}

/** What an error text must never contain: the url itself, its host, user and password. */
export function secretsOf(url: string): string[] {
  const secrets = [url]
  try {
    const parsed = new URL(url)
    for (const part of [parsed.hostname, decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)]) {
      if (part) secrets.push(part)
    }
  } catch {
    // An unparseable url is still redacted whole.
  }
  return secrets
}

export interface ShowPool extends Db {
  end(): Promise<void>
}

/** The pool, with an error listener: an idle client dying must never become an uncaught exception. */
export function createShowPool(url: string, onError: (error: unknown) => void): ShowPool {
  const pool = new pg.Pool(poolOptions(url))
  pool.on('error', onError)
  return {
    query: (sql, params) => pool.query(sql, params ? [...params] : undefined).then((r) => ({ rows: r.rows as unknown[] })),
    end: () => pool.end(),
  }
}
