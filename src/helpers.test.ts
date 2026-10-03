import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfig } from './config'
import type { ShowEvent } from './model/events'
import { MOCK_STEPS, MockPlayer, shiftEnvelope } from './mock/player'
import { fetchHealth, fetchState, getJson } from './net/http'
import { verdictFamily } from './show/jev'
import { createRemote, fetchRemoteProviders } from './tts/remote'
import { providerFactory } from './tts/select'
import { SILENT } from './tts/types'
import { modeOf } from './ui/mode'

describe('readConfig', () => {
  it('reads ?mock, ?speed, ?tts and ?mode with safe defaults', () => {
    expect(readConfig('')).toEqual({ mock: false, speed: 1, tts: 'auto', mockMode: 'live', lang: 'es', speakQuotes: false })
    expect(readConfig('?mock=1&speed=20&tts=Gemini&mode=dry&lang=EN&quotes=speak')).toEqual({ mock: true, speed: 8, tts: 'gemini', mockMode: 'dry', lang: 'en', speakQuotes: true })
    expect(readConfig('?mock&speed=abc&tts=shout&lang=fr&quotes=yes')).toEqual({ mock: true, speed: 1, tts: 'auto', mockMode: 'live', lang: 'es', speakQuotes: false })
    expect(readConfig('?mock=0').mock).toBe(false)
  })
})

describe('modeOf and verdictFamily', () => {
  const health = { ok: true, agent: 'taker', mode: 'live' as const, tick: 1, doors: 'open', paused: false, nextOpens: null, tickSeconds: 15, serverTick: 1 }
  it('labels LIVE / DRY RUN from /health only', () => {
    expect(modeOf(health, 'open')).toBe('live')
    expect(modeOf({ ...health, mode: 'dry' }, 'open')).toBe('dry')
    expect(modeOf(null, 'open')).toBe('offline')
    expect(modeOf({ ...health, ok: false }, 'open')).toBe('offline')
    expect(modeOf({ ...health, mode: null }, 'reconnecting')).toBe('offline')
  })

  it('groups a verdict with its siblings for the meter', () => {
    expect(verdictFamily('fair')).toEqual(['quick_sale', 'fair', 'aggressive'])
    expect(verdictFamily('YES')).toEqual(['no', 'yes'])
    expect(verdictFamily('undecided')).toEqual(['undecided'])
  })
})

describe('http', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses /health and /state and fails loudly on errors', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.endsWith('/health') ? Response.json({ ok: true, agent: 'maker', mode: 'dry' }) : url.endsWith('/state') ? Response.json({ agent: 'maker', open_offers: [{ id: 1, ref: 'LAT-09', price: 5 }] }) : new Response('no', { status: 503 }),
    )
    expect((await fetchHealth('https://maker'))?.mode).toBe('dry')
    expect((await fetchState('https://maker'))?.openOffers?.[0]?.ref).toBe('LAT-09')
    await expect(getJson('https://maker/other')).rejects.toThrow('503')
  })
})

describe('remote TTS client', () => {
  it('lists only known providers, and none without a proxy', async () => {
    const ok = (async () => Response.json({ providers: ['gemini', 'evil', 'elevenlabs'] })) as unknown as typeof fetch
    const down = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    expect(await fetchRemoteProviders(ok)).toEqual(['gemini', 'elevenlabs'])
    expect(await fetchRemoteProviders(down)).toEqual([])
    expect(await fetchRemoteProviders((async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toEqual([])
  })

  it('prefetches each line once and retries a failed one', async () => {
    const bodies: string[] = []
    let fail = true
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body))
      if (fail) return new Response('', { status: 502 })
      return new Response(new Blob(['mp3']), { status: 200 })
    }) as unknown as typeof fetch
    const remote = createRemote('elevenlabs', { fetchImpl })
    const u = { id: '1', speaker: 'seller' as const, text: '[laughs] Hola' }
    const aborted = new AbortController()
    aborted.abort()
    await expect(remote.speak(u, aborted.signal)).rejects.toThrow('502')
    fail = false
    remote.prefetch?.(u)
    remote.prefetch?.(u)
    await remote.speak(u, aborted.signal)
    expect(bodies.length).toBe(2)
    expect(JSON.parse(bodies[1]!)).toEqual({ provider: 'elevenlabs', speaker: 'seller', text: '[laughs] Hola' })
  })

  it('hands out one provider per name', () => {
    const make = providerFactory(null)
    expect(make('off')).toBe(SILENT)
    expect(make('webspeech')).toBe(SILENT)
    expect(make('gemini')).toBe(make('gemini'))
    expect(make('gemini').name).toBe('gemini')
  })
})

describe('MockPlayer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shifts ids and ticks per loop and sets the mode', () => {
    const step = MOCK_STEPS.find((s) => s.event.type === 'agent.decision')!
    const next = shiftEnvelope(step.event, 2, 'dry')
    expect(next.id).toBe((step.event.id as number) - 2000)
    expect((next.payload as Record<string, unknown>).dry_run).toBe(true)
  })

  it('plays the whole scene through the parser, then loops', async () => {
    const events: ShowEvent[] = []
    const ticks: number[] = []
    const player = new MockPlayer({ speed: 4, mode: 'live', onEvent: (e) => events.push(e), onTick: (t) => ticks.push(t) })
    player.start()
    await vi.advanceTimersByTimeAsync(70_000 / 4)
    expect(events.length).toBeGreaterThanOrEqual(MOCK_STEPS.length)
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length)
    expect(ticks[0]).toBe(301)
    expect(player.health('taker')?.mode).toBe('live')
    expect(player.state('maker')?.openOffers?.length).toBe(2)
    player.stop()
  })
})
