import { describe, expect, it } from 'vitest'
import type { Lang } from '../../shared/lang.ts'
import { PACKS, fill, NO_VALUES } from '../../shared/lines.ts'
import { speakable, type Speaker } from '../../shared/tags.ts'
import type { Utterance } from './types'
import type { VoiceLike } from './voices'
import { createVoiceBook, createWebSpeech, paramsFor, type Synth, type WebUtterance } from './webspeech'

const u = (speaker: Speaker, text: string, lang: Lang = 'es'): Utterance => ({ id: 'x', speaker, lang, text })

describe('paramsFor: tags become delivery, never words', () => {
  it('reads the words alone and tags the language (es-ES / en-GB)', () => {
    expect(paramsFor(u('buyer', '[excited] ¡Me la llevo!'))).toMatchObject({ text: '¡Me la llevo!', lang: 'es-ES' })
    expect(paramsFor(u('buyer', '[sarcastic] Sure.', 'en'))).toMatchObject({ text: 'Sure.', lang: 'en-GB' })
  })

  it('maps tags to rate, pitch and volume', () => {
    const plain = paramsFor(u('seller', 'Hola.'))
    const excited = paramsFor(u('seller', '[excited] Hola.'))
    const whisper = paramsFor(u('seller', '[whispers] Hola.'))
    const sigh = paramsFor(u('seller', '[sighs] Hola.'))
    expect(excited.pitch).toBeGreaterThan(plain.pitch)
    expect(whisper.volume).toBeLessThan(plain.volume)
    expect(sigh.rate).toBeLessThan(plain.rate)
  })

  it('gives every character its own rate and pitch, and Spanish a faster base', () => {
    const speakers: Speaker[] = ['buyer', 'seller', 'abuela', 'chato', 'narrator']
    const pitches = speakers.map((s) => paramsFor(u(s, 'Hola.')).pitch)
    expect(new Set(pitches).size).toBe(pitches.length)
    expect(paramsFor(u('abuela', 'Hola.')).pitch).toBeGreaterThan(paramsFor(u('chato', 'Hola.')).pitch)
    expect(paramsFor(u('seller', 'Hola.', 'es')).rate).toBeGreaterThan(paramsFor(u('seller', 'Hola.', 'en')).rate)
  })

  it('stays inside what a browser accepts', () => {
    for (const s of ['buyer', 'seller', 'abuela', 'chato', 'narrator'] as const) {
      const p = paramsFor(u(s, '[excited] [laughs] [gasps] ¡Ja!'))
      expect(p.rate).toBeGreaterThanOrEqual(0.1)
      expect(p.rate).toBeLessThanOrEqual(10)
      expect(p.pitch).toBeGreaterThanOrEqual(0)
      expect(p.pitch).toBeLessThanOrEqual(2)
      expect(p.volume).toBeLessThanOrEqual(1)
    }
  })

  it('no line of either pack is ever read with a bracket in it', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const bank of Object.values(PACKS[lang])) {
        for (const variant of bank) {
          for (const [, text] of variant.lines) {
            const said = paramsFor(u('buyer', fill(text, { ...NO_VALUES }), lang)).text
            expect(said, text).not.toMatch(/[[\]<>]/)
            expect(said).toBe(speakable(text))
          }
        }
      }
    }
  })
})

function fakeSynth(voices: VoiceLike[]) {
  const spoken: WebUtterance<VoiceLike>[] = []
  let cancelled = 0
  const listeners: (() => void)[] = []
  const synth: Synth<VoiceLike> & { voices: VoiceLike[] } = {
    voices,
    getVoices: () => synth.voices,
    speak: (utterance) => {
      const x = utterance as WebUtterance<VoiceLike>
      spoken.push(x)
      queueMicrotask(() => x.onend?.())
    },
    cancel: () => void (cancelled += 1),
    addEventListener: (_t, l) => void listeners.push(l),
  }
  const makeUtterance = (text: string): WebUtterance<VoiceLike> & { text: string } => ({ text, voice: null, lang: '', rate: 1, pitch: 1, volume: 1, onend: null, onerror: null })
  return { synth, spoken, makeUtterance, cancelled: () => cancelled, fire: () => listeners.forEach((l) => l()) }
}

