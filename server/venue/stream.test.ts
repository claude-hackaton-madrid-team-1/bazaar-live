import { assert, test } from 'vitest'
import { EMPTY_VENUE, type OurVenue, type VenueSnapshot } from '../../shared/venue.ts'
import type { GameEvent } from '../game/relay.ts'
import { FIRST_VENUES_ID, VenuesStream } from './stream.ts'

const venue = (over: Partial<OurVenue> = {}): OurVenue => ({
  venue: 'v19', name: 'Team 1 market', mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open', openedTick: 262, current: true, counted: true, ...over,
})
const snap = (venues: readonly OurVenue[], read = true): VenueSnapshot => ({ ...EMPTY_VENUE, parts: { ...EMPTY_VENUE.parts, venues: read }, venues })

test('venues.ours: sent when our venues change, never again for the same list, only public venue facts', () => {
  const sent: GameEvent[] = []
  const stream = new VenuesStream({ publishStatus: (e) => sent.push(e) }, () => undefined)
  stream.update(snap([], false))
  assert.equal(sent.length, 0, 'the view not read yet says nothing')
  stream.update(snap([venue(), venue({ venue: 'v02', status: null, current: false, counted: false })]))
  stream.update(snap([venue()]))
  assert.equal(sent.length, 1, 'the same list (a stall with no status left out) is not sent twice')
  assert.deepEqual([sent[0]?.id, sent[0]?.type, sent[0]?.scope], [FIRST_VENUES_ID, 'venues.ours', 'team'])
  assert.deepEqual(sent[0]?.payload, { venues: [{ venue: 'v19', name: 'Team 1 market', mechanism: 'board', feeBps: 0, feePerCard: 0, status: 'open', openedTick: 262 }] })
  stream.update(snap([venue({ status: 'closing' })]))
  assert.deepEqual([sent.length, sent[1]?.id], [2, FIRST_VENUES_ID - 1])
})

test('venues.ours: a failed publish is logged by name and tried again on the next read', () => {
  const logs: Record<string, unknown>[] = []
  let fail = true
  const sent: GameEvent[] = []
  const stream = new VenuesStream({ publishStatus: (e) => { if (fail) throw new TypeError('boom'); sent.push(e) } }, (l) => logs.push(l))
  stream.update(snap([venue()]))
  assert.deepEqual(logs, [{ route: 'venue', event: 'publish_failed', message: 'TypeError' }])
  fail = false
  stream.update(snap([venue()]))
  assert.equal(sent.length, 1)
})
