/**
 * The Bazaar Live server: the static show plus a tiny TTS proxy.
 *
 *   GET  /health               {ok, service, tts: [...]}  (Railway's healthcheck)
 *   GET  /api/tts/providers    {providers: ["elevenlabs", "gemini"]}: the ones with a key
 *   POST /api/tts              {provider, speaker, text} → audio (MP3 or WAV)
 *   GET  /*                    dist/ (SPA)
 *
 * The proxy is public, so it only speaks the show's own short lines: same-origin requests, one of
 * the five speakers, at most MAX_TEXT characters, a per-address and a global rate limit, and a cache
 * so a repeated line costs nothing. Keys come from the environment and never leave this process.
 */
import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CONNECT_SOURCES } from '../shared/endpoints.ts'
import { isSpeaker } from '../shared/tags.ts'
import { LruCache, RateLimiter } from './limits.ts'
import { availableProviders, elevenLabs, gemini, UpstreamError, type Audio, type ProviderConfig, type ProviderId } from './providers.ts'
import { createStatic } from './static.ts'

export const MAX_TEXT = 300
const MAX_BODY = 2048

/** Rate limits for /api/tts, overridable from the environment (ElevenLabs bills per character). */
export interface TtsLimits {
  readonly perAddressBurst: number
  readonly perAddressPerMinute: number
  readonly globalBurst: number
  readonly globalPerMinute: number
}

export const DEFAULT_LIMITS: TtsLimits = { perAddressBurst: 40, perAddressPerMinute: 30, globalBurst: 120, globalPerMinute: 30 }

export function readLimits(env: Readonly<Record<string, string | undefined>>): TtsLimits {
  const read = (name: string, fallback: number) => {
    const n = Number(env[name])
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    perAddressBurst: read('TTS_PER_ADDRESS_BURST', DEFAULT_LIMITS.perAddressBurst),
    perAddressPerMinute: read('TTS_PER_ADDRESS_PER_MINUTE', DEFAULT_LIMITS.perAddressPerMinute),
    globalBurst: read('TTS_GLOBAL_BURST', DEFAULT_LIMITS.globalBurst),
    globalPerMinute: read('TTS_GLOBAL_PER_MINUTE', DEFAULT_LIMITS.globalPerMinute),
  }
}

export interface AppDeps {
  readonly config: ProviderConfig
  readonly limits?: TtsLimits
  readonly distDir: string
  readonly fetchImpl?: typeof fetch
  readonly perClient?: RateLimiter
  readonly global?: RateLimiter
  readonly cache?: LruCache<Audio>
  readonly log?: (entry: Record<string, unknown>) => void
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
].join('; ')

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CSP,
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

/** The caller's address as Railway's edge reports it. */
export function clientAddress(req: IncomingMessage): string {
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real) return real
  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || req.socket.remoteAddress || 'unknown'
}

/** A browser on another site may not spend our credits. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

interface TtsRequest {
  readonly provider: ProviderId
  readonly speaker: Parameters<typeof elevenLabs>[1]
  readonly text: string
}

export function parseTtsRequest(raw: string, available: readonly ProviderId[]): TtsRequest | string {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return 'body is not JSON'
  }
  if (typeof body !== 'object' || body === null) return 'body must be an object'
  const { provider, speaker, text } = body as Record<string, unknown>
  if (provider !== 'elevenlabs' && provider !== 'gemini') return 'provider must be elevenlabs or gemini'
  if (!available.includes(provider)) return `${provider} is not configured on this server`
  if (!isSpeaker(speaker)) return 'unknown speaker'
  // eslint-disable-next-line no-control-regex
  const clean = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
  if (!clean || clean.length > MAX_TEXT) return `text must be 1 to ${MAX_TEXT} characters`
  return { provider, speaker, text: clean }
}

export function createApp(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const log = deps.log ?? defaultLog
  const fetchImpl = deps.fetchImpl ?? fetch
  const limits = deps.limits ?? DEFAULT_LIMITS
  const perClient = deps.perClient ?? new RateLimiter({ capacity: limits.perAddressBurst, refillPerSecond: limits.perAddressPerMinute / 60 })
  const global = deps.global ?? new RateLimiter({ capacity: limits.globalBurst, refillPerSecond: limits.globalPerMinute / 60 })
  const cache = deps.cache ?? new LruCache<Audio>(24 * 1024 * 1024)
  // Every viewer hears the same line for the same event: one upstream call serves them all.
  const inFlight = new Map<string, Promise<Audio>>()
  const available = availableProviders(deps.config)
  const serveStatic = createStatic(deps.distDir)

  async function synthesize(req: TtsRequest): Promise<Audio> {
    if (req.provider === 'elevenlabs' && deps.config.elevenlabs) return elevenLabs(deps.config.elevenlabs, req.speaker, req.text, fetchImpl)
    if (req.provider === 'gemini' && deps.config.gemini) return gemini(deps.config.gemini, req.speaker, req.text, fetchImpl)
    throw new UpstreamError(req.provider, 503, 'not configured')
  }

  async function tts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' })
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross_origin' })
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return json(res, 415, { error: 'json_only' })
    const raw = await readBody(req, MAX_BODY)
    if (raw === null) {
      res.on('finish', () => req.socket.destroy())
      return json(res, 413, { error: 'too_large' }, { Connection: 'close' })
    }
    const parsed = parseTtsRequest(raw, available)
    if (typeof parsed === 'string') return json(res, 400, { error: 'bad_request', message: parsed })
    const key = `${parsed.provider}|${parsed.speaker}|${parsed.text}`
    const started = Date.now()
    let audio = cache.get(key)
    const shared = inFlight.get(key)
    const hit = audio !== undefined || shared !== undefined
    if (!audio) {
      const limited = shared ? undefined : [perClient.take(clientAddress(req)), global.take('*')].find((r) => !r.ok)
      if (limited && !limited.ok) {
        log({ route: 'tts', status: 429, provider: parsed.provider })
        return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(limited.retryAfterSeconds) })
      }
      try {
        const pending = shared ?? synthesize(parsed).finally(() => inFlight.delete(key))
        if (!shared) inFlight.set(key, pending)
        audio = await pending
        cache.set(key, audio)
      } catch (error: unknown) {
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
