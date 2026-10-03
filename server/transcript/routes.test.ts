import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_ITEM, type Draft, type TranscriptBatch } from '../../shared/transcript.ts'
import { createApp } from '../app.ts'
import { RateLimiter } from '../limits.ts'
import { readProviderConfig } from '../providers.ts'
import { TranscriptStore } from './store.ts'
import { createTranscriptRoutes } from './routes.ts'

const servers: Server[] = []
afterEach(() => servers.splice(0).forEach((s) => { s.closeAllConnections(); s.close() }))

const draft = (id: string, extra: Partial<Draft> = {}): Draft => ({ ...EMPTY_ITEM, id, who: 'them', text: `line ${id}`, ...extra })

async function start(opts: { enabled?: boolean; store?: TranscriptStore; limiter?: RateLimiter; maxPerAddress?: number; maxStreams?: number; heartbeatMs?: number } = {}) {
  const store = opts.store ?? new TranscriptStore()
  const app = createApp({
    config: readProviderConfig({}), distDir: '/nonexistent', log: () => undefined,
    transcript: { store, enabled: () => opts.enabled ?? true, limiter: opts.limiter, maxPerAddress: opts.maxPerAddress, maxStreams: opts.maxStreams, heartbeatMs: opts.heartbeatMs },
  })
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store }
}

/** Reads SSE events until `count` data events arrived (or the stream ends). */
async function readEvents(res: Response, count: number): Promise<{ id: string | null; data: TranscriptBatch }[]> {
  const reader = res.body?.getReader()
  const out: { id: string | null; data: TranscriptBatch }[] = []
  let buffer = ''
  const decoder = new TextDecoder()
  while (reader && out.length < count) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let at = buffer.indexOf('\n\n')
    while (at >= 0) {
      const block = buffer.slice(0, at)
      buffer = buffer.slice(at + 2)
      const data = block.split('\n').find((l) => l.startsWith('data: '))
      const id = block.split('\n').find((l) => l.startsWith('id: '))
      if (data) out.push({ id: id ? id.slice(4) : null, data: JSON.parse(data.slice(6)) as TranscriptBatch })
      at = buffer.indexOf('\n\n')
    }
  }
  void reader?.cancel()
  return out
}

describe('GET /api/transcript', () => {
  it('says the feature is off, and still answers 200, when there is no database', async () => {
    const { base } = await start({ enabled: false })
    const res = await fetch(`${base}/api/transcript`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ enabled: false, items: [], cursor: 0 })
  })

  it('returns the recent history, then only what is newer than the cursor', async () => {
    const { base, store } = await start()
    store.add([draft('a'), draft('b')])
    const first = (await (await fetch(`${base}/api/transcript`)).json()) as TranscriptBatch
    expect(first).toMatchObject({ enabled: true, replay: true, cursor: 2, epoch: store.epoch })
    expect(first.items.map((i) => i.id)).toEqual(['a', 'b'])
    store.add([draft('c')])
    const next = (await (await fetch(`${base}/api/transcript?since=2&epoch=${store.epoch}`)).json()) as TranscriptBatch
    expect(next).toMatchObject({ replay: false, cursor: 3 })
    expect(next.items.map((i) => i.id)).toEqual(['c'])
  })

  it('ignores a cursor from another epoch or a malformed one', async () => {
    const { base, store } = await start()
    store.add([draft('a')])
    for (const q of ['since=1&epoch=other', 'since=-3', 'since=abc', 'since=1e9']) {
      const body = (await (await fetch(`${base}/api/transcript?${q}`)).json()) as TranscriptBatch
      expect(body.items.map((i) => i.id)).toEqual(['a'])
      expect(body.replay).toBe(true)
    }
  })

  it('carries the security headers, never caches, and refuses other methods', async () => {
    const { base } = await start()
    const res = await fetch(`${base}/api/transcript`)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('cache-control')).toBe('no-store')
    const post = await fetch(`${base}/api/transcript`, { method: 'POST' })
    expect(post.status).toBe(405)
  })

  it('is rate limited per address', async () => {
    const { base } = await start({ limiter: new RateLimiter({ capacity: 2, refillPerSecond: 0.001 }) })
    const codes = [] as number[]
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/api/transcript`)).status)
    expect(codes).toEqual([200, 200, 429, 429])
  })
})

describe('GET /api/transcript/stream', () => {
  it('sends history first, then each new batch with its cursor as the event id', async () => {
    const { base, store } = await start()
    store.add([draft('a')])
    const res = await fetch(`${base}/api/transcript/stream`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    const pending = readEvents(res, 2)
    await new Promise((r) => setTimeout(r, 30))
    store.add([draft('b'), draft('c')])
    const events = await pending
    expect(events[0]?.data).toMatchObject({ replay: true, enabled: true })
    expect(events[0]?.data.items.map((i) => i.id)).toEqual(['a'])
    expect(events[1]?.data.replay).toBe(false)
    expect(events[1]?.data.items.map((i) => i.id)).toEqual(['b', 'c'])
    expect(events[1]?.id).toBe('3')
  })

  it('resumes from ?since= without replaying history', async () => {
    const { base, store } = await start()
    store.add([draft('a'), draft('b')])
    const res = await fetch(`${base}/api/transcript/stream?since=1&epoch=${store.epoch}`)
    const [first] = await readEvents(res, 1)
    expect(first?.data.replay).toBe(false)
    expect(first?.data.items.map((i) => i.id)).toEqual(['b'])
  })

  it('answers 404 when the feature is off', async () => {
    const { base } = await start({ enabled: false })
    expect((await fetch(`${base}/api/transcript/stream`)).status).toBe(404)
  })

  it('caps streams per address and in all, and frees a slot when one closes', async () => {
    const { base } = await start({ maxPerAddress: 2, maxStreams: 5 })
    const a = await fetch(`${base}/api/transcript/stream`)
    const b = await fetch(`${base}/api/transcript/stream`)
    const c = await fetch(`${base}/api/transcript/stream`)
    expect([a.status, b.status, c.status]).toEqual([200, 200, 429])
    await a.body?.cancel()
    await new Promise((r) => setTimeout(r, 50))
    const d = await fetch(`${base}/api/transcript/stream`)
    expect(d.status).toBe(200)
    await b.body?.cancel()
    await d.body?.cancel()
  })

  it('keeps the connection alive with comments', async () => {
    const { base } = await start({ heartbeatMs: 20 })
    const res = await fetch(`${base}/api/transcript/stream`)
    const reader = res.body?.getReader()
    let text = ''
    const decoder = new TextDecoder()
    for (let i = 0; i < 6 && !text.includes(': hb'); i++) {
      const { value } = (await reader?.read()) ?? {}
      if (value) text += decoder.decode(value)
    }
    expect(text).toContain(': hb')
    await reader?.cancel()
  })
})

describe('the route table', () => {
  it('exposes the handler on its own too', () => {
    expect(typeof createTranscriptRoutes).toBe('function')
  })
})
