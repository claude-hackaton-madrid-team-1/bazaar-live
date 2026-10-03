import { describe, expect, it } from 'vitest'
import { assignVoices, type VoiceLike } from './voices'

const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService })

// What a Mac typically offers, plus a few Chrome "Google" voices.
const MAC = [
  v('Albert', 'en-US'), v('Alex', 'en-US'), v('Samantha', 'en-US'), v('Daniel', 'en-GB'), v('Karen', 'en-AU'), v('Bad News', 'en-US'),
  v('Mónica', 'es-ES'), v('Jorge', 'es-ES'), v('Paulina', 'es-MX'), v('Juan', 'es-MX'), v('Thomas', 'fr-FR'),
]

describe('assignVoices', () => {
  it('gives every role a castellano voice from the most native tier: es-ES, not the es-MX ones next to it', () => {
    const map = assignVoices(MAC, 'es')
    for (const voice of Object.values(map)) expect(voice?.lang).toBe('es-ES')
    expect(map.buyer?.name).toBe('Mónica')
    expect(map.seller?.name).toBe('Jorge')
    expect(map.abuela?.name).toBe('Mónica') // a woman's voice, shared with the buyer (their pitches differ)
    expect(map.chato?.name).toBe('Jorge')
  })

  it('falls back to the other Spanish voices only when there is no es-ES one', () => {
    const map = assignVoices([v('Paulina', 'es-MX'), v('Juan', 'es-MX'), v('Samantha', 'en-US')], 'es')
    for (const voice of Object.values(map)) expect(voice?.lang).toBe('es-MX')
  })

  it('gives every role an English voice for ?lang=en (en-GB and en-US), with no novelty voices', () => {
    const map = assignVoices(MAC, 'en')
    for (const voice of Object.values(map)) expect(['en-GB', 'en-US']).toContain(voice?.lang)
    expect(Object.values(map).map((x) => x?.name)).not.toContain('Albert')
    expect(Object.values(map).map((x) => x?.name)).not.toContain('Bad News')
    expect(Object.values(map).map((x) => x?.name)).not.toContain('Karen') // en-AU is a tier down
    expect(map.seller?.name).toBe('Daniel')
    expect(map.abuela?.name).toBe('Samantha')
  })

  it('makes the abuela a woman and El Chato a man when it can, and the characters distinct when there are enough voices', () => {
    const rich = [v('Mónica', 'es-ES'), v('Jorge', 'es-ES'), v('Marisol', 'es-ES'), v('Diego', 'es-ES'), v('Voz local España', 'es-ES')]
    const map = assignVoices(rich, 'es')
    expect(map.abuela?.name).toMatch(/Mónica|Marisol/)
    expect(map.chato?.name).toMatch(/Jorge|Diego/)
    const names = [map.abuela, map.chato, map.seller, map.buyer].map((x) => x?.name)
    expect(new Set(names).size).toBe(4)
  })

  it('shares voices when the browser has fewer than the cast, still native', () => {
    const map = assignVoices([v('Mónica', 'es-ES')], 'es')
    for (const voice of Object.values(map)) expect(voice?.name).toBe('Mónica')
  })

  it('prefers the better engine and the local one inside a tier', () => {
    const map = assignVoices([v('Google español', 'es-ES', false), v('Paloma Online (Natural)', 'es-ES', false), v('Voz local España', 'es-ES', true)], 'es')
    expect(map.seller?.name).toBe('Paloma Online (Natural)') // quality hint first
    const local = assignVoices([v('Google español', 'es-ES', false), v('Voz local España', 'es-ES', true)], 'es')
    expect(local.seller?.name).toBe('Voz local España') // then local before remote
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
