import { describe, expect, it } from 'vitest'
import { deliveryOf, forElevenLabs, forGemini, isSpeaker, speakable, stripTags, tagsOf } from './tags.ts'

describe('tags', () => {
  const line = '[sarcastic] 68 primas? [laughs] For that it should come with churros.'

  it('strips tags for Web Speech', () => {
    expect(stripTags(line)).toBe('68 primas? For that it should come with churros.')
  })

  it('passes square-bracket audio tags to ElevenLabs v4', () => {
    expect(forElevenLabs(`  ${line}  `)).toBe(line)
  })

  it('moves sustained tags to Gemini style and momentary ones inline as <tags>', () => {
    expect(forGemini(line)).toEqual({ text: '68 primas? <laugh> For that it should come with churros.', style: 'sarcastic' })
    expect(forGemini('[whispers] Psst. [gasps] Look!')).toEqual({ text: 'Psst. <gasp> Look!', style: 'whispering' })
    expect(forGemini('No tags here.')).toEqual({ text: 'No tags here.', style: '' })
  })

  it('lists tags and validates speakers', () => {
    expect(tagsOf(line)).toEqual(['sarcastic', 'laughs'])
    expect(isSpeaker('abuela')).toBe(true)
    expect(isSpeaker('admin')).toBe(false)
  })
})

describe('tags are never read aloud', () => {
  it('speakable() leaves the words alone: no [tag], no <tag>, no stray bracket', () => {
    expect(speakable('[sarcastic] Vale. [sighs] <laugh> Ya.')).toBe('Vale. Ya.')
    expect(speakable('[excited] ¡Hola [mundo]!')).toBe('¡Hola !')
    expect(speakable('Un [roto y <medio')).toBe('Un roto y medio')
    expect(speakable('Sin etiquetas.')).toBe('Sin etiquetas.')
  })

  it('maps a tag to delivery instead of words: speed, pitch and volume', () => {
    expect(deliveryOf('Sin etiquetas.')).toEqual({ rate: 1, pitch: 1, volume: 1 })
    const whisper = deliveryOf('[whispers] Psst.')
    expect(whisper.volume).toBeLessThan(0.7)
    expect(deliveryOf('[excited] ¡Sí!').pitch).toBeGreaterThan(1)
    expect(deliveryOf('[sighs] Bueno.').rate).toBeLessThan(1)
    // Two tags combine, and an unknown one does nothing.
    const both = deliveryOf('[excited] [laughs] ¡Ja!')
    expect(both.rate).toBeGreaterThan(deliveryOf('[excited] ¡Ja!').rate)
    expect(deliveryOf('[unheardof] Hola.')).toEqual({ rate: 1, pitch: 1, volume: 1 })
  })

  it('keeps every delivery inside what a voice can do', () => {
    const wild = deliveryOf('[excited] [excited] [excited] [gasps] [gasps] [gasps] [laughs] [laughs]')
    expect(wild.rate).toBeLessThanOrEqual(1.6)
    expect(wild.pitch).toBeLessThanOrEqual(1.8)
  })
})
