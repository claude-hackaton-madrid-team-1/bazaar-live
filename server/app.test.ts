import { Buffer } from 'node:buffer'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clientAddress, createApp, parseTtsRequest } from './app.ts'
import { LruCache, RateLimiter } from './limits.ts'
import { geminiAudioData, geminiRequest, readProviderConfig, wavFromPcm } from './providers.ts'

const servers: Server[] = []
afterEach(() => servers.splice(0).forEach((s) => s.close()))

function dist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bazaar-live-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bazaar Live</title>')
  return dir
}

async function start(env: Record<string, string>, fetchImpl: typeof fetch, extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const server = createServer(createApp({ config: readProviderConfig(env), distDir: dist(), fetchImpl, log: () => undefined, ...extra }))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const tts = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

describe('the TTS proxy', () => {
  it('reports no providers and still serves the show when no key is set', async () => {
    const base = await start({}, fetch)
    expect(await (await fetch(`${base}/api/tts/providers`)).json()).toEqual({ providers: [] })
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, service: 'bazaar-live', tts: [] })
    const page = await fetch(`${base}/any/route`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("connect-src 'self'")
    expect(await page.text()).toContain('Bazaar Live')
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'hola' })).status).toBe(400)
  })

  it('calls ElevenLabs with the key server-side, returns audio and caches it', async () => {
    const calls: { url: string; headers: Record<string, string>; body: unknown }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
      return new Response(Buffer.from('ID3fake-mp3'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
    }) as unknown as typeof fetch
    const base = await start({ ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_VOICE_BUYER: 'voice123' }, fake)
    const body = { provider: 'elevenlabs', speaker: 'buyer', text: '[laughs] ¡Me lo llevo!' }
    const first = await tts(base, body)
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('audio/mpeg')
    expect(Buffer.from(await first.arrayBuffer()).toString()).toBe('ID3fake-mp3')
    expect((await tts(base, body)).status).toBe(200)
    expect(calls.length).toBe(1)
    expect(calls[0]?.url).toContain('/v1/text-to-speech/voice123')
    expect(calls[0]?.headers['xi-api-key']).toBe('test-key')
    expect(calls[0]?.body).toEqual({ text: '[laughs] ¡Me lo llevo!', model_id: 'eleven_v4' })
  })

  it('refuses cross-origin callers, bad bodies and long text, and rate-limits per address', async () => {
    const fake = (async () => new Response(Buffer.from('mp3'), { status: 200 })) as unknown as typeof fetch
    const base = await start({ ELEVENLABS_API_KEY: 'k' }, fake, { perClient: new RateLimiter({ capacity: 2, refillPerSecond: 0.001 }) })
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'hi' }, { Origin: 'https://evil.example' })).status).toBe(403)
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'root', text: 'hi' })).status).toBe(400)
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'x'.repeat(301) })).status).toBe(400)
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'one' })).status).toBe(200)
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'two' })).status).toBe(200)
    const limited = await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'three' })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    // A cached line costs nothing, so it is served even when the address is out of tokens.
    expect((await tts(base, { provider: 'elevenlabs', speaker: 'buyer', text: 'one' })).status).toBe(200)
  })

  it('answers 502 without leaking upstream details when the provider fails', async () => {
    const fake = (async () => new Response('quota exceeded for key k-123', { status: 401 })) as unknown as typeof fetch
    const base = await start({ GEMINI_API_KEY: 'k-123' }, fake)
    const res = await tts(base, { provider: 'gemini', speaker: 'abuela', text: 'Ay, cariño.' })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('k-123')
  })

  it('turns a Gemini Interactions answer into WAV', async () => {
    const pcm = Buffer.alloc(480)
    const fake = (async () => Response.json({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: pcm.toString('base64') }] }] })) as unknown as typeof fetch
    const base = await start({ GEMINI_API_KEY: 'k' }, fake)
    const res = await tts(base, { provider: 'gemini', speaker: 'chato', text: '[snorts] Walk, then.' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/wav')
    const wav = Buffer.from(await res.arrayBuffer())
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.length).toBe(44 + 480)
  })
})

