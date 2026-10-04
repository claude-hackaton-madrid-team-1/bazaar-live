/**
 * The browser's own voices (Web Speech API): free, keyless, always there. They cannot act, so a tag
 * such as `[sighs]` is never read aloud: it becomes a little speed, pitch or volume (deliveryOf), and
 * what remains is the words alone (speakable).
 *
 * Every line is in one language, so each role speaks it with a native voice of that language (see
 * voices.ts) and the utterance carries the language tag (es-ES / en-GB). Each character has its own
 * rate and pitch, so two characters on one voice still sound like two people.
 */
import { LANG_TAG, type Lang } from '../../shared/lang.ts'
import { deliveryOf, speakable, type Speaker } from '../../shared/tags.ts'
import type { SpeechProvider, Utterance } from './types'
import { assignVoices, type VoiceLike, type VoiceMap } from './voices'

interface Voicing {
  readonly pitch: number
  readonly rate: number
}

/** Spanish is spoken faster than the engines' default, English is not. */
const BASE_RATE: Readonly<Record<Lang, number>> = { es: 1.05, en: 1 }

const VOICING: Readonly<Record<Speaker, Voicing>> = {
  buyer: { pitch: 1.12, rate: 1.06 },
  seller: { pitch: 0.88, rate: 1.0 },
  abuela: { pitch: 1.22, rate: 0.9 },
  chato: { pitch: 0.7, rate: 0.94 },
  pilar: { pitch: 1.05, rate: 0.86 },
  guest1: { pitch: 0.8, rate: 0.98 },
  guest2: { pitch: 1.32, rate: 1.12 },
  guest3: { pitch: 0.94, rate: 0.84 },
  narrator: { pitch: 1.0, rate: 1.0 },
  jev: { pitch: 0.95, rate: 0.94 },
}

const RATE_RANGE = [0.5, 1.8] as const
const PITCH_RANGE = [0.3, 2] as const
const clamp = (n: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, n))

export interface SpeechParams {
  readonly text: string
  readonly lang: string
  readonly rate: number
  readonly pitch: number
  readonly volume: number
}

/** What an utterance is spoken with: the words alone, the language, the character's voicing and the tags' delivery. */
export function paramsFor(u: Utterance): SpeechParams {
  const voicing = VOICING[u.speaker]
  const delivery = deliveryOf(u.text)
  return {
    text: speakable(u.text),
    lang: LANG_TAG[u.lang],
    rate: clamp(voicing.rate * BASE_RATE[u.lang] * delivery.rate, RATE_RANGE),
    pitch: clamp(voicing.pitch * delivery.pitch, PITCH_RANGE),
    volume: delivery.volume,
  }
}

/** The slice of the browser's speech synthesis the provider uses (so tests can pass a fake). */
export interface Synth<V extends VoiceLike = SpeechSynthesisVoice> {
  getVoices(): V[]
  speak(utterance: unknown): void
  cancel(): void
  addEventListener?(type: 'voiceschanged', listener: () => void): void
}

export interface WebSpeechDeps<V extends VoiceLike> {
  readonly synth: Synth<V>
  /** Builds an utterance object (the browser's `SpeechSynthesisUtterance` by default). */
  readonly makeUtterance: (text: string) => WebUtterance<V>
}

export interface WebUtterance<V extends VoiceLike> {
  voice: V | null
  lang: string
  rate: number
  pitch: number
  volume: number
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

export function webSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** True when the browser has at least one voice that can speak `lang` (es-*, en-*). */
export function hasVoiceFor(lang: Lang, synth: Pick<Synth, 'getVoices'> | null = webSpeechAvailable() ? (window.speechSynthesis as unknown as Synth) : null): boolean {
  return synth !== null && Object.values(assignVoices(synth.getVoices(), lang)).some((v) => v !== null)
}

/** Some browsers (Safari) only allow speech that starts inside a click: prime it there. */
export function unlockWebSpeech(): void {
  if (!webSpeechAvailable()) return
  const primer = new SpeechSynthesisUtterance(' ')
  primer.volume = 0
  window.speechSynthesis.speak(primer)
}

/** The voices per language, remembered until the browser says its list changed (Chrome loads it late). */
export function createVoiceBook<V extends VoiceLike>(synth: Pick<Synth<V>, 'getVoices' | 'addEventListener'>): (lang: Lang) => VoiceMap<V> {
  let cache = new Map<Lang, VoiceMap<V>>()
  let seen = -1
  synth.addEventListener?.('voiceschanged', () => {
    cache = new Map()
    seen = -1
  })
  return (lang) => {
    const voices = synth.getVoices()
    // Chrome returns [] until the list loads: do not cache that answer.
    if (voices.length !== seen) {
      cache = new Map()
      seen = voices.length
    }
    const hit = cache.get(lang)
    if (hit) return hit
    const made = assignVoices(voices, lang)
    if (voices.length > 0) cache.set(lang, made)
    return made
  }
}

export function createWebSpeech<V extends VoiceLike = SpeechSynthesisVoice>(deps?: WebSpeechDeps<V>): SpeechProvider {
  const synth = deps?.synth ?? (window.speechSynthesis as unknown as Synth<V>)
  const makeUtterance = deps?.makeUtterance ?? ((text: string) => new SpeechSynthesisUtterance(text) as unknown as WebUtterance<V>)
  const voiceBook = createVoiceBook<V>(synth)
  return {
    name: 'webspeech',
    // There is nothing to download for a local voice, but resolving the voices now makes the first line start at once.
    prefetch: (u) => void voiceBook(u.lang),
    speak(u: Utterance, signal: AbortSignal): Promise<void> {
      const params = paramsFor(u)
      if (!params.text) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        const utter = makeUtterance(params.text)
        const voice = voiceBook(u.lang)[u.speaker]
        // No voice of this language: show the text, do not speak it with another language's voice (the
        // browser would pick its default voice for the tag, whatever language that is).
        if (!voice) {
          resolve()
          return
        }
        utter.lang = voice.lang
        utter.voice = voice
        utter.rate = params.rate
        utter.pitch = params.pitch
        utter.volume = params.volume
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
