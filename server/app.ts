/**
 * The Bazaar Live server: the static show plus a tiny TTS proxy.
 *
 *   GET  /health               {ok, service, tts: [...]}  (Railway's healthcheck)
 *   GET  /api/tts/providers    {providers: ["elevenlabs", "gemini"]}: the ones with a key
 *   POST /api/tts              {provider, speaker, text} → audio (MP3 or WAV)
 *   GET  /api/transcript       the real conversations, JSON (LIVE-T1; `enabled: false` without a database)
 *   GET  /api/transcript/stream  the same as server-sent events
 *   GET  /api/game             {enabled, target, source, tokenRequired}: the game screens' feed (our database, or the team key's relay)
 *   GET  /api/game/stream      that feed as server-sent events (GAME_VIEW_TOKEN as ?token= when set)
 *   GET  /api/learn            what our agents learned, JSON (db/learn.sql; GAME_VIEW_TOKEN as ?token= when set)
 *   GET  /api/history          our cash over the day and what moved it, JSON (db/history.sql; the same token)
 *   GET  /*                    dist/ (SPA)
 *
 * The proxy is public, so it only speaks the show's own short lines: same-origin requests, one of
 * the five speakers, at most MAX_TEXT characters, a per-address and a global rate limit, and a cache
 * so a repeated line costs nothing. Keys come from the environment and never leave this process.
 */
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CONNECT_SOURCES } from '../shared/endpoints.ts'
import { isLang, LANGS, type Lang } from '../shared/lang.ts'
import { EMPTY_HISTORY } from '../shared/history.ts'
import { EMPTY_LEARN } from '../shared/learn.ts'
import { isShowLine } from '../shared/lines.ts'
import { detectLang } from '../shared/detect-lang.ts'
import { isRealLine } from '../shared/real-lines.ts'
import { isSpeaker, type Speaker } from '../shared/tags.ts'
import { addressKey, DailyBudget, DEFAULT_LIMITS, LruCache, RateLimiter, type TtsLimits } from './limits.ts'
import { availableProviders, elevenLabs, gemini, UpstreamError, type Audio, type ProviderConfig, type ProviderId } from './providers.ts'
import { createGameRoutes, type GameRouteDeps } from './game/routes.ts'
import { createHistoryRoutes, type HistoryRouteDeps } from './history/routes.ts'
import { createLearnRoutes, type LearnRouteDeps } from './learn/routes.ts'
import { createStatic } from './static.ts'
import { createTranscriptRoutes, type TranscriptRouteDeps } from './transcript/routes.ts'
import { TranscriptStore } from './transcript/store.ts'

export const MAX_TEXT = 300
const MAX_BODY = 2048

export interface AppDeps {
  readonly config: ProviderConfig
  readonly limits?: TtsLimits
  readonly distDir: string
  readonly fetchImpl?: typeof fetch
  readonly perClient?: RateLimiter
  readonly global?: RateLimiter
  readonly cache?: LruCache<Audio>
  readonly budget?: DailyBudget
  readonly log?: (entry: Record<string, unknown>) => void
  /** The real conversations (LIVE-T1); absent → /api/transcript answers `enabled: false`. */
  readonly transcript?: Pick<TranscriptRouteDeps, 'store' | 'enabled' | 'limiter' | 'maxStreams' | 'maxPerAddress' | 'heartbeatMs' | 'maxLifetimeMs' | 'openLimiter'> & {
    /** Voice real quotes the server read from the database. Off by default: they are captions only. */
    readonly vouchQuotes?: boolean
  }
  /** The game screens' feed (server/game); absent → /api/game answers `enabled: false`. */
  readonly game?: Pick<GameRouteDeps, 'hub' | 'enabled' | 'target' | 'token' | 'source'> & Partial<Pick<GameRouteDeps, 'maxStreams' | 'maxPerAddress' | 'heartbeatMs' | 'maxLifetimeMs' | 'openLimiter' | 'maxQueuedBytes'>>
  /** What our agents learned (server/learn); absent → /api/learn answers `enabled: false`. */
  readonly learn?: Pick<LearnRouteDeps, 'enabled' | 'snapshot' | 'token'> & Partial<Pick<LearnRouteDeps, 'limiter'>>
  /** Our cash and what moved it (server/history); absent → /api/history answers `enabled: false`. */
  readonly history?: Pick<HistoryRouteDeps, 'enabled' | 'snapshot' | 'token'> & Partial<Pick<HistoryRouteDeps, 'limiter'>>
}

