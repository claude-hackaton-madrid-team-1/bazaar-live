/**
 * GET /api/transcript?since=<cursor>&epoch=<epoch>     JSON: the recent history, or what is newer
 * GET /api/transcript/stream?since=<cursor>&epoch=...   SSE: the same, then each new batch as it arrives
 *
 * Public and read-only: they carry only items the poller built from the two views (clean text, closed
 * vocabularies). A per-address rate limit on the JSON route, a cap on open streams (per address and
 * in all), a heartbeat so a proxy does not cut an idle stream, and a drop for any client that stops reading.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TranscriptBatch, TranscriptItem } from '../../shared/transcript.ts'
import { RateLimiter } from '../limits.ts'
import type { TranscriptStore } from './store.ts'

export interface TranscriptRouteDeps {
  readonly store: TranscriptStore
  /** True while a poller feeds the store (SHOW_DATABASE_URL is set and valid). */
  readonly enabled: () => boolean
  readonly headers: Readonly<Record<string, string>>
  readonly address: (req: IncomingMessage) => string
  readonly limiter?: RateLimiter
  readonly maxStreams?: number
  readonly maxPerAddress?: number
  readonly heartbeatMs?: number
  /** A client that has this many bytes waiting is not reading: drop it. */
  readonly maxQueuedBytes?: number
  readonly log?: (entry: Record<string, unknown>) => void
}

const BATCH_LIMIT = 100

function json(res: ServerResponse, headers: Readonly<Record<string, string>>, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}

/** A cursor from the query or Last-Event-ID: a non-negative safe integer, else null. */
function parseCursor(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

export function createTranscriptRoutes(deps: TranscriptRouteDeps): (req: IncomingMessage, res: ServerResponse, path: string) => boolean {
  const { store } = deps
  const limiter = deps.limiter ?? new RateLimiter({ capacity: 30, refillPerSecond: 1 })
  const maxStreams = deps.maxStreams ?? 100
  const maxPerAddress = deps.maxPerAddress ?? 4
  const heartbeatMs = deps.heartbeatMs ?? 15_000
  const maxQueued = deps.maxQueuedBytes ?? 256 * 1024
  const perAddress = new Map<string, number>()
  let open = 0

  /** The batch for a request: items after the cursor when it is this epoch's, else the recent history. */
  function batchFor(url: URL, req: IncomingMessage): TranscriptBatch {
    const epochOk = (url.searchParams.get('epoch') ?? store.epoch) === store.epoch
    const header = req.headers['last-event-id']
    const cursor = epochOk ? parseCursor(url.searchParams.get('since') ?? (Array.isArray(header) ? header[0] : header)) : null
    const known = cursor !== null && cursor <= store.cursor
    const items = deps.enabled() ? store.since(known ? cursor : null, BATCH_LIMIT) : []
    return { epoch: store.epoch, cursor: store.cursor, enabled: deps.enabled(), replay: !known, items }
  }

  function snapshot(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const taken = limiter.take(deps.address(req))
    if (!taken.ok) return json(res, deps.headers, 429, { error: 'rate_limited' }, { 'Retry-After': String(taken.retryAfterSeconds) })
    json(res, deps.headers, 200, batchFor(url, req))
  }

  function stream(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!deps.enabled()) return json(res, deps.headers, 404, { error: 'transcript_off' })
    const address = deps.address(req)
    if (open >= maxStreams || (perAddress.get(address) ?? 0) >= maxPerAddress) {
      return json(res, deps.headers, 429, { error: 'too_many_streams' }, { 'Retry-After': '10' })
    }
    open += 1
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1)
    res.writeHead(200, {
      ...deps.headers,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('retry: 3000\n\n')

    const send = (batch: TranscriptBatch): void => {
      if (res.writableLength > maxQueued) return end()
      res.write(`id: ${batch.cursor}\nevent: items\ndata: ${JSON.stringify(batch)}\n\n`)
    }
    const first = batchFor(url, req)
    send(first)
    const off = store.subscribe((items: readonly TranscriptItem[]) => {
      send({ epoch: store.epoch, cursor: store.cursor, enabled: true, replay: false, items: items.slice(-BATCH_LIMIT) })
    })
    const beat = setInterval(() => res.write(': hb\n\n'), heartbeatMs)
    let ended = false
    function end(): void {
      if (ended) return
      ended = true
      clearInterval(beat)
      off()
      open -= 1
      const left = (perAddress.get(address) ?? 1) - 1
      if (left <= 0) perAddress.delete(address)
      else perAddress.set(address, left)
      res.end()
    }
    req.on('close', end)
    res.on('close', end)
    res.on('error', end)
  }

  return (req, res, path) => {
    if (path !== '/api/transcript' && path !== '/api/transcript/stream') return false
    if (req.method !== 'GET') {
      json(res, deps.headers, 405, { error: 'method_not_allowed' }, { Allow: 'GET' })
      return true
    }
    const url = new URL(req.url ?? '/', 'http://local')
    if (path === '/api/transcript') snapshot(req, res, url)
    else stream(req, res, url)
    return true
  }
}
