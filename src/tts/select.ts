import type { TtsChoice } from '../config'
import { createRemote, type RemoteName } from './remote'
import { SILENT, type SpeechProvider } from './types'

/**
 * Which provider name a choice resolves to, given what the proxy offers.
 *
 * The show's voice is ElevenLabs v4 and nothing else: `auto` is ElevenLabs when the server has its key,
 * and silence (the captions still play) when it does not. The browser's own voice is no fallback, it
 * sounds wrong next to the characters; it, and Gemini, are reachable only by asking for them by name
 * (`?tts=webspeech`, `?tts=gemini`), for development.
 */
export function resolveChoice(choice: TtsChoice, available: readonly RemoteName[], hasWebSpeech: boolean): RemoteName | 'webspeech' | 'off' {
  if (choice === 'off') return 'off'
  if (choice === 'webspeech') return hasWebSpeech ? 'webspeech' : 'off'
  if (choice === 'gemini') return available.includes('gemini') ? 'gemini' : 'off'
  return available.includes('elevenlabs') ? 'elevenlabs' : 'off'
}

/** Builds providers once and hands out the one a choice resolves to. */
export function providerFactory(webspeech: SpeechProvider | null): (name: RemoteName | 'webspeech' | 'off') => SpeechProvider {
  const remotes = new Map<RemoteName, SpeechProvider>()
  return (name) => {
    if (name === 'off') return SILENT
    if (name === 'webspeech') return webspeech ?? SILENT
    const existing = remotes.get(name)
    if (existing) return existing
    const created = createRemote(name)
    remotes.set(name, created)
    return created
  }
}
