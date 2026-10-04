/**
 * The two paid voices, called from the server so their keys never reach a browser.
 *
 * ElevenLabs (https://elevenlabs.io/docs/api-reference/text-to-speech/convert): POST
 * /v1/text-to-speech/{voice_id}, `xi-api-key`, body `{text, model_id}`, answers MP3. Default model
 * `eleven_v4` (the models page lists `eleven_v4` and `eleven_v4_turbo`; there is no "v4 flash").
 *
 * Gemini (https://ai.google.dev/gemini-api/docs/speech-generation): POST /v1beta/interactions,
 * `x-goog-api-key`, model `gemini-3.8-flash-tts`, a `speech_metadata.style` annotation and
 * `generation_config.speech_config: [{voice}]`; a unary answer carries base64 WAV (24 kHz mono) in
 * `steps[].content[]` of type `audio`.
 */
import { Buffer } from 'node:buffer'
import type { Lang } from '../shared/lang.ts'
import { forElevenLabs, forGemini, type Speaker } from '../shared/tags.ts'

export type ProviderId = 'elevenlabs' | 'gemini'

export interface Audio {
  readonly body: Buffer
  readonly contentType: string
}

export interface ProviderConfig {
  readonly elevenlabs: { readonly key: string; readonly model: string; readonly voices: Readonly<Record<Speaker, string>> } | null
  readonly gemini: { readonly key: string; readonly model: string; readonly voices: Readonly<Record<Speaker, string>> } | null
}

export class UpstreamError extends Error {
  readonly status: number
  constructor(provider: ProviderId, status: number, detail: string) {
    super(`${provider} answered ${status}: ${detail}`)
    this.status = status
  }
}

type Env = Readonly<Record<string, string | undefined>>

/**
 * Voice ids, overridable with ELEVENLABS_VOICE_<SPEAKER> (and ELEVENLABS_VOICE_POOL for the guest
 * voices); docs/voices.md has the voice chosen for each dealer and the reasoning per role. Each dealer has
 * its own voice, never the narrator's. Gemini's names come from its prebuilt list.
 */
const ELEVEN_VOICES: Readonly<Record<Speaker, string>> = {
  buyer: 'IKne3meq5aSn9XLyUdCD',
  seller: 's3TPKV1kjDlVtZbl4Ksh',
  // Spain-Spanish voices from the shared library (peninsular accent), usable by id on our paid tier.
  abuela: 'RTuKyXJgRGAQSx8Qz8Mf', // Tete: old, soft, slow
  chato: 'RnKqZYEeVQciORlpiCz0', // Baldo: middle-aged, husky, serious
  pilar: '9oWKy782oltLmeuOUdq7', // Alegria Sana: old, classy, diplomatic
  guest1: '5egO01tkUjEzu7xSSE8M', // Carmelo: middle-aged, deep, mysterious
  guest2: '1eHrpOW5l98cxiSRjbzJ', // Raquel: young, bright, cheerful
  guest3: 'orF2qy9215xjwqqxqsWW', // Rafael: old, theatrical, a little raspy
  narrator: 'onwK4e9ZLuTAKqWW03F9',
  jev: 'onwK4e9ZLuTAKqWW03F9',
}

const GEMINI_VOICES: Readonly<Record<Speaker, string>> = {
  buyer: 'Puck',
  seller: 'Fenrir',
  abuela: 'Sulafat',
  chato: 'Algenib',
  pilar: 'Gacrux',
  guest1: 'Orus',
  guest2: 'Leda',
  guest3: 'Iapetus',
  narrator: 'Charon',
  jev: 'Charon',
}

/** Who each character is, for Gemini's turn-level style. */
const PERSONA: Readonly<Record<Speaker, string>> = {
  buyer: 'a cheeky young bargain hunter at a Madrid flea market, quick and playful',
  seller: 'a theatrical Madrid market stallholder, loud and charming',
  abuela: 'a warm, chatty Madrid grandmother, slow and affectionate',
  chato: 'a gruff, laconic Madrid card dealer, low voice',
  pilar: 'an elegant, formal older lady from the Salamanca district of Madrid, refined and unhurried',
  guest1: 'a card dealer at a Madrid flea market, deep-voiced and a little mysterious',
  guest2: 'a young card dealer at a Madrid flea market, bright and quick',
  guest3: 'an old card dealer at a Madrid flea market, theatrical like an auctioneer',
  narrator: 'a friendly radio host, clear and upbeat',
  jev: 'a calm coordinator reporting a recorded verdict, clear and measured',
}

