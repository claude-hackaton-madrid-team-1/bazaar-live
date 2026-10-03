import { MAKER_HTTP, TAKER_HTTP, toWs } from '../shared/endpoints.ts'
import type { AgentId } from './model/events'

export interface AgentEndpoint {
  readonly http: string
  readonly ws: string
}

/** The agents' public, read-only status servers (bazaar/docs/services.md). */
export const ENDPOINTS: Readonly<Record<AgentId, AgentEndpoint>> = {
  taker: { http: TAKER_HTTP, ws: toWs(TAKER_HTTP) },
  maker: { http: MAKER_HTTP, ws: toWs(MAKER_HTTP) },
}

export type TtsChoice = 'auto' | 'webspeech' | 'elevenlabs' | 'gemini' | 'off'
/** Every value `?tts=` accepts; the header offers only the first three (ElevenLabs v4 is the show's voice). */
export const TTS_CHOICES: readonly TtsChoice[] = ['auto', 'elevenlabs', 'off', 'webspeech', 'gemini']
export const TTS_PICKER: readonly TtsChoice[] = ['auto', 'elevenlabs', 'off']

export interface ShowConfig {
  /** `?mock=1`: play the recorded fixtures instead of the live feeds. */
  readonly mock: boolean
  /** `?speed=2`: mock playback speed (0.25 to 8). */
  readonly speed: number
  /** `?tts=auto|elevenlabs|off` (default auto: ElevenLabs v4 when the server has its key, else captions only); `webspeech` and `gemini` are for development. */
  readonly tts: TtsChoice
  /** `?doors=closed`: the mock's /health says the doors are closed (to see the countdown talk). */
  readonly mockDoors: 'open' | 'closed'
  /** `?idle=8`: seconds of quiet before the characters talk about the situation (default 22 to 35, by the situation). */
  readonly idleSeconds: number | null
  /** `?quotes=speak`: voice a dealer's or rival's real words when they are in the selected language. Off: captions only. */
  readonly speakQuotes: boolean
  /** `?mode=dry`: the mock's /health says dry run instead of live. */
  readonly mockMode: 'live' | 'dry'
}

export const POLL = { healthMs: 20_000, stateMs: 30_000 } as const

function flag(value: string | null): boolean {
  return value !== null && ['1', 'true', 'yes', 'on', ''].includes(value.toLowerCase())
}

function idleSeconds(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(600, Math.max(2, n)) : null
}

export function readConfig(search: string): ShowConfig {
  const params = new URLSearchParams(search)
  const speed = Number(params.get('speed') ?? '1')
  const tts = (params.get('tts') ?? 'auto').toLowerCase()
  return {
    mock: flag(params.get('mock')),
    speed: Number.isFinite(speed) ? Math.min(8, Math.max(0.25, speed)) : 1,
    tts: (TTS_CHOICES as readonly string[]).includes(tts) ? (tts as TtsChoice) : 'auto',
    mockMode: params.get('mode') === 'dry' ? 'dry' : 'live',
    idleSeconds: idleSeconds(params.get('idle')),
    mockDoors: params.get('doors') === 'closed' ? 'closed' : 'open',
    speakQuotes: params.get('quotes') === 'speak',
  }
}