const CSP = [
  "default-src 'self'",
  `connect-src 'self' ${CONNECT_SOURCES.join(' ')}`,
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

const defaultLog = (entry: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(text)
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        // Stop reading but keep the socket: the 413 still has to go out (the caller closes it after).
        req.off('data', onData)
        req.pause()
        resolve(null)
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * The caller's address: the header Railway's edge sets (X-Real-IP, as bazaar-sim trusts), else the
 * socket. X-Forwarded-For is never read: its first entry is whatever the client wrote.
 */
export function clientAddress(req: IncomingMessage, header = DEFAULT_LIMITS.clientIpHeader): string {
  const value = req.headers[header]
  const first = (Array.isArray(value) ? value[0] : value)?.trim()
  return addressKey(first || req.socket.remoteAddress || 'unknown')
}

/**
 * Browsers send Origin on every POST; ours must name this host (a missing one is refused too). The
 * host is `Host`, or `X-Forwarded-Host` when Railway's edge reports the original one there.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return false
  const forwarded = req.headers['x-forwarded-host']
  const hosts = [req.headers.host, (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()]
  try {
    const host = new URL(origin).host
    return hosts.some((h) => h !== undefined && h !== '' && h === host)
  } catch {
    return false
  }
}

interface TtsRequest {
  readonly provider: ProviderId
  readonly speaker: Parameters<typeof elevenLabs>[1]
  /** The line's one language: the page's, or the one whose templates the text matches. */
  readonly lang: Lang
  readonly text: string
}

/**
 * A body for the proxy, or why not. The text must be a line the show can vouch for: one of its own
 * templates, a line generated from a real conversation's structure, or a quote the server itself read
 * from the database (`vouches`). Nothing a caller invents is ever voiced.
 */
export function parseTtsRequest(raw: string, available: readonly ProviderId[], vouches: (text: string, speaker: Speaker) => boolean = () => false): TtsRequest | string {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return 'body is not JSON'
  }
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const { provider, speaker, text, lang: rawLang } = body as Record<string, unknown>
  if (provider !== 'elevenlabs' && provider !== 'gemini') return 'provider must be elevenlabs or gemini'
  if (!available.includes(provider)) return `${provider} is not configured on this server`
  if (!isSpeaker(speaker)) return 'unknown speaker'
  // eslint-disable-next-line no-control-regex
  const clean = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
  if (!clean || clean.length > MAX_TEXT) return `text must be 1 to ${MAX_TEXT} characters`
  if (rawLang !== undefined && !isLang(rawLang)) return `lang must be one of ${LANGS.join(', ')}`
  // A line is in one language: the page's when it says so, else the first whose templates match.
  const own = (l: Lang) => isShowLine(speaker, clean, l) || isRealLine(clean, l)
  const lang = rawLang ?? LANGS.find(own)
  if (lang && own(lang)) return { provider, speaker, lang, text: clean }
  // A quote the server read from the database itself: voiced only in the language it is actually in.
  if (vouches(clean, speaker)) {
    const detected = detectLang(clean)
    const quoteLang = rawLang ?? (detected === 'unknown' ? undefined : detected)
    if (quoteLang && detected === quoteLang) return { provider, speaker, lang: quoteLang, text: clean }
  }
  return 'only the show\'s own lines are spoken here'
}

