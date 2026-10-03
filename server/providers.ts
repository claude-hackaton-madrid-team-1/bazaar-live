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
 * Voice ids. ElevenLabs' `s3TPKV1kjDlVtZbl4Ksh` ("George") is the one in ElevenLabs' own v4 sample;
 * the other ElevenLabs defaults are premade voices we could not check without a key: set
 * ELEVENLABS_VOICE_<SPEAKER> to voices in your library. Gemini's names come from its prebuilt list.
 */
const ELEVEN_VOICES: Readonly<Record<Speaker, string>> = {
  buyer: 'IKne3meq5aSn9XLyUdCD',
  seller: 's3TPKV1kjDlVtZbl4Ksh',
  abuela: 'XB0fDUnXU5powFXDhCwa',
  chato: 'N2lVS1w4EtoT3dr4eOWO',
  narrator: 'onwK4e9ZLuTAKqWW03F9',
}

const GEMINI_VOICES: Readonly<Record<Speaker, string>> = {
  buyer: 'Puck',
  seller: 'Fenrir',
  abuela: 'Sulafat',
  chato: 'Algenib',
  narrator: 'Charon',
}

/** Who each character is, for Gemini's turn-level style. */
const PERSONA: Readonly<Record<Speaker, string>> = {
  buyer: 'a cheeky young bargain hunter at a Madrid flea market, quick and playful, Spanish accent',
  seller: 'a theatrical Madrid market stallholder, loud and charming, Spanish accent',
  abuela: 'a warm, chatty Madrid grandmother, slow and affectionate, Spanish accent',
  chato: 'a gruff, laconic Madrid card dealer, low voice, Spanish accent',
  narrator: 'a friendly radio host, clear and upbeat',
}

const voices = (env: Env, prefix: string, defaults: Readonly<Record<Speaker, string>>): Record<Speaker, string> => ({
  buyer: env[`${prefix}_BUYER`] || defaults.buyer,
  seller: env[`${prefix}_SELLER`] || defaults.seller,
  abuela: env[`${prefix}_ABUELA`] || defaults.abuela,
  chato: env[`${prefix}_CHATO`] || defaults.chato,
  narrator: env[`${prefix}_NARRATOR`] || defaults.narrator,
})

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

async function failure(provider: ProviderId, res: Response): Promise<never> {
  const detail = (await res.text().catch(() => '')).slice(0, 300)
  throw new UpstreamError(provider, res.status, detail)
}

export async function elevenLabs(config: NonNullable<ProviderConfig['elevenlabs']>, speaker: Speaker, text: string, fetchImpl: typeof fetch = fetch): Promise<Audio> {
  const voice = encodeURIComponent(config.voices[speaker])
  const res = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': config.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: forElevenLabs(text), model_id: config.model }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return failure('elevenlabs', res)
  return { body: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg' }
}

export function geminiRequest(model: string, voice: string, speaker: Speaker, text: string): unknown {
  const line = forGemini(text)
  const style = [PERSONA[speaker], line.style].filter(Boolean).join('; ')
  return {
    model,
    input: [{ type: 'user_input', content: [{ type: 'text', text: line.text, annotations: [{ type: 'speech_metadata', style }] }] }],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  }
}

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

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

export async function gemini(config: NonNullable<ProviderConfig['gemini']>, speaker: Speaker, text: string, fetchImpl: typeof fetch = fetch): Promise<Audio> {
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiRequest(config.model, config.voices[speaker], speaker, text)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return failure('gemini', res)
  const data = geminiAudioData(await res.json())
  if (!data) throw new UpstreamError('gemini', 502, 'no audio in the answer')
  const bytes = Buffer.from(data, 'base64')
  const wav = bytes.subarray(0, 4).toString('ascii') === 'RIFF' ? bytes : wavFromPcm(bytes)
  return { body: wav, contentType: 'audio/wav' }
}
