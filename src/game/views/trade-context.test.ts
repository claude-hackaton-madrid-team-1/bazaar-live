import { describe, expect, it } from 'vitest'
import type { DecisionRow, OutcomeRow } from '../decisions.ts'
import { apply, createState } from '../state.ts'
import { decisionFacts, offerFacts, outcomeFacts } from './trade-context.ts'
import { runsOf } from './decisions.ts'

const decision = (fields: Partial<DecisionRow> = {}): DecisionRow => ({
  eventId: -1, tick: 100, decision: 9, agent: 'maker', kind: 'post_ask', item: 'CHA-07', counterparty: null,
  price: 22, value: null, status: 'done', verdict: 'allowed', rule: null, text: null, jev: null, jevValue: null,
  method: 'list_offer', error: null, outcome: null, surplus: null, jevRight: null,
  trade: { side: 'sell', venue: 'rastro', offerId: 123, threadId: null, recipient: null }, ...fields,
})
const state = () => { const s = createState(); s.team = 't01'; return s }

describe('truthful trading identity and stages', () => {
  it('listing has no actual buyer; a venue owner is never a counterparty', () => {
    const s = state()
    s.venues.set('rastro', { id: 'rastro', name: 'El Rastro', owner: 't10', status: 'open', feeBps: 500, feePerCard: 1, openedTick: 0, seenTick: 100, announcement: null, announcements: 0 })
    expect(decisionFacts(s, decision())).toMatchObject({ stage: 'listed', seller: 't01', buyer: null, venue: 'rastro', openToAnyone: true })
  })
  it('an addressed bid names the intended seller, not the buyer', () => {
    const d = decision({ kind: 'post_bid', trade: { side: 'buy', venue: 'rastro', offerId: 22565, threadId: null, recipient: 't02' } })
    expect(decisionFacts(state(), d)).toMatchObject({ seller: 't02', buyer: 't01', openToAnyone: false, stage: 'listed' })
  })
  it.each(['proposed', 'approved'] as const)('%s is planned, never submitted or settled', (status) => {
    expect(decisionFacts(state(), decision({ status, method: null }))?.stage).toBe('planned')
  })
  it.each(['accept', 'accept_offer'])('%s successful request awaits settlement', (method) => {
    expect(decisionFacts(state(), decision({ kind: 'accept_bid', method }))?.stage).toBe('accepted')
  })
  it('a failed execution remains unconfirmed and missing legacy metadata remains unknown', () => {
    expect(decisionFacts(state(), decision({ status: 'failed', error: 'network' }))?.stage).toBe('failed')
    expect(decisionFacts(state(), decision({ trade: undefined }))).toMatchObject({ venue: null, buyer: null, openToAnyone: false })
  })
  it('confirmed settlement uses actual item transfer and venue, not venue ownership', () => {
    const s = state()
    apply(s, { id: 80861, type: 'settlement', tick: 101, payload: { settlement: 88, venue: 'rastro', price: 22, fee: 3, parties: ['t01', 't16'], items: [{ id: 1296, ref: 'CHA-07', frm: 't01', to: 't16' }] } })
    const o: OutcomeRow = { eventId: -2, tick: 101, target: 'trade', subject: 'settlement:88', decision: 9, agent: 'maker', item: 'CHA-07', counterparty: 't16', side: 'sell', price: 22, value: null, label: 'good', score: 2, surplus: 2, jev: null, jevRight: null }
    s.agents.outcomes.push(o)
    expect(outcomeFacts(s, o)).toMatchObject({ stage: 'settled', seller: 't01', buyer: 't16', venue: 'rastro' })
    expect(decisionFacts(s, decision())?.stage).toBe('settled')
    expect(outcomeFacts(s, { ...o, target: 'duel' })).toBeNull()
    expect(outcomeFacts(s, { ...o, target: 'dealer', price: null })?.stage).toBe('noDeal')
  })
  it('does not collapse rows from different venues or addressed recipients', () => {
    const a = decision()
    const b = decision({ decision: 10, tick: 101, trade: { ...a.trade!, venue: 'v07' } })
    const c = decision({ decision: 11, tick: 102, trade: { ...b.trade!, recipient: 't02' } })
    expect(runsOf([a, b, c])).toHaveLength(3)
  })
  it('open board offers preserve recipient and id', () => {
    expect(offerFacts({ id: 8, eventId: 9, venue: 'v07', maker: 't01', to: 't02', side: 'ask', ref: 'CHA-07', kind: 'card', assetIds: [1], wantAssetIds: [], serial: 1, price: 22, createdTick: 1, expiresTick: 20 })).toMatchObject({ seller: 't01', buyer: 't02', offerId: 8, stage: 'listed' })
  })
})
