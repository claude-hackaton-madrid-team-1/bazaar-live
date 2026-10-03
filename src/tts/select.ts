import type { TtsChoice } from '../config'
import { createRemote, type RemoteName } from './remote'
import { SILENT, type SpeechProvider } from './types'

/** Remote providers in order of preference when the choice is `auto` (README: ElevenLabs, then Gemini). */
const PREFERENCE: readonly RemoteName[] = ['elevenlabs', 'gemini']

/** Which provider name a choice resolves to, given what the proxy offers. */
export function resolveChoice(choice: TtsChoice, available: readonly RemoteName[], hasWebSpeech: boolean): RemoteName | 'webspeech' | 'off' {
  if (choice === 'off') return 'off'
  const local = hasWebSpeech ? 'webspeech' : 'off'
  if (choice === 'webspeech') return local
  if (choice === 'elevenlabs' || choice === 'gemini') return available.includes(choice) ? choice : local
  return PREFERENCE.find((p) => available.includes(p)) ?? local
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
