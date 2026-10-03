import { describe, expect, it } from 'vitest'
import type { SourceLike } from '../net/transcript'
import { createWsSource, gameTransport, splitFrame, transportOf, wsUrlOf, type WsLike } from './wsSource.ts'

/** A socket the test drives by hand. */
class FakeWs implements WsLike {
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  closed = false
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  close(): void {
    this.closed = true
  }
}

function fakeSource() {
  const made: FakeWs[] = []
  const location = { protocol: 'https:', host: 'live.example' }
  const make = (url: string) => createWsSource(url, { location, create: (u) => { const ws = new FakeWs(u); made.push(ws); return ws } })
  return { made, make }
}

describe('wsUrlOf', () => {
  it('turns the SSE path into the socket path, wss on https, ws on http, keeping the token', () => {
    expect(wsUrlOf('/api/game/stream?token=GAME_VIEW_TOKEN.', { protocol: 'https:', host: 'live.example' })).toBe('wss://live.example/api/game/ws?token=GAME_VIEW_TOKEN.')
    expect(wsUrlOf('/api/game/stream', { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/api/game/ws')
  })
})

describe('splitFrame', () => {
  it('splits at the first newline only (the data is JSON and may hold more)', () => {
    expect(splitFrame('events\n[{"id":1,"type":"x","payload":{"t":"a\\nb"}}]')).toEqual({ event: 'events', data: '[{"id":1,"type":"x","payload":{"t":"a\\nb"}}]' })
    expect(splitFrame('hb\n1')).toEqual({ event: 'hb', data: '1' })
    expect(splitFrame('hb')).toEqual({ event: 'hb', data: '' })
  })
})

describe('createWsSource', () => {
  it('opens the socket URL, hands each frame to its event listeners, and ignores binary frames', () => {
    const { made, make } = fakeSource()
    const source = make('/api/game/stream?token=t')
    const events: unknown[] = []
    const beats: unknown[] = []
    let opened = 0
    source.onopen = () => (opened += 1)
    source.addEventListener('events', (ev) => events.push(ev.data))
    source.addEventListener('hb', (ev) => beats.push(ev.data))
    const ws = made[0] as FakeWs
    expect(ws.url).toBe('wss://live.example/api/game/ws?token=t')
    ws.onopen?.({})
    ws.onmessage?.({ data: 'events\n[]' })
    ws.onmessage?.({ data: 'hb\n1' })
    ws.onmessage?.({ data: new ArrayBuffer(2) })
    expect(opened).toBe(1)
    expect(events).toEqual(['[]'])
    expect(beats).toEqual(['1'])
  })

  it('reports an error then a close only once, and nothing after close()', () => {
    const { made, make } = fakeSource()
    const source = make('/api/game/stream')
    let errors = 0
    source.onerror = () => (errors += 1)
    const ws = made[0] as FakeWs
    ws.onerror?.({})
    ws.onclose?.({})
    expect(errors).toBe(1)

    const other = make('/api/game/stream')
    let late = 0
    other.onerror = () => (late += 1)
    other.close()
    expect((made[1] as FakeWs).closed).toBe(true)
    made[1]?.onclose?.({})
    made[1]?.onmessage?.({ data: 'events\n[]' })
    expect(late).toBe(0)
  })
})

/** A stand-in source whose open or failure the test triggers. */
function stub(kind: 'ws' | 'sse', made: { kind: string; source: SourceLike }[]) {
  return () => {
    const source: SourceLike = { onopen: null, onerror: null, addEventListener: () => undefined, close: () => undefined }
    made.push({ kind, source })
    return source
  }
}

describe('gameTransport', () => {
  it('uses the WebSocket, tells which transport opened, and passes the open on to the feed', () => {
    const made: { kind: string; source: SourceLike }[] = []
    const told: string[] = []
    const create = gameTransport({ prefer: 'ws', ws: stub('ws', made), sse: stub('sse', made), onTransport: (t) => told.push(t) })
    const outer = create('/api/game/stream')
    let opened = 0
    outer.onopen = () => (opened += 1)
    made[0]?.source.onopen?.({})
    expect(made.map((m) => m.kind)).toEqual(['ws'])
    expect(told).toEqual(['ws'])
    expect(opened).toBe(1)
  })

  it('falls back to the EventSource after sockets in a row that never opened', () => {
    const made: { kind: string; source: SourceLike }[] = []
    const create = gameTransport({ prefer: 'ws', maxFailures: 2, ws: stub('ws', made), sse: stub('sse', made) })
    for (let i = 0; i < 3; i++) {
      const outer = create('/api/game/stream')
      let errors = 0
      outer.onerror = () => (errors += 1)
      made[i]?.source.onerror?.({})
      expect(errors).toBe(1)
    }
    expect(made.map((m) => m.kind)).toEqual(['ws', 'ws', 'sse'])
  })

  it('does not count a socket that opened and dropped later, and honours ?transport=sse', () => {
    const made: { kind: string; source: SourceLike }[] = []
    const create = gameTransport({ prefer: 'ws', maxFailures: 1, ws: stub('ws', made), sse: stub('sse', made) })
    create('/api/game/stream')
    made[0]?.source.onopen?.({})
    made[0]?.source.onerror?.({})
    create('/api/game/stream')
    expect(made.map((m) => m.kind)).toEqual(['ws', 'ws'])

    const sseMade: { kind: string; source: SourceLike }[] = []
    gameTransport({ prefer: 'sse', ws: stub('ws', sseMade), sse: stub('sse', sseMade) })('/api/game/stream')
    expect(sseMade.map((m) => m.kind)).toEqual(['sse'])
  })
})

describe('transportOf', () => {
  it('is the WebSocket unless the page asks for sse', () => {
    expect(transportOf('')).toBe('ws')
    expect(transportOf('?token=x')).toBe('ws')
    expect(transportOf('?transport=sse&token=x')).toBe('sse')
    expect(transportOf('?transport=bogus')).toBe('ws')
  })
})
