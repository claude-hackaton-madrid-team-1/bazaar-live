import { describe, expect, it } from 'vitest'
import { EMPTY_LEARN } from '../../shared/learn.ts'
import { learnStateOf, mockLearn } from './learn.ts'

describe('learnStateOf', () => {
  const prev = mockLearn(10)

  it('reads a live snapshot', () => {
    const s = learnStateOf(200, { enabled: true, at: '2026-10-03T10:00:00Z', parts: { learnings: true, moves: false }, learnings: [{ id: 1 }], moves: 'odd' }, EMPTY_LEARN)
    expect(s.status).toBe('live')
    expect(s.snapshot.parts).toEqual({ learnings: true, moves: false, dealers: false, rivals: false })
    expect(s.snapshot.learnings).toHaveLength(1)
    expect(s.snapshot.moves).toEqual([])
  })

  it('is off without a database, and locked without the token', () => {
    expect(learnStateOf(200, { enabled: false }, prev)).toEqual({ status: 'off', snapshot: EMPTY_LEARN })
    expect(learnStateOf(401, { error: 'token_required' }, prev)).toEqual({ status: 'locked', snapshot: EMPTY_LEARN })
  })

  it('keeps the last snapshot on an error', () => {
    expect(learnStateOf(500, null, prev)).toEqual({ status: 'error', snapshot: prev })
    expect(learnStateOf(200, 'not json', prev)).toEqual({ status: 'error', snapshot: prev })
  })
})
