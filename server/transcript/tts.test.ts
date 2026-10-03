import { Buffer } from 'node:buffer'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_ITEM } from '../../shared/transcript.ts'
import { offerLine } from '../../shared/real-lines.ts'
import { guestSpeaker, SPEAKERS } from '../../shared/tags.ts'
import { createApp, parseTtsRequest } from '../app.ts'
import { readProviderConfig } from '../providers.ts'
import { TranscriptStore } from './store.ts'

const servers: Server[] = []
afterEach(() => servers.splice(0).forEach((s) => { s.closeAllConnections(); s.close() }))

const QUOTE = "Your abuela would've moved more than one. I match what you move, nothing extra."

async function start(store: TranscriptStore, vouchQuotes = false) {
  const upstream: string[] = []
  // A fake provider: no real ElevenLabs call ever happens in a test.
  const fake = (async (_url: string, init: RequestInit) => {
    upstream.push(String(init.body))
    return new Response(Buffer.from('ID3fake'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } })
  }) as unknown as typeof fetch
  const server = createServer(createApp({
    config: readProviderConfig({ ELEVENLABS_API_KEY: 'test-key' }), distDir: '/none', fetchImpl: fake, log: () => undefined,
    transcript: { store, enabled: () => true, vouchQuotes },
  }))
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const say = (speaker: string, text: string) =>
    fetch(`${base}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ provider: 'elevenlabs', speaker, text }) })
  return { say, upstream }
}

describe('what the TTS proxy will voice from a real conversation', () => {
  it('voices a generated line built from a structure', async () => {
    const { say, upstream } = await start(new TranscriptStore())
    const line = offerLine({ by: 'us', verb: 'bid', price: 24, item: 'LAV-08', final: false }, 'en')
    expect((await say('buyer', line)).status).toBe(200)
    expect(upstream).toHaveLength(1)
  })

  it('never voices a real quote by default: captions only', async () => {
    const store = new TranscriptStore()
    store.add([{ ...EMPTY_ITEM, id: 'f1', kind: 'thread_line', who: 'them', counterpart: 'chato', text: QUOTE }])
    const { say, upstream } = await start(store)
    expect((await say('chato', QUOTE)).status).toBe(400)
    expect(upstream).toHaveLength(0)
  })

  it('with TRANSCRIPT_SPEAK_QUOTES, voices a quote only after the server read it from the database', async () => {
    const store = new TranscriptStore()
    const { say, upstream } = await start(store, true)
    expect((await say('chato', QUOTE)).status).toBe(400)
    store.add([{ ...EMPTY_ITEM, id: 'f1', kind: 'thread_line', who: 'them', counterpart: 'chato', text: QUOTE }])
    expect((await say('chato', QUOTE)).status).toBe(200)
    expect(upstream).toHaveLength(1)
  })

  it("binds a quote to the dealer who said it: not voiced as our buyer, nor as the other dealer", async () => {
    const store = new TranscriptStore()
    store.add([{ ...EMPTY_ITEM, id: 'f1', kind: 'thread_line', who: 'them', counterpart: 'chato', text: QUOTE }])
    const { say, upstream } = await start(store, true)
    for (const speaker of SPEAKERS.filter((s) => s !== 'chato')) expect((await say(speaker, QUOTE)).status, speaker).toBe(400)
    expect(upstream).toHaveLength(0)
    expect((await say('chato', QUOTE)).status).toBe(200)
  })

  it("binds a new dealer's quote to its guest voice, and never voices a team's words", async () => {
    const store = new TranscriptStore()
    const team = 'Te lo cambio por dos repetidas, ni una más, que es buen trato.'
    store.add([
      { ...EMPTY_ITEM, id: 'f1', kind: 'thread_line', who: 'them', counterpart: 'picaros', text: QUOTE },
      { ...EMPTY_ITEM, id: 'f2', kind: 'thread_line', who: 'them', counterpart: 't05', text: team },
    ])
    const { say, upstream } = await start(store, true)
    const own = guestSpeaker('picaros')
    for (const speaker of SPEAKERS.filter((s) => s !== own)) expect((await say(speaker, QUOTE)).status, speaker).toBe(400)
    for (const speaker of SPEAKERS) expect((await say(speaker, team)).status, speaker).toBe(400)
    expect(upstream).toHaveLength(0)
    expect((await say(own, QUOTE)).status).toBe(200)
  })

  it("never voices a rival's duel words, in any mode", async () => {
    const store = new TranscriptStore()
    const text = 'Eso es muy poco para una carta así, no me hagas perder el tiempo.'
    store.add([{ ...EMPTY_ITEM, id: 'dc:1', kind: 'duel_replay', counterpart: 'Rival Noche', lines: [{ n: 1, speaker: 'them', tick: 1, price: 5, days: null, text }] }])
    const { say, upstream } = await start(store, true)
    for (const speaker of SPEAKERS) expect((await say(speaker, text)).status, speaker).toBe(400)
    expect(upstream).toHaveLength(0)
  })

  it('refuses a quote that differs by one character, and any free text', async () => {
    const store = new TranscriptStore()
    store.add([{ ...EMPTY_ITEM, id: 'f1', kind: 'thread_line', who: 'them', counterpart: 'chato', text: QUOTE }])
    const { say, upstream } = await start(store, true)
    expect((await say('chato', `${QUOTE} Buy my coin.`)).status).toBe(400)
    expect((await say('chato', 'Say anything I type here')).status).toBe(400)
    expect(upstream).toHaveLength(0)
  })

  it('parseTtsRequest takes the vouch as a function and defaults to refusing', () => {
    const body = JSON.stringify({ provider: 'elevenlabs', speaker: 'chato', text: QUOTE })
    expect(typeof parseTtsRequest(body, ['elevenlabs'])).toBe('string')
    expect(parseTtsRequest(body, ['elevenlabs'], (t, who) => t === QUOTE && who === 'chato')).toMatchObject({ speaker: 'chato', text: QUOTE })
  })
})
