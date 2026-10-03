import { describe, expect, it } from 'vitest'
import type { StorageLike } from './lang'
import { createSoundMemory, hasUserGesture, readSoundChoice, SOUND_STORAGE_KEY, writeSoundChoice } from './soundChoice'

const memoryStorage = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('readSoundChoice / writeSoundChoice', () => {
  it('reads back what was written', () => {
    const storage = memoryStorage()
    writeSoundChoice(storage, true)
    expect(storage.data[SOUND_STORAGE_KEY]).toBe('on')
    expect(readSoundChoice(storage)).toBe(true)
    writeSoundChoice(storage, false)
    expect(readSoundChoice(storage)).toBe(false)
  })

  it('is null with nothing stored, something unknown stored, or no storage', () => {
    expect(readSoundChoice(memoryStorage())).toBeNull()
    expect(readSoundChoice(memoryStorage({ [SOUND_STORAGE_KEY]: 'loud' }))).toBeNull()
    expect(readSoundChoice(null)).toBeNull()
  })

  it('never throws when storage does (a private window, blocked storage)', () => {
    expect(readSoundChoice(brokenStorage)).toBeNull()
    expect(() => writeSoundChoice(brokenStorage, true)).not.toThrow()
  })
})

describe('createSoundMemory: when the gate is skipped', () => {
  it('shows the gate in a new tab (nothing stored)', () => {
    expect(createSoundMemory(memoryStorage()).recall()).toBeNull()
  })

  it('skips it after a reload of a tab that answered, with that answer', () => {
    const tab = memoryStorage()
    createSoundMemory(tab).remember(false)
    expect(createSoundMemory(tab).recall()).toBe(false)
    createSoundMemory(tab).remember(true)
    expect(createSoundMemory(tab).recall()).toBe(true)
  })

  it('keeps the latest answer: a mute after the gate replaces it', () => {
    const tab = memoryStorage()
    const page = createSoundMemory(tab)
    page.remember(true) // the gate: with sound
    page.remember(false) // then M
    expect(page.recall()).toBe(false)
    expect(createSoundMemory(tab).recall()).toBe(false)
  })

  it('with storage that throws: remembered on this page (moving between screens), the gate again after a reload', () => {
    const page = createSoundMemory(brokenStorage)
    expect(page.recall()).toBeNull()
    expect(() => page.remember(true)).not.toThrow()
    expect(page.recall()).toBe(true)
    expect(createSoundMemory(brokenStorage).recall()).toBeNull()
  })
})

describe('hasUserGesture', () => {
  it('says what the browser says, and null when it does not say', () => {
    expect(hasUserGesture({ userActivation: { hasBeenActive: false } })).toBe(false)
    expect(hasUserGesture({ userActivation: { hasBeenActive: true } })).toBe(true)
    expect(hasUserGesture({})).toBeNull()
    expect(hasUserGesture(undefined)).toBeNull()
  })
})
