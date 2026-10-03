/**
 * The game stream over a WebSocket, shaped like the EventSource that GameFeed drives (`SourceLike`), so the feed's
 * reconnects, watchdog and replay handling stay exactly as they are. The server's GET /api/game/ws sends one text
 * frame per message, `<event>\n<data>` (`events` with a JSON array, `hb` every 15 s): what /api/game/stream sends
 * as SSE. A socket that fails or closes reaches `onerror` once, as a dropped EventSource does, and GameFeed asks
 * /api/game again and reconnects with its backoff.
 *
 * `gameTransport` picks the socket: WebSocket by default, the EventSource with `?transport=sse`, and the EventSource
 * from then on after `maxFailures` sockets in a row that never opened (a proxy that cannot upgrade).
 */
import type { SourceLike } from '../net/transcript'

export type Transport = 'ws' | 'sse'

/** The part of the browser's WebSocket used here. */
export interface WsLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  close(): void
}

export interface WsSourceOptions {
  readonly create?: (url: string) => WsLike
  readonly location?: { readonly protocol: string; readonly host: string }
}

/** `/api/game/stream?token=…` → `wss://host/api/game/ws?token=…` (`ws://` on a page served over http). */
export function wsUrlOf(streamUrl: string, location: { readonly protocol: string; readonly host: string }): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(streamUrl, `${location.protocol}//${location.host}`)
  url.protocol = scheme
  url.pathname = url.pathname.replace(/\/stream$/, '/ws')
  return url.toString()
}

/** One frame: the event's name up to the first newline, the rest is its data. */
export function splitFrame(frame: string): { readonly event: string; readonly data: string } {
  const cut = frame.indexOf('\n')
  return cut < 0 ? { event: frame, data: '' } : { event: frame.slice(0, cut), data: frame.slice(cut + 1) }
}

export function createWsSource(streamUrl: string, options: WsSourceOptions = {}): SourceLike {
  const create = options.create ?? ((url: string) => new WebSocket(url) as unknown as WsLike)
  const location = options.location ?? window.location
  const listeners = new Map<string, ((ev: { data: unknown }) => void)[]>()
  let done = false
  const socket = create(wsUrlOf(streamUrl, location))
  const source: SourceLike = {
    onopen: null,
    onerror: null,
    addEventListener(type, listener) {
      const list = listeners.get(type)
      if (list) list.push(listener)
      else listeners.set(type, [listener])
    },
    close() {
      done = true
      socket.close()
    },
  }
  socket.onopen = (ev) => {
    if (!done) source.onopen?.(ev)
  }
  socket.onmessage = (ev) => {
    if (done || typeof ev.data !== 'string') return
    const { event, data } = splitFrame(ev.data)
    for (const listener of listeners.get(event) ?? []) listener({ data })
  }
  // An error is followed by a close: the feed hears about it once.
  const fail = (ev: unknown): void => {
    if (done) return
    done = true
    source.onerror?.(ev)
  }
  socket.onerror = fail
  socket.onclose = fail
  return source
}

export interface GameTransportOptions {
  /** What the page asked for: WebSocket unless `?transport=sse`. */
  readonly prefer: Transport
  /** Sockets in a row that fail before opening, then the EventSource for the rest of the visit. */
  readonly maxFailures?: number
  readonly ws?: (url: string) => SourceLike
  readonly sse?: (url: string) => SourceLike
  /** Told every time a stream opens, with the transport it uses. */
  readonly onTransport?: (transport: Transport) => void
}

/** A `createSource` for GameFeed: the WebSocket first, the EventSource when the page asks for it or sockets keep failing. */
export function gameTransport(options: GameTransportOptions): (url: string) => SourceLike {
  const maxFailures = options.maxFailures ?? 2
  const ws = options.ws ?? ((url: string) => createWsSource(url))
  const sse = options.sse ?? ((url: string) => new EventSource(url) as unknown as SourceLike)
  let failures = 0
  return (url) => {
    const transport: Transport = options.prefer === 'sse' || failures >= maxFailures ? 'sse' : 'ws'
    const inner = transport === 'ws' ? ws(url) : sse(url)
    let opened = false
    // A wrapper, so the feed's own handlers (set after this returns) still run, and the count sees the outcome.
    const outer: SourceLike = {
      onopen: null,
      onerror: null,
      addEventListener: (type, listener) => inner.addEventListener(type, listener),
      close: () => inner.close(),
    }
    inner.onopen = (ev) => {
      opened = true
      if (transport === 'ws') failures = 0
      options.onTransport?.(transport)
      outer.onopen?.(ev)
    }
    inner.onerror = (ev) => {
      if (transport === 'ws' && !opened) failures += 1
      outer.onerror?.(ev)
    }
    return outer
  }
}

/** `?transport=sse` asks for the EventSource; anything else (or nothing) is the WebSocket. */
export const transportOf = (search: string): Transport => (new URLSearchParams(search).get('transport') === 'sse' ? 'sse' : 'ws')
