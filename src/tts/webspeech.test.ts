import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebSpeech } from './webspeech'

interface FakeVoice { readonly lang: string; readonly localService: boolean; readonly name: string }

function stub(voices: FakeVoice[]) {
  const spoken: { text: string; lang: string }[] = []
  class Utter {
    text: string
    lang = ''
    voice: FakeVoice | null = null
    pitch = 1
    rate = 1
    onend: (() => void) | null = null
    onerror: ((e: { error: string }) => void) | null = null
    constructor(text: string) {
      this.text = text
    }
  }
  const synth = {
    getVoices: () => voices,
    cancel: () => undefined,
    speak: (u: Utter) => {
      spoken.push({ text: u.text, lang: u.voice?.lang ?? u.lang })
      u.onend?.()
    },
  }
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal('SpeechSynthesisUtterance', Utter)
  return spoken
}

afterEach(() => vi.unstubAllGlobals())
const signal = () => new AbortController().signal

describe('Web Speech and a line that names its language', () => {
  it('reads it with a voice of that language', async () => {
    const spoken = stub([{ lang: 'en-GB', localService: true, name: 'a' }, { lang: 'es-ES', localService: true, name: 'b' }])
    await createWebSpeech().speak({ id: '1', speaker: 'buyer', text: 'Ofrezco 24 primas.', lang: 'es' }, signal())
    expect(spoken).toEqual([{ text: 'Ofrezco 24 primas.', lang: 'es-ES' }])
  })

  it('stays quiet rather than read it in another language when the browser has no such voice', async () => {
    const spoken = stub([{ lang: 'en-GB', localService: true, name: 'a' }])
    await createWebSpeech().speak({ id: '1', speaker: 'chato', text: 'Ofrezco 24 primas.', lang: 'es' }, signal())
    expect(spoken).toEqual([])
  })

  it('keeps the old behaviour for a show template, which names no language (English fallback)', async () => {
    const spoken = stub([{ lang: 'en-GB', localService: true, name: 'a' }])
    await createWebSpeech().speak({ id: '1', speaker: 'chato', text: '¡Trato hecho!' }, signal())
    expect(spoken).toHaveLength(1)
  })
})
