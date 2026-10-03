import type { Speaker } from '../../shared/tags.ts'

export type ProviderName = 'webspeech' | 'elevenlabs' | 'gemini' | 'silent'

export interface Utterance {
  readonly id: string
  readonly speaker: Speaker
  /** With expressive tags; each provider strips or converts them. */
  readonly text: string
}

export interface SpeechProvider {
  readonly name: ProviderName
  /** Resolves when the line has been spoken (or was aborted); rejects when the provider failed. */
  speak(u: Utterance, signal: AbortSignal): Promise<void>
  /** Start fetching audio ahead of time (remote providers). */
  prefetch?(u: Utterance): void
}

/** A provider that says nothing: for `?tts=off` and browsers without speech. */
export const SILENT: SpeechProvider = {
  name: 'silent',
  speak: () => Promise.resolve(),
}
