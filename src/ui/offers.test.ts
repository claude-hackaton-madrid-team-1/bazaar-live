import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GameEvent } from '../game/state'
import { OffersTracker } from './offers'
import { OffersPanel } from './OffersPanel'

let id = 1
const event = (type: string, payload: GameEvent['payload'], tick = 100): GameEvent => ({ id: id++, type, payload, tick })
const hello = () => event('agent.hello', { team: 't01' })
const clock = (tick = 100) => event('clock', { tick_seconds: 15 }, tick)
const listed = (offer = 24412, venue = 'v05', maker = 't01', to: string | null = null) => event('offer.listed', { venue, offer: {
  id: offer, maker, to, venue, created_tick: 100, expires_tick: 110,
  give: { assets: [{ id: offer + 1, ref: 'RET-01', kind: 'card' }] }, want: { cash: 15 },
} })
const rows = (tracker: OffersTracker, events: GameEvent[], replay = false) => tracker.receive(events, replay, 1000).groups.flatMap((group) => group.rows)

describe('our offers beside the talking agents', () => {
  it('groups only our posted offers by their actual venue, including an addressed recipient', () => {
    const tracker = new OffersTracker()
    const view = tracker.receive([hello(), clock(), listed(), listed(24413, 'v15', 't01', 't18'), listed(99, 'v05', 't04')], true, 1000)
    expect(view.groups.map((group) => group.id)).toEqual(['v05', 'v15'])
    expect(view.groups.flatMap((group) => group.rows).map((row) => [row.id, row.to, row.status])).toEqual([[24412, null, 'open'], [24413, 't18', 'open']])
    expect(view.trades).toEqual([])
  })

  it('recovers offers outside replay history from the authoritative offers snapshot', () => {
    const tracker = new OffersTracker()
    const original = listed()
    expect(rows(tracker, [hello(), clock(), event('offers.ours', { offers: [{ ...original, hand: true }] })], true)[0]?.id).toBe(24412)
  })

  it('never calls a disappeared snapshot offer sold', () => {
    const tracker = new OffersTracker()
    rows(tracker, [hello(), clock(), listed()], true)
    expect(rows(tracker, [event('offers.ours', { offers: [] })])[0]?.status).toBe('unknown')
  })

  it('keeps equal-expiry ticks open and marks expired only after that tick', () => {
    const tracker = new OffersTracker()
    rows(tracker, [hello(), clock(), listed()], true)
    expect(rows(tracker, [clock(110)])[0]?.status).toBe('open')
    expect(rows(tracker, [clock(111)])[0]?.status).toBe('expired')
  })

  it('preserves an exact cancellation and clears stale history on reconnect', () => {
    const tracker = new OffersTracker()
    rows(tracker, [hello(), clock(), listed()], true)
    expect(rows(tracker, [event('offer.cancelled', { offer: 24412, venue: 'v05' })])[0]?.status).toBe('cancelled')
    expect(rows(tracker, [hello(), clock()], true)).toEqual([])
  })

  it('shows a real settlement separately without asserting which listing filled', () => {
    const tracker = new OffersTracker()
    const view = tracker.receive([hello(), clock(), listed(), event('settlement', {
      settlement: 9, kind: 'trade', parties: ['t01', 't18'], venue: 'v05', fee: 0, price: 15,
      items: [{ id: 24413, ref: 'RET-01', kind: 'card', frm: 't01', to: 't18' }],
    }, 101)], true, 1000)
    expect(view.groups[0]?.rows[0]?.status).toBe('unknown')
    expect(view.trades).toMatchObject([{ seller: 't01', buyer: 't18', venue: 'v05', price: 15 }])
  })

  it('does not render any private offer or settlement when locked or in replay', () => {
    const view = new OffersTracker().receive([hello(), clock(), listed()], true)
    for (const props of [{ status: 'locked' as const }, { status: 'live' as const, replay: true }]) {
      const html = renderToStaticMarkup(createElement(OffersPanel, { view, ...props }))
      expect(html).not.toContain('RET-01')
      expect(html).not.toContain('24412')
    }
    expect(renderToStaticMarkup(createElement(OffersPanel, { view, status: 'demo' }))).toContain('RET-01')
  })
})