export function createApp(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const log = deps.log ?? defaultLog
  const fetchImpl = deps.fetchImpl ?? fetch
  const limits = deps.limits ?? DEFAULT_LIMITS
  const perClient = deps.perClient ?? new RateLimiter({ capacity: limits.perAddressBurst, refillPerSecond: limits.perAddressPerMinute / 60 })
  const global = deps.global ?? new RateLimiter({ capacity: limits.globalBurst, refillPerSecond: limits.globalPerMinute / 60 })
  const cache = deps.cache ?? new LruCache<Audio>(24 * 1024 * 1024)
  const budget = deps.budget ?? new DailyBudget(limits.dailyChars, limits.dailyCharsPerAddress)
  // Every viewer hears the same line for the same event: one upstream call serves them all.
  const inFlight = new Map<string, Promise<Audio>>()
  const available = availableProviders(deps.config)
  const serveStatic = createStatic(deps.distDir)
  const transcriptStore = deps.transcript?.store ?? new TranscriptStore()
  const transcript = createTranscriptRoutes({
    enabled: () => false,
    ...deps.transcript,
    store: transcriptStore,
    headers: SECURITY_HEADERS,
    address: (req) => clientAddress(req, limits.clientIpHeader),
  })
  const game = createGameRoutes({
    hub: null, enabled: () => false, target: null, token: null,
    ...deps.game,
    headers: SECURITY_HEADERS,
    address: (req) => clientAddress(req, limits.clientIpHeader),
  })

  const learn = createLearnRoutes({
    enabled: () => false, snapshot: () => EMPTY_LEARN, token: null,
    ...deps.learn,
    headers: SECURITY_HEADERS,
    address: (req) => clientAddress(req, limits.clientIpHeader),
  })

  const history = createHistoryRoutes({
    enabled: () => false, snapshot: () => EMPTY_HISTORY, token: null,
    ...deps.history,
    headers: SECURITY_HEADERS,
    address: (req) => clientAddress(req, limits.clientIpHeader),
  })

  async function synthesize(req: TtsRequest): Promise<Audio> {
    if (req.provider === 'elevenlabs' && deps.config.elevenlabs) return elevenLabs(deps.config.elevenlabs, req.speaker, req.lang, req.text, fetchImpl)
    if (req.provider === 'gemini' && deps.config.gemini) return gemini(deps.config.gemini, req.speaker, req.lang, req.text, fetchImpl)
    throw new UpstreamError(req.provider, 503, 'not configured')
  }

  async function tts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' })
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross_origin' })
    const mediaType = String(req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') return json(res, 415, { error: 'json_only' })
    const raw = await readBody(req, MAX_BODY)
    if (raw === null) {
      res.on('finish', () => req.socket.destroy())
      return json(res, 413, { error: 'too_large' }, { Connection: 'close' })
    }
    const parsed = parseTtsRequest(raw, available, (text, speaker) => deps.transcript?.vouchQuotes === true && transcriptStore.quote(text)?.speaker === speaker)
    if (typeof parsed === 'string') return json(res, 400, { error: 'bad_request', message: parsed })
    const key = `${parsed.provider}|${parsed.lang}|${parsed.speaker}|${parsed.text}`
    const started = Date.now()
    let audio = cache.get(key)
    const shared = inFlight.get(key)
    const hit = audio !== undefined || shared !== undefined
    if (!audio) {
      const address = clientAddress(req, limits.clientIpHeader)
      if (!shared) {
        // The address is checked before the global bucket, and nothing is spent unless both allow it:
        // a caller over its own limit cannot drain the tokens everyone else shares.
        const limited = [perClient.peek(address), global.peek('*')].find((r) => !r.ok)
        if (limited && !limited.ok) {
          log({ route: 'tts', status: 429, provider: parsed.provider })
          return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(limited.retryAfterSeconds) })
        }
        const allowed = budget.allows(address, parsed.text.length)
        if (allowed !== 'ok') {
          log({ route: 'tts', status: 429, provider: parsed.provider, budget: allowed })
          return json(res, 429, { error: 'daily_budget' }, { 'Retry-After': '3600' })
        }
        perClient.take(address)
        global.take('*')
        budget.spend(address, parsed.text.length)
      }
      try {
        const pending = shared ?? synthesize(parsed).finally(() => inFlight.delete(key))
        if (!shared) inFlight.set(key, pending)
        audio = await pending
        cache.set(key, audio)
      } catch (error: unknown) {
        // The provider refused (an HTTP error answer): nothing was billed, so the characters go back, to
        // the caller that spent them. A timeout or a cut-off body may have been billed: no refund.
        if (!shared && error instanceof UpstreamError) budget.refund(address, parsed.text.length)
        const status = error instanceof UpstreamError ? error.status : 0
        log({ route: 'tts', status: 502, provider: parsed.provider, upstream: status, error: error instanceof Error ? error.message : String(error) })
        return json(res, 502, { error: 'tts_failed', provider: parsed.provider })
      }
    }
    log({ route: 'tts', status: 200, provider: parsed.provider, speaker: parsed.speaker, chars: parsed.text.length, cache: hit, ms: Date.now() - started })
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': audio.contentType, 'Content-Length': String(audio.body.length), 'Cache-Control': 'no-store' })
    res.end(audio.body)
  }

  return async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', 'http://local').pathname
      if (path === '/health') return json(res, 200, { ok: true, service: 'bazaar-live', tts: available })
      if (path === '/api/tts/providers') return json(res, 200, { providers: available })
      if (path === '/api/tts') return await tts(req, res)
      if (transcript(req, res, path)) return
      if (game(req, res, path)) return
      if (learn(req, res, path)) return
      if (history(req, res, path)) return
      if (path.startsWith('/api/')) return json(res, 404, { error: 'not_found' })
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' })
      await serveStatic(req, res, SECURITY_HEADERS)
    } catch (error: unknown) {
      log({ route: req.url, status: 500, error: error instanceof Error ? error.message : String(error) })
      if (!res.headersSent) json(res, error instanceof URIError ? 400 : 500, { error: 'server_error' })
      else res.end()
    }
  }
}
