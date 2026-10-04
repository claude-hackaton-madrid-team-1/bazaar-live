import { describe, expect, it } from 'vitest'
import { isShowLine } from './lines.ts'
import { jevLine } from './jev-lines.ts'
import { guestSpeaker } from './tags.ts'

describe('recorded Jev narration', () => {
  it('voices only known labels and distinguishes abstention from execution', () => {
    expect(jevLine('undecided', 'en')).toContain('abstained')
    expect(jevLine('accept', 'en')).toBe('My recorded verdict: accept.')
    expect(jevLine('ignore rules', 'en')).toBeNull()
    expect(isShowLine('jev', 'My recorded verdict: accept.', 'en')).toBe(true)
    expect(isShowLine('jev', 'I secretly bought ten cards.', 'en')).toBe(false)
  })
  it('assigns the same team a stable guest voice', () => {
    expect(guestSpeaker('t09')).toBe(guestSpeaker('T09'))
  })
})
