import { describe, expect, it } from 'vitest'
import { forElevenLabs, forGemini, isSpeaker, stripTags, tagsOf } from './tags.ts'

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