/** Curated performance only: added server-side after quote authorization, never supplied by a rival.
 * ponytail: two fixed voice-quality tags per role; no LLM rewrite or punctuation changes.
 */
export const ELEVEN_DELIVERY: Readonly<Record<Speaker, string>> = {
  buyer: '[curious] [quick playful delivery]',
  seller: '[confident] [animated delivery]',
  abuela: '[warm gentle voice] [unhurried]',
  chato: '[low gravelly voice] [dry delivery]',
  pilar: '[refined voice] [measured delivery]',
  guest1: '[low resonant voice] [deliberate delivery]',
  guest2: '[bright voice] [energetic delivery]',
  guest3: '[raspy voice] [theatrical delivery]',
  narrator: '[clear voice] [upbeat delivery]',
  jev: '[calm voice] [measured delivery]',
}

/** The accent of the whole line: castellano from Madrid, or English with a light Madrid accent. */
const ACCENT: Readonly<Record<Lang, string>> = {
  es: 'speaking natural peninsular Spanish (castellano) from Madrid, not Latin American',
  en: 'speaking English with a light Madrid accent',
}

/**
 * ElevenLabs voice settings per character. Eleven v4 has two: `stability` (lower = broader emotional
 * range, higher = steadier) and `similarity_boost` (adherence to the reference voice); the model
 * ignores `style` and `speed` (docs: text-to-speech/eleven-v4). See docs/voices.md for the reasoning.
 */
export interface ElevenSettings {
  readonly stability: number
  readonly similarity_boost: number
}
export const ELEVEN_SETTINGS: Readonly<Record<Speaker, ElevenSettings>> = {
  buyer: { stability: 0.35, similarity_boost: 0.75 },
  seller: { stability: 0.4, similarity_boost: 0.75 },
  abuela: { stability: 0.55, similarity_boost: 0.8 },
  chato: { stability: 0.5, similarity_boost: 0.8 },
  pilar: { stability: 0.6, similarity_boost: 0.8 },
  guest1: { stability: 0.45, similarity_boost: 0.75 },
  guest2: { stability: 0.45, similarity_boost: 0.75 },
  guest3: { stability: 0.5, similarity_boost: 0.75 },
  narrator: { stability: 0.6, similarity_boost: 0.75 },
  jev: { stability: 0.6, similarity_boost: 0.75 },
}

/** `<PREFIX>_POOL`: comma-separated voice ids for the guest voices (dealers we do not know yet), in order. */
const pool = (env: Env, prefix: string): string[] =>
  (env[`${prefix}_POOL`] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)

/**
 * One voice per speaker: `<PREFIX>_<SPEAKER>` (e.g. ELEVENLABS_VOICE_PILAR), else the default. A guest
 * voice takes `<PREFIX>_GUEST<n>` first, then the n-th id of `<PREFIX>_POOL`, then its default.
 */
const voices = (env: Env, prefix: string, defaults: Readonly<Record<Speaker, string>>): Record<Speaker, string> => {
  const fromPool = pool(env, prefix)
  const pick = (speaker: Speaker, poolIndex: number | null): string =>
    env[`${prefix}_${speaker.toUpperCase()}`]?.trim() || (poolIndex === null ? undefined : fromPool[poolIndex]) || defaults[speaker]
  return {
    buyer: pick('buyer', null),
    seller: pick('seller', null),
    abuela: pick('abuela', null),
    chato: pick('chato', null),
    pilar: pick('pilar', null),
    guest1: pick('guest1', 0),
    guest2: pick('guest2', 1),
    guest3: pick('guest3', 2),
    narrator: pick('narrator', null),
    jev: pick('narrator', null),
  }
}

