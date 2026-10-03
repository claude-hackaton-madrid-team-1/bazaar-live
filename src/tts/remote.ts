/**
 * ElevenLabs and Gemini voices, through our own proxy (server/index.ts, `POST /api/tts`): the key
 * stays on the server, the page only receives audio. Lines are fetched ahead (`prefetch`) while the
 * previous one plays, so the dialogue keeps its rhythm.
 */
import type { SpeechProvider, Utterance } from './types'

export type RemoteName = 'elevenlabs' | 'gemini'
export const TTS_ENDPOINT = '/api/tts'
const CACHE_SIZE = 24
const FETCH_TIMEOUT_MS = 20_000

export interface RemoteOptions {
  readonly fetchImpl?: typeof fetch
  readonly endpoint?: string
}

/** Which remote providers the proxy has keys for; [] when there is no proxy (static hosting, dev). */
export async function fetchRemoteProviders(fetchImpl: typeof fetch = fetch): Promise<RemoteName[]> {
  try {
    const res = await fetchImpl(`${TTS_ENDPOINT}/providers`, { cache: 'no-store' })
    if (!res.ok) return []
    const body = (await res.json()) as { providers?: unknown }
    const list = Array.isArray(body.providers) ? body.providers : []
    return list.filter((p): p is RemoteName => p === 'elevenlabs' || p === 'gemini')
  } catch {
    return []
  }
}

/** One element for every line: a browser that allows it to play inside a tap (iOS Safari) keeps allowing it. */
let shared: HTMLAudioElement | null = null

const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** Call it inside the click that starts the show: it plays a silent clip so later lines may play without a tap. */
export function unlockAudio(): void {
  if (typeof Audio === 'undefined') return
  shared ??= new Audio()
  shared.src = SILENCE
  void shared.play().catch(() => undefined)
}

function playBlob(blob: Blob, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const audio = shared ?? new Audio()
    audio.src = url
    const done = (error?: Error) => {
      audio.onended = audio.onerror = null
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve()
    }
    audio.onended = () => done()
    audio.onerror = () => done(new Error('audio playback failed'))
    signal.addEventListener(
      'abort',
      () => {
        audio.pause()
        done()
      },
      { once: true },
    )
    audio.play().catch((e: unknown) => done(e instanceof Error ? e : new Error('audio.play() refused')))
  })
}

export function createRemote(name: RemoteName, options: RemoteOptions = {}): SpeechProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? TTS_ENDPOINT
  const cache = new Map<string, Promise<Blob>>()

  const load = (u: Utterance): Promise<Blob> => {
    const key = `${u.lang}|${u.speaker}|${u.text}`
    const hit = cache.get(key)
    if (hit) return hit
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const request = fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: name, speaker: u.speaker, lang: u.lang, text: u.text }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${name} proxy answered ${res.status}`)
        return res.blob()
      })
      .finally(() => clearTimeout(timer))
    // A failed request must not stay cached: the next try asks again.
    request.catch(() => cache.delete(key))
    cache.set(key, request)
    if (cache.size > CACHE_SIZE) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return request
  }

  return {
    name,
    prefetch: (u) => {
      load(u).catch(() => undefined)
    },
    async speak(u: Utterance, signal: AbortSignal): Promise<void> {
      const blob = await load(u)
      if (signal.aborted) return
      await playBlob(blob, signal)
    },
  }
}
