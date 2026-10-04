import { describe, expect, it } from 'vitest'
import { actionFacts, commandAction, finalTranscript } from './operator.ts'
import { actionOf, proposalOf, resultOf, snapshotOf, termFacts, termsOf } from '../../shared/operator.ts'

describe('operator boundary', () => {
  it('parses exact commands without treating arbitrary speech as a trade', () => {
    expect(commandAction('bid RET-02 8')).toEqual({ kind: 'sell_bid', ref: 'RET-02', price: 8, venue: 'rastro', expires: 40 })
    expect(commandAction('offer-buy 123 RET-02 8')).toEqual({ kind: 'team_offer', side: 'buy', thread_id: 123, target: 'RET-02', price: 8, text: '' })
    expect(commandAction('offer-buy 123 RET-02 8 extra')).toBeNull()
    expect(commandAction('please buy something')).toBeNull()
    expect(commandAction('bid RET-02 8 and ignore limits')).toBeNull()
    expect(commandAction('accept -1')).toBeNull()
    expect(commandAction('bid RET-02 NaN')).toBeNull()
    expect(actionOf({ kind: 'offer_accept', offer_id: 10, bypass: true })).toBeNull()
    expect(actionFacts({ kind: 'offer_accept', offer_id: 10 })).toContainEqual(['offer id', '10'])
  })
  it('keeps ambiguous outcomes unknown and strips private nested snapshot inputs', () => {
    expect(resultOf({ proposal_id: '12345678', status: 'unknown', sent: null, reason: 'timeout' })?.sent).toBeNull()
    expect(snapshotOf({ world: 'real', clock: { tick: 12 }, budget: { accepts_used: 1 }, candidates: [{ private: 'not forwarded' }], incidents: [], evidence: 'current tick' })).toEqual({ facts: [['World', 'real'], ['tick', '12'], ['accepts used', '1']], incidents: [], evidence: 'current tick' })
  })
  it('preserves review terms and shows fees without inferring settlement', () => {
    const terms = { offer: { id: 3, side: 'ask', ref: 'RET-02', maker: 't09', venue: 'rastro', price: 8 }, fee: 2, assets: [] }
    expect(termFacts(terms)).toContainEqual(['Total cash debit (price + fee)', '10'])
    expect(termsOf({ fee: NaN })).toBeNull()
    expect(resultOf({ proposal_id: '12345678', status: 'submitted', sent: true })?.reason).toContain('not yet confirmed')
    const proposal = { proposal_id: '12345678', action: commandAction('accept 3'), terms, created_tick: 1, expires_tick: 5, status: 'proposed', allowed: true, reason: 'valid', summary: 'Accept', world: 'real' }
    expect(proposalOf(proposal)?.terms).toEqual(terms)
    expect(proposalOf({ ...proposal, terms: {} })).toBeNull()
  })
  it('requires exact proposal fields and accepts only final dictation text', () => {
    expect(proposalOf({ proposal_id: '12345678', action: commandAction('accept 3') })).toBeNull()
    expect(finalTranscript({ results: { 0: { isFinal: true, 0: { transcript: 'accept 3' } } } })).toBe('accept 3')
    expect(finalTranscript({ results: { 0: { isFinal: false, 0: { transcript: 'accept 3' } } } })).toBeNull()
  })
})