describe('createWebSpeech', () => {
  const es = [{ name: 'Mónica', lang: 'es-ES', localService: true }, { name: 'Jorge', lang: 'es-ES', localService: true }, { name: 'Samantha', lang: 'en-US', localService: true }]

  it('speaks the words with a native voice, the language tag and the delivery', async () => {
    const f = fakeSynth(es)
    const provider = createWebSpeech({ synth: f.synth, makeUtterance: f.makeUtterance })
    await provider.speak(u('abuela', '[sighs] Ay, cariño.'), new AbortController().signal)
    const spoken = f.spoken[0] as unknown as { text: string; voice: VoiceLike; lang: string; rate: number; volume: number }
    expect(spoken.text).toBe('Ay, cariño.')
    expect(spoken.voice.name).toBe('Mónica')
    expect(spoken.lang).toBe('es-ES')
    expect(spoken.volume).toBeLessThan(1)
  })

  it('uses the language tag alone when the browser has no voice for it', async () => {
    const f = fakeSynth([{ name: 'Samantha', lang: 'en-US', localService: true }])
    await createWebSpeech({ synth: f.synth, makeUtterance: f.makeUtterance }).speak(u('buyer', 'Hola.'), new AbortController().signal)
    const spoken = f.spoken[0] as unknown as { voice: VoiceLike | null; lang: string }
    expect(spoken.voice).toBeNull()
    expect(spoken.lang).toBe('es-ES')
  })

  it('says nothing for a line that is only tags', async () => {
    const f = fakeSynth(es)
    await createWebSpeech({ synth: f.synth, makeUtterance: f.makeUtterance }).speak(u('buyer', '[sighs]'), new AbortController().signal)
    expect(f.spoken).toEqual([])
  })

  it('cancels on abort, and treats interrupted/canceled as ours (not a failure)', async () => {
    const f = fakeSynth(es)
    f.synth.speak = (utterance) => void f.spoken.push(utterance as WebUtterance<VoiceLike>)
    const provider = createWebSpeech({ synth: f.synth, makeUtterance: f.makeUtterance })
    const controller = new AbortController()
    const pending = provider.speak(u('buyer', 'Hola.'), controller.signal)
    controller.abort()
    await pending
    expect(f.cancelled()).toBe(1)
    const second = provider.speak(u('buyer', 'Adiós.'), new AbortController().signal)
    f.spoken[1]?.onerror?.({ error: 'interrupted' })
    await expect(second).resolves.toBeUndefined()
    const third = provider.speak(u('buyer', 'Otra.'), new AbortController().signal)
    f.spoken[2]?.onerror?.({ error: 'synthesis-failed' })
    await expect(third).rejects.toThrow('synthesis-failed')
  })

  it('prefetch warms the voices without speaking', () => {
    const f = fakeSynth(es)
    createWebSpeech({ synth: f.synth, makeUtterance: f.makeUtterance }).prefetch?.(u('buyer', 'Hola.'))
    expect(f.spoken).toEqual([])
  })
})

describe('createVoiceBook: Chrome loads its voices late', () => {
  it('does not remember an empty list, and refreshes when the browser says voices changed', () => {
    const f = fakeSynth([])
    const book = createVoiceBook(f.synth)
    expect(book('es').buyer).toBeNull()
    f.synth.voices = [{ name: 'Mónica', lang: 'es-ES', localService: true }]
    expect(book('es').buyer?.name).toBe('Mónica')
    f.synth.voices = [{ name: 'Mónica', lang: 'es-ES', localService: true }, { name: 'Jorge', lang: 'es-ES', localService: true }]
    f.fire()
    expect(book('es').chato?.name).toBe('Jorge')
  })

  it('remembers the voices per language', () => {
    const f = fakeSynth([{ name: 'Mónica', lang: 'es-ES' }, { name: 'Daniel', lang: 'en-GB' }])
    const book = createVoiceBook(f.synth)
    expect(book('es')).toBe(book('es'))
    expect(book('en').seller?.name).toBe('Daniel')
  })
})
