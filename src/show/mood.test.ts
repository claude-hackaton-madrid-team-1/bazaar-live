import { describe, expect, it } from 'vitest'
import { MOODS } from '../../shared/bank.ts'
import { BORED_AFTER_MS, moodsFor, type Topic } from './mood'

const TOPICS: readonly Topic[] = [
  'post', 'reprice', 'hold', 'cancel', 'take', 'pass', 'late', 'practice', 'denied', 'fail', 'dealer_open', 'dealer_bid',
  'dealer_accept', 'dealer_walk', 'deal', 'sent', 'unknown', 'duel_offer', 'duel_accept', 'duel_hold', 'doors_closed',
  'paused', 'offline', 'quiet', 'tick', 'new_page', 'market_test', 'simulator', 'dry',
]

describe('moodsFor', () => {
  it('always lists all four moods, each once', () => {
    for (const topic of TOPICS) expect([...moodsFor({ topic })].sort(), topic).toEqual([...MOODS].sort())
  })

  it('is deterministic: the same situation gives the same moods', () => {
    for (const topic of TOPICS) expect(moodsFor({ topic, busy: true, quietMs: 1000, recent: ['calm'] })).toEqual(moodsFor({ topic, busy: true, quietMs: 1000, recent: ['calm'] }))
  })

  it('celebrates a deal, grumbles at a refusal, stays calm when holding', () => {
    expect(moodsFor({ topic: 'deal' })[0]).toBe('triumphant')
    expect(moodsFor({ topic: 'dealer_accept' })[0]).toBe('triumphant')
    expect(moodsFor({ topic: 'new_page' })[0]).toBe('eager')
    expect(moodsFor({ topic: 'denied' })[0]).toBe('sarcastic')
    expect(moodsFor({ topic: 'fail' })[0]).toBe('sarcastic')
    expect(moodsFor({ topic: 'dealer_walk' })[0]).toBe('sarcastic')
    expect(moodsFor({ topic: 'hold' })[0]).toBe('calm')
    expect(moodsFor({ topic: 'doors_closed' })[0]).toBe('calm')
  })

  it('makes a rehearsal dry and a hurried stage eager', () => {
    expect(moodsFor({ topic: 'post', practice: true })[0]).toBe('sarcastic')
    expect(moodsFor({ topic: 'take', practice: true })[0]).toBe('sarcastic')
    expect(moodsFor({ topic: 'hold', busy: true })[0]).toBe('eager')
    expect(moodsFor({ topic: 'deal', busy: true })[0]).toBe('triumphant')
  })

  it('gets drier after a long silence, but only for the idle talk', () => {
    expect(moodsFor({ topic: 'tick', quietMs: BORED_AFTER_MS - 1 })[0]).toBe('calm')
    expect(moodsFor({ topic: 'hold', quietMs: BORED_AFTER_MS })[0]).toBe('sarcastic')
    expect(moodsFor({ topic: 'deal', quietMs: BORED_AFTER_MS * 3 })[0]).toBe('triumphant')
  })

  it('lets the second choice speak after the same tone twice running', () => {
    expect(moodsFor({ topic: 'post', recent: ['eager'] })[0]).toBe('eager')
    expect(moodsFor({ topic: 'post', recent: ['eager', 'eager'] })[0]).toBe('calm')
    expect(moodsFor({ topic: 'post', recent: ['eager', 'calm'] })[0]).toBe('eager')
  })
})
