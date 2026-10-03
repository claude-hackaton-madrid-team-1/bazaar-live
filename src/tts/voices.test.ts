import { describe, expect, it } from 'vitest'
import { assignVoices, type VoiceLike } from './voices'

const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService })

// What a Mac typically offers, plus a few Chrome "Google" voices.
const MAC = [
  v('Albert', 'en-US'), v('Alex', 'en-US'), v('Samantha', 'en-US'), v('Daniel', 'en-GB'), v('Karen', 'en-AU'), v('Bad News', 'en-US'),
  v('Mónica', 'es-ES'), v('Jorge', 'es-ES'), v('Paulina', 'es-MX'), v('Juan', 'es-MX'), v('Thomas', 'fr-FR'),
]

describe('assignVoices', () => {
  it('gives every role a NATIVE castellano voice (es-ES first), never an English one', () => {
    const map = assignVoices(MAC, 'es')
    for (const voice of Object.values(map)) expect(voice?.lang.startsWith('es')).toBe(true)
    expect(map.abuela?.name).toBe('Mónica')
    expect(map.chato?.name).toBe('Jorge')
  })

  it('gives every role an English voice for ?lang=en, en-GB first, with no novelty voices', () => {
    const map = assignVoices(MAC, 'en')
    for (const voice of Object.values(map)) expect(voice?.lang.startsWith('en')).toBe(true)
    expect(Object.values(map).map((x) => x?.name)).not.toContain('Albert')
    expect(Object.values(map).map((x) => x?.name)).not.toContain('Bad News')
    expect(map.chato?.name).toBe('Daniel') // the most native man goes to the character who must stand out
    expect(map.abuela?.name).toBe('Samantha')
  })

  it('makes the abuela a woman and El Chato a man when it can, and the characters distinct', () => {
    const map = assignVoices(MAC, 'es')
    expect(map.abuela?.name).not.toBe(map.chato?.name)
    expect(map.seller?.name).not.toBe(map.chato?.name)
    const names = [map.abuela, map.chato, map.seller, map.buyer].map((x) => x?.name)
    expect(new Set(names).size).toBe(4) // four es voices on the Mac list
  })

  it('shares voices when the browser has fewer than the cast, still native', () => {
    const map = assignVoices([v('Mónica', 'es-ES')], 'es')
    for (const voice of Object.values(map)) expect(voice?.name).toBe('Mónica')
  })

  it('prefers the better engine and the local one inside a tier', () => {
    const map = assignVoices([v('Google español', 'es-ES', false), v('Paloma Online (Natural)', 'es-ES', false), v('Eddy (Español (España))', 'es-ES', true)], 'es')
    expect(map.abuela?.name).toBe('Paloma Online (Natural)') // quality hint first
    const local = assignVoices([v('Google español', 'es-ES', false), v('Eddy (Español (España))', 'es-ES', true)], 'es')
    expect(local.abuela?.name).toBe('Eddy (Español (España))') // then local before remote
  })

  it('has no voice for a language the browser lacks, so the utterance language tag decides', () => {
    const map = assignVoices([v('Samantha', 'en-US')], 'es')
    for (const voice of Object.values(map)) expect(voice).toBeNull()
  })

  it('reads the underscore form some Android engines report (es_ES)', () => {
    expect(assignVoices([v('es-es-x-eea-local', 'es_ES')], 'es').buyer?.lang).toBe('es_ES')
  })

  it('is deterministic', () => {
    expect(assignVoices(MAC, 'es')).toEqual(assignVoices(MAC, 'es'))
  })
})