describe('provider helpers', () => {
  it('builds the Gemini request with persona + line style and inline vocal bursts', () => {
    const req = geminiRequest('gemini-3.8-flash-tts', 'Puck', 'buyer', '[sarcastic] Sure. [laughs]') as { input: { content: { text: string; annotations: { style: string }[] }[] }[]; generation_config: unknown }
    const part = req.input[0]!.content[0]!
    expect(part.text).toBe('Sure. <laugh>')
    expect(part.annotations[0]!.style).toMatch(/bargain hunter.*; sarcastic$/)
    expect(req.generation_config).toEqual({ speech_config: [{ voice: 'Puck' }] })
  })

  it('finds the audio block, or the convenience field, or nothing', () => {
    expect(geminiAudioData({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'x' }, { type: 'audio', data: 'QUJD' }] }] })).toBe('QUJD')
    expect(geminiAudioData({ output_audio: { data: 'REVG' } })).toBe('REVG')
    expect(geminiAudioData({ steps: [] })).toBeNull()
  })

  it('writes a valid 24 kHz mono 16-bit WAV header', () => {
    const wav = wavFromPcm(Buffer.alloc(100))
    expect(wav.readUInt32LE(24)).toBe(24_000)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(100)
  })

  it('reads keys, default models and voice overrides from the environment', () => {
    const config = readProviderConfig({ GEMINI_API_KEY: ' g ', GEMINI_TTS_MODEL: 'gemini-3.8-flash-lite-tts', GEMINI_VOICE_SELLER: 'Kore' })
    expect(config.elevenlabs).toBeNull()
    expect(config.gemini).toMatchObject({ key: 'g', model: 'gemini-3.8-flash-lite-tts' })
    expect(config.gemini?.voices.seller).toBe('Kore')
    expect(readProviderConfig({ ELEVENLABS_API_KEY: 'e' }).elevenlabs?.model).toBe('eleven_v4')
  })

  it('validates TTS requests', () => {
    expect(parseTtsRequest('nope', ['gemini'])).toBe('body is not JSON')
    expect(parseTtsRequest(JSON.stringify({ provider: 'gemini', speaker: 'buyer', text: '  hola\u0007 ' }), ['gemini'])).toEqual({ provider: 'gemini', speaker: 'buyer', text: 'hola' })
  })

  it('prefers the edge-reported address', () => {
    const req = { headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.1' } } as unknown as Parameters<typeof clientAddress>[0]
    expect(clientAddress(req)).toBe('1.2.3.4')
  })
})

describe('limits', () => {
  it('refills tokens over time', () => {
    let now = 0
    const rl = new RateLimiter({ capacity: 1, refillPerSecond: 1 }, () => now)
    expect(rl.take('a').ok).toBe(true)
    expect(rl.take('a')).toEqual({ ok: false, retryAfterSeconds: 1 })
    now = 1000
    expect(rl.take('a').ok).toBe(true)
  })

  it('evicts the least recently used audio past the byte budget', () => {
    const cache = new LruCache<{ body: Buffer }>(10)
    cache.set('a', { body: Buffer.alloc(4) })
    cache.set('b', { body: Buffer.alloc(4) })
    cache.get('a')
    cache.set('c', { body: Buffer.alloc(4) })
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBeDefined()
    expect(cache.size).toBe(2)
  })
})

describe('shared upstream calls and limits from env', () => {
  it('serves concurrent requests for the same line with one upstream call', async () => {
    let calls = 0
    const fake = (async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 30))
      return new Response(Buffer.from('mp3'), { status: 200 })
    }) as unknown as typeof fetch
    const base = await start({ ELEVENLABS_API_KEY: 'k' }, fake)
    const body = { provider: 'elevenlabs', speaker: 'seller', text: '¡Oiga, oiga!' }
    const results = await Promise.all([tts(base, body), tts(base, body), tts(base, body)])
    expect(results.map((r) => r.status)).toEqual([200, 200, 200])
    expect(calls).toBe(1)
  })

  it('reads positive numbers and ignores junk', async () => {
    const { readLimits, DEFAULT_LIMITS } = await import('./app.ts')
    expect(readLimits({ TTS_GLOBAL_PER_MINUTE: '90', TTS_GLOBAL_BURST: '-1', TTS_PER_ADDRESS_BURST: 'abc' })).toEqual({ ...DEFAULT_LIMITS, globalPerMinute: 90 })
  })
})
