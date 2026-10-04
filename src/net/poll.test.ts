import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollJson } from './poll'

interface Call {
  readonly url: string
  readonly init: RequestInit
  readonly settle: (answer: Response | Error) => void
}

let calls: Call[] = []

/** Each fetch waits until the test settles it; an abort rejects it the way the browser does. */
function fakeFetch(url: string, init: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    calls.push({ url, init, settle: (a) => (a instanceof Error ? reject(a) : resolve(a)) })
  })
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  calls = []
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('pollJson', () => {
  it('reads now and on the timer, with the cache mode, and hands over status and body', async () => {
    const answers: [number, unknown][] = []
    const stop = pollJson('/api/x', 1_000, 'no-cache', (status, body) => answers.push([status, body]))
    expect(calls.map((c) => [c.url, c.init.cache])).toEqual([['/api/x', 'no-cache']])
    calls[0]!.settle(new Response('{"enabled":true}', { status: 200 }))
    await flush()
    await vi.advanceTimersByTimeAsync(1_000)
    calls[1]!.settle(new Response('not json', { status: 502 }))
    await flush()
    expect(answers).toEqual([[200, { enabled: true }], [502, null]])
    stop()
  })

  it('a failed request answers status 0; a read cut short by the next one answers nothing', async () => {
    const answers: [number, unknown][] = []
    const stop = pollJson('/api/x', 1_000, 'no-store', (status, body) => answers.push([status, body]))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls[0]!.init.signal?.aborted).toBe(true)
    calls[1]!.settle(new TypeError('offline'))
    await flush()
    expect(answers).toEqual([[0, null]])
    stop()
  })

  it('stop aborts the read in flight, answers nothing more and reads no more', async () => {
    const answer = vi.fn()
    const stop = pollJson('/api/x', 1_000, 'no-store', answer)
    stop()
    expect(calls[0]!.init.signal?.aborted).toBe(true)
    calls[0]!.settle(new Response('{}', { status: 200 }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(calls).toHaveLength(1)
    expect(answer).not.toHaveBeenCalled()
  })
})
