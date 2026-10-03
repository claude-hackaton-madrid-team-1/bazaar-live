import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechQueue } from './queue'
import type { ProviderName, SpeechProvider, Utterance } from './types'

const line = (id: string, text = 'hola'): Utterance => ({ id, speaker: 'buyer', lang: 'es', text })

/** A provider whose lines last `ms` each; it records how many speak at once. */
function timedProvider(name: ProviderName, ms = 100, fail = false) {
  const log: string[] = []
  let active = 0
  let maxActive = 0
  const provider: SpeechProvider = {
    name,
    speak: (u, signal) =>
      new Promise<void>((resolve, reject) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        log.push(`start ${u.id}`)
        const timer = setTimeout(() => {
          active -= 1
          log.push(`end ${u.id}`)
          if (fail) reject(new Error(`${name} broke`))
          else resolve()
        }, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          active -= 1
          log.push(`abort ${u.id}`)
          resolve()
        })
      }),
  }
  return { provider, log, maxActive: () => maxActive }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SpeechQueue', () => {
  it('speaks one line at a time, in order', async () => {
    const p = timedProvider('webspeech')
    const q = new SpeechQueue({ provider: p.provider })
    const done = Promise.all([q.say(line('a')), q.say(line('b')), q.say(line('c'))])
    await vi.advanceTimersByTimeAsync(1000)
    await done
    expect(p.maxActive()).toBe(1)
    expect(p.log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('has no silence between lines: the next one starts the instant the last ends', async () => {
    const starts: Record<string, number> = {}
    const ends: Record<string, number> = {}
    const provider: SpeechProvider = {
      name: 'webspeech',
      speak: (u) =>
        new Promise<void>((resolve) => {
          starts[u.id] = Date.now()
          setTimeout(() => {
            ends[u.id] = Date.now()
            resolve()
          }, 120)
        }),
    }
    const q = new SpeechQueue({ provider })
    // The stage hands over the next line while the current one is still being said.
    const all = [q.say(line('a')), q.say(line('b')), q.say(line('c'))]
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.all(all)
    expect(starts.b).toBe(ends.a)
    expect(starts.c).toBe(ends.b)
  })

  it('never speaks a line of another language: it resolves unspoken, queued or not', async () => {
    const p = timedProvider('webspeech', 100)
    let current: 'es' | 'en' = 'es'
    const q = new SpeechQueue({ provider: p.provider, currentLang: () => current })
    const es = (id: string) => ({ ...line(id), lang: 'es' as const })
    const en = (id: string) => ({ ...line(id), lang: 'en' as const })
    const first = q.say(es('a'))
    const queued = q.say(es('b'))
    await vi.advanceTimersByTimeAsync(10)
    current = 'en' // the visitor switched while "a" was being said and "b" waited
    q.clear()
    await Promise.all([first, queued])
    expect(p.log).toEqual(['start a', 'abort a'])
    await q.say(es('c')) // an old-language line arriving late is dropped
    const fresh = q.say(en('d'))
    await vi.advanceTimersByTimeAsync(200)
    await fresh
    expect(p.log).toEqual(['start a', 'abort a', 'start d', 'end d'])
    q.prefetch(es('e')) // and is not prefetched either
  })

  it('a line queued in the old language is skipped at its turn when the language changed behind it', async () => {
    const p = timedProvider('webspeech', 100)
    let current: 'es' | 'en' = 'es'
    const q = new SpeechQueue({ provider: p.provider, currentLang: () => current })
    const all = [q.say({ ...line('a'), lang: 'es' }), q.say({ ...line('b'), lang: 'es' })]
    await vi.advanceTimersByTimeAsync(10)
    current = 'en'
    await vi.advanceTimersByTimeAsync(500)
    await Promise.all(all)
    expect(p.log).toEqual(['start a', 'end a']) // "b" never started
  })

  it('mute stops the current line and resolves the waiting ones unspoken', async () => {
    const p = timedProvider('webspeech', 1000)
    const q = new SpeechQueue({ provider: p.provider })
    const results = [q.say(line('a')), q.say(line('b'))]
    await vi.advanceTimersByTimeAsync(10)
    q.setMuted(true)
    await Promise.all(results)
    expect(p.log).toEqual(['start a', 'abort a'])
    await q.say(line('c'))
    expect(p.log).not.toContain('start c')
    q.setMuted(false)
    const after = q.say(line('d'))
    await vi.advanceTimersByTimeAsync(1000)
    await after
    expect(p.log).toContain('end d')
  })

  it('falls back to the second provider when the first one fails', async () => {
    const broken = timedProvider('elevenlabs', 10, true)
    const local = timedProvider('webspeech', 10)
    const errors: string[] = []
    const q = new SpeechQueue({ provider: broken.provider, fallback: local.provider, onError: (_e, u, name) => errors.push(`${name}:${u.id}`) })
    const done = q.say(line('a'))
    await vi.advanceTimersByTimeAsync(100)
    await done
    expect(errors).toEqual(['elevenlabs:a'])
    expect(local.log).toEqual(['start a', 'end a'])
  })

  it('uses the fallback alone after repeated failures, then tries again after the cool-down', async () => {
    const broken = timedProvider('gemini', 10, true)
    const local = timedProvider('webspeech', 10)
    let now = 0
    const q = new SpeechQueue({ provider: broken.provider, fallback: local.provider, maxFailures: 2, coolDownMs: 60_000, now: () => now })
    for (const id of ['a', 'b']) {
      const p = q.say(line(id))
      await vi.advanceTimersByTimeAsync(100)
      await p
    }
    expect(q.providerName).toBe('webspeech')
    const c = q.say(line('c'))
    await vi.advanceTimersByTimeAsync(100)
    await c
    expect(broken.log).not.toContain('start c')
    now = 61_000
    expect(q.providerName).toBe('gemini')
  })

  it('ends a line that never reports its end (watchdog)', async () => {
    const hung: SpeechProvider = { name: 'webspeech', speak: () => new Promise<void>(() => undefined) }
    const q = new SpeechQueue({ provider: hung, timeoutMs: () => 500 })
    let finished = false
    void q.say(line('a')).then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(499)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(finished).toBe(true)
  })

  it('clear() drops the backlog', async () => {
    const p = timedProvider('webspeech', 1000)
    const q = new SpeechQueue({ provider: p.provider })
    const all = [q.say(line('a')), q.say(line('b')), q.say(line('c'))]
    await vi.advanceTimersByTimeAsync(10)
    expect(q.backlog).toBe(2)
    q.clear()
    await Promise.all(all)
    expect(p.log).toEqual(['start a', 'abort a'])
  })
})

describe('say() reports whether a line was really heard', () => {
  it('true for a finished line; false for a rejection, the watchdog, a mute, clear() and a stale language', async () => {
    const ok = timedProvider('webspeech', 50)
    const q = new SpeechQueue({ provider: ok.provider })
    const done = q.say(line('a'))
    await vi.advanceTimersByTimeAsync(100)
    expect(await done).toBe(true)

    const broken = timedProvider('elevenlabs', 10, true)
    const q2 = new SpeechQueue({ provider: broken.provider })
    const failed = q2.say(line('b'))
    await vi.advanceTimersByTimeAsync(100)
    expect(await failed).toBe(false)

    const hung: SpeechProvider = { name: 'webspeech', speak: () => new Promise<void>(() => undefined) }
    const q3 = new SpeechQueue({ provider: hung, timeoutMs: () => 500 })
    const slow = q3.say(line('c'))
    await vi.advanceTimersByTimeAsync(600)
    expect(await slow).toBe(false)

    const q4 = new SpeechQueue({ provider: timedProvider('webspeech', 1000).provider })
    const midLine = q4.say(line('d'))
    const waiting = q4.say(line('e'))
    await vi.advanceTimersByTimeAsync(10)
    q4.setMuted(true)
    expect(await midLine).toBe(false)
    expect(await waiting).toBe(false)
    expect(await q4.say(line('f'))).toBe(false)

    const q5 = new SpeechQueue({ provider: timedProvider('webspeech', 1000).provider })
    const cleared = q5.say(line('g'))
    await vi.advanceTimersByTimeAsync(10)
    q5.clear()
    expect(await cleared).toBe(false)

    const q6 = new SpeechQueue({ provider: timedProvider('webspeech', 50).provider, currentLang: () => 'en' })
    expect(await q6.say({ ...line('h'), lang: 'es' })).toBe(false)
  })
})
