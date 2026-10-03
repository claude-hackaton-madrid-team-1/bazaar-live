/**
 * The approver's sessions and the login's lockout, both in memory (a restart logs everyone out and forgets the
 * failures, which errs on the safe side for the first and is bounded by the global cap for the second).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const COOKIE = 'bz_approver'
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000
const MAX_SESSIONS = 50
/** randomBytes(32) as base64url. */
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * Whether two secrets are equal, in constant time whatever their lengths: both sides are hashed first, so
 * timingSafeEqual always compares 32 bytes (it throws on unequal lengths) and the length of neither leaks.
 */
export function secretEquals(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

export interface Session {
  readonly id: string
  readonly csrf: string
  readonly expiresAt: number
}

const token = (): string => randomBytes(32).toString('base64url')

/** Live sessions by id, at most `max`: a new one past the cap drops the oldest. */
export class SessionStore {
  private sessions = new Map<string, Session>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly max: number

  constructor(opts: { now?: () => number; ttlMs?: number; max?: number } = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.ttlMs = opts.ttlMs ?? SESSION_TTL_MS
    this.max = opts.max ?? MAX_SESSIONS
  }

  create(): Session {
    const session: Session = { id: token(), csrf: token(), expiresAt: this.now() + this.ttlMs }
    const next = new Map(this.sessions)
    next.set(session.id, session)
    while (next.size > this.max) {
      const oldest = next.keys().next().value
      if (oldest === undefined) break
      next.delete(oldest)
    }
    this.sessions = next
    return session
  }

  /** The live session for a cookie value; an expired one is dropped. */
  get(id: string | null): Session | null {
    if (id === null || !ID_PATTERN.test(id)) return null
    const session = this.sessions.get(id)
    if (!session) return null
    if (session.expiresAt <= this.now()) {
      this.drop(id)
      return null
    }
    return session
  }

  drop(id: string): void {
    if (!this.sessions.has(id)) return
    const next = new Map(this.sessions)
    next.delete(id)
    this.sessions = next
  }

  get size(): number {
    return this.sessions.size
  }
}

interface Failures {
  /** When each failure inside the window happened. */
  readonly at: readonly number[]
  readonly lockedUntil: number
}

const NONE: Failures = { at: [], lockedUntil: 0 }

export interface LoginGuardOptions {
  readonly now?: () => number
  /** Failures from one address inside the window that lock it. */
  readonly perAddress?: number
  /** Failures from every address together inside the window that lock everyone. */
  readonly global?: number
  readonly windowMs?: number
  readonly lockMs?: number
  readonly maxKeys?: number
}

/**
 * The login's lockout: 5 failures from one address in 15 minutes lock that address for 15 minutes, and 20 from all
 * addresses together lock everyone for 15 minutes (a guess spread over many addresses stays bounded). A locked
 * caller is refused before its password is even compared, so the right password does not open it either.
 */
export class LoginGuard {
  private byAddress = new Map<string, Failures>()
  private everyone: Failures = NONE
  private readonly now: () => number
  private readonly perAddress: number
  private readonly global: number
  private readonly windowMs: number
  private readonly lockMs: number
  private readonly maxKeys: number

  constructor(opts: LoginGuardOptions = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.perAddress = opts.perAddress ?? 5
    this.global = opts.global ?? 20
    this.windowMs = opts.windowMs ?? 15 * 60 * 1000
    this.lockMs = opts.lockMs ?? 15 * 60 * 1000
    this.maxKeys = opts.maxKeys ?? 10_000
  }

  /** Seconds until `address` may try again, 0 when it may now. */
  lockedFor(address: string): number {
    const until = Math.max(this.byAddress.get(address)?.lockedUntil ?? 0, this.everyone.lockedUntil)
    const left = until - this.now()
    return left > 0 ? Math.ceil(left / 1000) : 0
  }

  fail(address: string): void {
    const now = this.now()
    this.everyone = this.counted(this.everyone, now, this.global)
    const next = new Map(this.byAddress)
    next.delete(address)
    next.set(address, this.counted(this.byAddress.get(address) ?? NONE, now, this.perAddress))
    while (next.size > this.maxKeys) {
      const oldest = next.keys().next().value
      if (oldest === undefined) break
      next.delete(oldest)
    }
    this.byAddress = next
  }

  /** A right password clears that address's count (never the global one). */
  succeed(address: string): void {
    if (!this.byAddress.has(address)) return
    const next = new Map(this.byAddress)
    next.delete(address)
    this.byAddress = next
  }

  private counted(prev: Failures, now: number, limit: number): Failures {
    const at = [...prev.at.filter((t) => now - t < this.windowMs), now]
    return at.length >= limit ? { at: [], lockedUntil: now + this.lockMs } : { at, lockedUntil: prev.lockedUntil }
  }
}

/** The session cookie's value from a Cookie header, or null. */
export function cookieOf(header: string | undefined): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.split('=')
    if (name?.trim() === COOKIE) return rest.join('=').trim() || null
  }
  return null
}

const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Strict; Path=/api/approver'

export function sessionCookie(id: string): string {
  return `${COOKIE}=${id}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_TTL_MS / 1000}`
}

export function clearedCookie(): string {
  return `${COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`
}