export function readProviderConfig(env: Env): ProviderConfig {
  const eleven = env.ELEVENLABS_API_KEY?.trim()
  const gemini = env.GEMINI_API_KEY?.trim()
  return {
    elevenlabs: eleven
      ? { key: eleven, model: env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_v4', voices: voices(env, 'ELEVENLABS_VOICE', ELEVEN_VOICES) }
      : null,
    gemini: gemini
      ? { key: gemini, model: env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.8-flash-tts', voices: voices(env, 'GEMINI_VOICE', GEMINI_VOICES) }
      : null,
  }
}

export function availableProviders(config: ProviderConfig): ProviderId[] {
  return (['elevenlabs', 'gemini'] as const).filter((p) => config[p] !== null)
}

const TIMEOUT_MS = 15_000

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The provider's own error code (`quota_exceeded`, `PERMISSION_DENIED`), never its raw body: a body
 * may echo request headers, and this message goes to the log.
 */
export function errorCode(body: unknown): string {
  const obj = isRecord(body) ? body : {}
  const nested = isRecord(obj.detail) ? obj.detail : isRecord(obj.error) ? obj.error : {}
  const code = nested.status ?? nested.code ?? obj.status
  const text = typeof code === 'string' || typeof code === 'number' ? String(code) : ''
  return /^[A-Za-z0-9_.-]{1,40}$/.test(text) ? text : 'unknown'
}

async function failure(provider: ProviderId, res: Response): Promise<never> {
  const body: unknown = await res.json().catch(() => null)
  throw new UpstreamError(provider, res.status, errorCode(body))
}

/** The request ElevenLabs gets for a line (pure: building it costs nothing and sends nothing). */
export function elevenRequest(config: Pick<NonNullable<ProviderConfig['elevenlabs']>, 'model' | 'voices'>, speaker: Speaker, lang: Lang, text: string) {
  const voice = encodeURIComponent(config.voices[speaker])
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
    body: {
      text: `${ELEVEN_DELIVERY[speaker]} ${forElevenLabs(text)}`,
      model_id: config.model,
      // ISO 639-1: enforces the language and its text normalisation ("30 primas" is read in that language).
      language_code: lang,
      voice_settings: ELEVEN_SETTINGS[speaker],
    },
  }
}

export async function elevenLabs(config: NonNullable<ProviderConfig['elevenlabs']>, speaker: Speaker, lang: Lang, text: string, fetchImpl: typeof fetch = fetch): Promise<Audio> {
  const request = elevenRequest(config, speaker, lang, text)
  const res = await fetchImpl(request.url, {
    method: 'POST',
    headers: { 'xi-api-key': config.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return failure('elevenlabs', res)
  return { body: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg' }
}

export function geminiRequest(model: string, voice: string, speaker: Speaker, text: string, lang: Lang = 'es'): unknown {
  const line = forGemini(text)
  const style = [PERSONA[speaker], ACCENT[lang], line.style].filter(Boolean).join('; ')
  return {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: line.text, annotations: [{ type: 'speech_metadata', style }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }
}


/** The last audio block of an Interactions answer (base64), or null. */
export function geminiAudioData(body: unknown): string | null {
  if (!isRecord(body)) return null
  let found: string | null = null
  const steps = Array.isArray(body.steps) ? body.steps : []
  for (const step of steps) {
    if (!isRecord(step) || !Array.isArray(step.content)) continue
    for (const part of step.content) {
      if (isRecord(part) && part.type === 'audio' && typeof part.data === 'string') found = part.data
    }
  }
  if (found) return found
  const convenience = body.output_audio
  return isRecord(convenience) && typeof convenience.data === 'string' ? convenience.data : null
}

/** A RIFF/WAVE header for raw 16-bit mono PCM (Gemini's `audio/l16`). */
export function wavFromPcm(pcm: Buffer, sampleRate = 24_000): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export async function gemini(config: NonNullable<ProviderConfig['gemini']>, speaker: Speaker, lang: Lang, text: string, fetchImpl: typeof fetch = fetch): Promise<Audio> {
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiRequest(config.model, config.voices[speaker], speaker, text, lang)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return failure('gemini', res)
  const data = geminiAudioData(await res.json())
  // A 200 without audio was probably billed: a plain Error, so the daily budget is not refunded.
  if (!data) throw new Error('gemini answered 200 with no audio')
  const bytes = Buffer.from(data, 'base64')
  const wav = bytes.subarray(0, 4).toString('ascii') === 'RIFF' ? bytes : wavFromPcm(bytes)
  return { body: wav, contentType: 'audio/wav' }
}
