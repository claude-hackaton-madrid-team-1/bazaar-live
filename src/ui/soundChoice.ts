/**
 * The start gate's answer (with sound or muted), remembered for this tab: a reload goes straight to the
 * show with the same sound, a new tab asks again (sessionStorage). Every mute or unmute after the gate
 * (M, the header's button) replaces it, so a reload keeps the latest one.
 *
 * Every storage access is guarded: in a private window or with blocked storage the answer lives only in
 * memory (it still holds while moving between screens), and a reload shows the gate again.
 */
import type { StorageLike } from './lang'

export const SOUND_STORAGE_KEY = 'bazaar-live.sound'

/** The stored answer: true with sound, false muted, null when there is none (or it cannot be read). */
export function readSoundChoice(storage: StorageLike | null): boolean | null {
  try {
    const stored = storage?.getItem(SOUND_STORAGE_KEY)
    if (stored === 'on') return true
    if (stored === 'off') return false
  } catch {
    // blocked storage: as if nothing was stored
  }
  return null
}

export function writeSoundChoice(storage: StorageLike | null, withSound: boolean): void {
  try {
    storage?.setItem(SOUND_STORAGE_KEY, withSound ? 'on' : 'off')
  } catch {
    // blocked storage or a full quota: the answer just is not remembered
  }
}

export interface SoundMemory {
  /** The answer this tab gave already (earlier on this page, or before a reload), or null: show the gate. */
  recall(): boolean | null
  remember(withSound: boolean): void
}

export function createSoundMemory(storage: StorageLike | null): SoundMemory {
  let current: boolean | null = null
  return {
    recall: () => (current ??= readSoundChoice(storage)),
    remember(withSound) {
      current = withSound
      writeSoundChoice(storage, withSound)
    },
  }
}

/**
 * Whether the page has had a tap or a key yet, which a browser asks before it plays audio. Null when the
 * browser does not say (no `navigator.userActivation`: Safari before 16.4, Firefox before 120).
 */
export function hasUserGesture(nav: { readonly userActivation?: Pick<UserActivation, 'hasBeenActive'> } | undefined): boolean | null {
  const activation = nav?.userActivation
  return activation ? activation.hasBeenActive : null
}

function safeSession(): StorageLike | null {
  try {
    return window.sessionStorage
  } catch {
    return null // a blocked or sandboxed storage throws on access
  }
}

let shared: SoundMemory | null = null

/** The page's one memory of the gate's answer (created on first use, on this tab's sessionStorage). */
export function soundMemory(): SoundMemory {
  shared ??= createSoundMemory(typeof window === 'undefined' ? null : safeSession())
  return shared
}
