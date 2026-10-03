/**
 * The browser's own voices (Web Speech API): free, keyless, always there. They cannot act, so tags
 * are stripped; each character gets its own pitch and rate, and the dealers get a Spanish voice when
 * the browser has one (English read with a Madrid accent is half the joke).
 */
import { stripTags, type Speaker } from '../../shared/tags.ts'
import type { SpeechProvider, Utterance } from './types'

interface Voicing {
  readonly pitch: number
  readonly rate: number
  readonly lang: 'en' | 'es'
  /** Which of the matching voices, so the two leads do not share one. */
  readonly slot: number
}

const VOICING: Readonly<Record<Speaker, Voicing>> = {
  buyer: { pitch: 1.15, rate: 1.06, lang: 'en', slot: 0 },
  seller: { pitch: 0.85, rate: 1.0, lang: 'en', slot: 1 },
  abuela: { pitch: 1.35, rate: 0.92, lang: 'es', slot: 0 },
  chato: { pitch: 0.6, rate: 0.96, lang: 'es', slot: 1 },
  narrator: { pitch: 1.0, rate: 1.0, lang: 'en', slot: 2 },
}

export function webSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

function voicesFor(lang: 'en' | 'es'): SpeechSynthesisVoice[] {
  const all = window.speechSynthesis.getVoices()
  const matching = all.filter((v) => v.lang.toLowerCase().startsWith(lang))
  // Local voices first: they start faster and do not need the network.
  return [...matching.filter((v) => v.localService), ...matching.filter((v) => !v.localService)]
}

function pickVoice(voicing: Voicing): SpeechSynthesisVoice | null {
  const own = voicesFor(voicing.lang)
  const pool = own.length > 0 ? own : voicesFor('en')
  return pool.length > 0 ? (pool[voicing.slot % pool.length] ?? null) : null
}

/** Some browsers (Safari) only allow speech that starts inside a click: prime it there. */
export function unlockWebSpeech(): void {
  if (!webSpeechAvailable()) return
  const primer = new SpeechSynthesisUtterance(' ')
  primer.volume = 0
  window.speechSynthesis.speak(primer)
}

export function createWebSpeech(): SpeechProvider {
  return {
    name: 'webspeech',
    speak(u: Utterance, signal: AbortSignal): Promise<void> {
      if (!webSpeechAvailable()) return Promise.reject(new Error('Web Speech is not available'))
      const words = stripTags(u.text)
      if (!words) return Promise.resolve()
      const synth = window.speechSynthesis
      return new Promise<void>((resolve, reject) => {
        const voicing = VOICING[u.speaker]
        const utter = new SpeechSynthesisUtterance(words)
        const voice = pickVoice(voicing)
        if (voice) {
          utter.voice = voice
          utter.lang = voice.lang
        }
        utter.pitch = voicing.pitch
        utter.rate = voicing.rate
        utter.onend = () => resolve()
        utter.onerror = (e) => {
          // `interrupted` / `canceled` are ours (mute, skip): not a failure.
          if (e.error === 'interrupted' || e.error === 'canceled') resolve()
          else reject(new Error(`speechSynthesis: ${e.error}`))
        }
        signal.addEventListener(
          'abort',
          () => {
            synth.cancel()
            resolve()
          },
          { once: true },
        )
        synth.speak(utter)
      })
    },
  }
}
