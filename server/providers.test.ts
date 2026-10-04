import { describe, expect, it } from 'vitest'
import { SPEAKERS, stripTags } from '../shared/tags.ts'
import { ELEVEN_DELIVERY, elevenRequest, readProviderConfig } from './providers.ts'

const config = readProviderConfig({ ELEVENLABS_API_KEY: 'not-a-real-key' }).elevenlabs
if (!config) throw new Error('test provider configuration missing')

describe('curated ElevenLabs performance', () => {
  it.each(SPEAKERS)('adds bounded acting tags for %s without changing quote words', (speaker) => {
    const quote = 'La oferta es de 29 primas. ¿Te interesa?'
    const request = elevenRequest(config, speaker, 'es', quote)
    expect(request.body.text).toBe(`${ELEVEN_DELIVERY[speaker]} ${quote}`)
    expect(stripTags(request.body.text)).toBe(quote)
    expect(ELEVEN_DELIVERY[speaker].match(/\[[a-z ]+\]/g)).toHaveLength(2)
    expect(ELEVEN_DELIVERY[speaker].length).toBeLessThan(65)
    expect(request.body.text).not.toContain('<break')
  })

  it('keeps dealers, guest roles, leads and the coordinator recognisably distinct', () => {
    expect(new Set(Object.values(ELEVEN_DELIVERY)).size).toBe(SPEAKERS.length)
    expect(ELEVEN_DELIVERY.abuela).toContain('warm gentle')
    expect(ELEVEN_DELIVERY.chato).toContain('gravelly')
    expect(ELEVEN_DELIVERY.pilar).toContain('measured')
    expect(ELEVEN_DELIVERY.jev).toContain('calm')
  })

  it('preserves approved expressive cues and the English caption text', () => {
    const text = '[sighs] Let me think about this offer.'
    expect(elevenRequest(config, 'pilar', 'en', text).body.text)
      .toBe(`${ELEVEN_DELIVERY.pilar} ${text}`)
    expect(text).toBe('[sighs] Let me think about this offer.')
  })
})
