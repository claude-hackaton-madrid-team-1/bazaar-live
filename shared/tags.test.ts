import { describe, expect, it } from 'vitest'
import { dealerSpeaker, deliveryOf, forElevenLabs, forGemini, GUEST_SPEAKERS, guestSpeaker, isSpeaker, knownDealer, speakable, stripTags, tagsOf } from './tags.ts'

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

describe('a voice per dealer', () => {
  it('knows every dealer we have met by handle or by name', () => {
    expect(dealerSpeaker('abuela')).toBe('abuela')
    expect(dealerSpeaker('Abuela Carmen')).toBe('abuela')
    expect(dealerSpeaker('chato')).toBe('chato')
    expect(dealerSpeaker('pilar')).toBe('pilar')
    expect(dealerSpeaker('Doña Pilar')).toBe('pilar')
    expect(knownDealer('pilar')).toBe('pilar')
    // a handle that only contains a known one is another dealer
    for (const id of ['pilarica', 'carmencita', 'el_chato_jr']) {
      expect(knownDealer(id)).toBeNull()
      expect(GUEST_SPEAKERS).toContain(dealerSpeaker(id))
    }
    expect(isSpeaker('pilar')).toBe(true)
  })

  it('gives a dealer we do not know a stable guest voice, never the narrator nor a known dealer', () => {
    for (const id of ['tendero', 'el_gato', 'duquesa', 'x', 'l5-boss']) {
      const speaker = dealerSpeaker(id)
      expect(GUEST_SPEAKERS).toContain(speaker)
      expect(dealerSpeaker(id.toUpperCase())).toBe(speaker)
      expect(guestSpeaker(id)).toBe(speaker)
    }
  })

  it('spreads new dealers over the whole pool', () => {
    const used = new Set(Array.from({ length: 30 }, (_, i) => guestSpeaker(`dealer${i}`)))
    expect(used).toEqual(new Set(GUEST_SPEAKERS))
  })

  it('gives no dealer voice to a team or to something that is not a handle', () => {
    for (const id of ['t05', 'T12', '', null, undefined, 'two words', '<script>']) expect(dealerSpeaker(id)).toBeNull()
  })
})
