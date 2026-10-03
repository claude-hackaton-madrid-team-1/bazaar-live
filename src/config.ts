import { MAKER_HTTP, TAKER_HTTP, toWs } from '../shared/endpoints.ts'
import { parseLang, type Lang } from '../shared/lang.ts'
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
export const TTS_CHOICES: readonly TtsChoice[] = ['auto', 'webspeech', 'elevenlabs', 'gemini', 'off']

export interface ShowConfig {
  /** `?mock=1`: play the recorded fixtures instead of the live feeds. */
  readonly mock: boolean
  /** `?speed=2`: mock playback speed (0.25 to 8). */
  readonly speed: number
  /** `?tts=webspeech|elevenlabs|gemini|off|auto` (default auto: the best provider the proxy has). */
  readonly tts: TtsChoice
  /** `?lang=en` for English; castellano by default. One language per line, never mixed. */
  readonly lang: Lang
  /** `?mode=dry`: the mock's /health says dry run instead of live. */
  readonly mockMode: 'live' | 'dry'
}

export const POLL = { healthMs: 20_000, stateMs: 30_000 } as const

function flag(value: string | null): boolean {
  return value !== null && ['1', 'true', 'yes', 'on', ''].includes(value.toLowerCase())
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
    lang: parseLang(params.get('lang')),
  }
}
