import { describe, expect, it } from 'vitest'
import { parseNames } from '../net/dealers'
import { speakerName } from './speakers'
import { STRINGS } from './strings'

const en = STRINGS.en
const es = STRINGS.es

describe('the caption names whoever speaks', () => {
  it('names each known dealer by its persona, never "Narrator"', () => {
    expect(speakerName(en, 'pilar', undefined, {})).toBe('Doña Pilar')
    expect(speakerName(es, 'pilar', undefined, {})).toBe('Doña Pilar')
    expect(speakerName(en, 'abuela', undefined, {})).toBe('Abuela Carmen')
    expect(speakerName(en, 'chato', undefined, {})).toBe('El Chato')
  })

  it("names a guest dealer by the game's display name", () => {
    expect(speakerName(en, 'guest2', 'duquesa', { duquesa: 'La Duquesa' })).toBe('La Duquesa')
  })

  it('falls back to the dealer id, then to "the dealer"', () => {
    expect(speakerName(en, 'guest1', 'el_gato', {})).toBe('El Gato')
    expect(speakerName(en, 'guest3', undefined, {})).toBe('the dealer')
  })

  it('keeps the characters and the narrator', () => {
    expect(speakerName(en, 'narrator', undefined, {})).toBe(en.narrator)
    expect(speakerName(en, 'buyer', undefined, {})).toBe(en.buyer)
  })
})

describe('the dealer names from /api/dealers', () => {
  it('keeps plain ids and names only', () => {
    expect(parseNames({ names: { pilar: 'Doña Pilar', duquesa: 'La Duquesa', 'Bad Id': 'X', evil: '<img src=x>', n: 5 } })).toEqual({ pilar: 'Doña Pilar', duquesa: 'La Duquesa' })
    expect(parseNames(null)).toEqual({})
    expect(parseNames({ names: ['pilar'] })).toEqual({})
  })
})
