import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemote, unlockAudio } from './remote'

/** A stand-in for <audio>: play() stays pending until the test settles it. */
class FakeAudio {
  static last: FakeAudio | null = null
  src = ''
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  plays: { resolve: () => void; reject: (e: Error) => void }[] = []
  constructor() {
    FakeAudio.last = this
  }
  play(): Promise<void> {
    return new Promise<void>((resolve, reject) => void this.plays.push({ resolve, reject }))
  }
  pause(): void {}
}

const fetchOk = (async () => new Response(new Blob(['mp3']), { status: 200 })) as unknown as typeof fetch
const u = (id: string) => ({ id, speaker: 'buyer' as const, lang: 'es' as const, text: `Línea ${id}.` })

afterEach(() => vi.unstubAllGlobals())

describe('the shared <audio> element', () => {
  it('serves every line, and a late AbortError of an aborted line does not clear the next line\'s handlers', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    unlockAudio() // the click that starts the show: one element for every line
    const audio = FakeAudio.last!
    const remote = createRemote('elevenlabs', { fetchImpl: fetchOk })
    const first = new AbortController()
    const a = remote.speak(u('a'), first.signal)
    await vi.waitFor(() => expect(audio.plays.length).toBe(2)) // the unlock's silent clip, then line a
    first.abort()
    await a
    // The next line takes the element over before the aborted line's play() rejects.
    const b = remote.speak(u('b'), new AbortController().signal)
    await vi.waitFor(() => expect(audio.plays.length).toBe(3))
    const handler = audio.onended
    expect(handler).not.toBeNull()
    audio.plays[1]?.reject(Object.assign(new Error('The play() request was interrupted'), { name: 'AbortError' }))
    await new Promise((r) => setTimeout(r, 5))
    expect(audio.onended).toBe(handler) // still b's
    audio.onended?.()
    await expect(b).resolves.toBeUndefined()
  })

  it('a refused play() (no tap yet) fails the line instead of hanging', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined })
    const remote = createRemote('elevenlabs', { fetchImpl: fetchOk })
    const audio = FakeAudio.last ?? new FakeAudio() // the element the previous test left shared
    const before = audio.plays.length
    const speaking = remote.speak(u('c'), new AbortController().signal)
    await vi.waitFor(() => expect(audio.plays.length).toBe(before + 1))
    audio.plays[before]?.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }))
    await expect(speaking).rejects.toThrow('not allowed')
  })
})
