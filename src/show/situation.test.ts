import { describe, expect, it } from 'vitest'
import type { AgentHealth } from '../model/events'
import { doorsFacts, madridParts, situationOf, type Narration } from './situation'

const health = (patch: Partial<AgentHealth> = {}): AgentHealth => ({
  ok: true, agent: 'taker', mode: 'live', tick: 160, doors: 'open', paused: false, nextOpens: null, tickSeconds: 30, serverTick: 160, target: 'real', ...patch,
})

// Saturday 2026-10-03, 07:25 in Madrid (CEST, +02:00)
const NOW = Date.parse('2026-10-03T07:25:00+02:00')

const narration = (patch: Partial<Narration> = {}): Narration => ({
  health: { taker: health(), maker: health({ agent: 'maker' }) },
  feeds: { taker: 'open', maker: 'open' },
  now: NOW,
  tick: 160,
  freshHood: null,
  freshMarketTest: false,
  ...patch,
})

describe('madridParts', () => {
  it('reads the wall clock in Madrid, not in the machine', () => {
    expect(madridParts(Date.parse('2026-10-03T09:00:00+02:00'))).toEqual({ day: '2026-10-03', weekday: 6, hour: 9, minute: 0 })
    // 23:30 UTC on Saturday is already Sunday 01:30 in Madrid (summer time).
    expect(madridParts(Date.parse('2026-10-03T23:30:00Z'))).toEqual({ day: '2026-10-04', weekday: 0, hour: 1, minute: 30 })
    expect(madridParts(Number.NaN)).toBeNull()
  })
})

describe('doorsFacts', () => {
  it('counts down to the open and says when, in each language', () => {
    const h = health({ doors: 'closed', nextOpens: '2026-10-03T09:00:00+02:00' })
    expect(doorsFacts(h, NOW, 'es')).toEqual({ eta: '95 minutos', opens: 'hoy a las 9:00' })
    expect(doorsFacts(h, NOW, 'en')).toEqual({ eta: '95 minutes', opens: 'today at 9:00' })
  })

  it('says tomorrow or the weekday when the opening is not today', () => {
    expect(doorsFacts(health({ nextOpens: '2026-10-04T09:00:00+02:00' }), NOW, 'es')).toEqual({ eta: '25 horas', opens: 'mañana a las 9:00' })
    expect(doorsFacts(health({ nextOpens: '2026-10-05T10:30:00+02:00' }), NOW, 'en').opens).toBe('on Monday at 10:30')
  })

  it('has no countdown when the opening is unknown or already past', () => {
    expect(doorsFacts(health({ nextOpens: null }), NOW, 'es')).toEqual({ eta: null, opens: null })
    expect(doorsFacts(health({ nextOpens: '2026-10-03T07:00:00+02:00' }), NOW, 'es')).toEqual({ eta: null, opens: null })
    expect(doorsFacts(health({ nextOpens: 'soon' }), NOW, 'es')).toEqual({ eta: null, opens: null })
  })
})

describe('situationOf: what the stage talks about when nothing is happening', () => {
  it('knows the doors are closed, and when they open', () => {
    const closed = health({ doors: 'closed', paused: true, nextOpens: '2026-10-03T09:00:00+02:00' })
    expect(situationOf(narration({ health: { taker: closed, maker: closed } }), 'es', 0)).toEqual({ topic: 'doors_closed', eta: '95 minutos', opens: 'hoy a las 9:00' })
    expect(situationOf(narration({ health: { taker: closed, maker: null } }), 'en', 3)).toMatchObject({ topic: 'doors_closed', eta: '95 minutes' })
  })

  it('closed doors win over a pause, and a pause over the ambient talk', () => {
    const closed = health({ doors: 'closed', paused: true })
    expect(situationOf(narration({ health: { taker: closed, maker: closed } }), 'es', 0).topic).toBe('doors_closed')
    const paused = health({ paused: true })
    expect(situationOf(narration({ health: { taker: paused, maker: health() } }), 'es', 0).topic).toBe('paused')
  })

  it('is offline only when nobody is reachable at all', () => {
    expect(situationOf(narration({ health: { taker: null, maker: null }, feeds: { taker: 'reconnecting', maker: 'reconnecting' } }), 'es', 0).topic).toBe('offline')
    expect(situationOf(narration({ health: { taker: null, maker: null }, feeds: { taker: 'open', maker: 'reconnecting' } }), 'es', 0).topic).not.toBe('offline')
  })

  it('announces a new page or a Market Test session before anything else', () => {
    expect(situationOf(narration({ freshHood: 'El Retiro' }), 'es', 0)).toEqual({ topic: 'new_page', hood: 'El Retiro' })
    expect(situationOf(narration({ freshMarketTest: true }), 'es', 0).topic).toBe('market_test')
    expect(situationOf(narration({ freshHood: 'Chamberí', freshMarketTest: true }), 'es', 0).topic).toBe('new_page')
    const closed = health({ doors: 'closed', paused: true })
    expect(situationOf(narration({ health: { taker: closed, maker: closed }, freshHood: 'El Retiro' }), 'es', 0).topic).toBe('new_page')
  })

  it('takes turns between the ambient things so it never says the same kind of thing twice', () => {
    const topics = [0, 1, 2, 3, 4, 5].map((turn) => situationOf(narration(), 'es', turn).topic)
    expect(topics).toEqual(['quiet', 'tick', 'quiet', 'tick', 'quiet', 'tick'])
  })

  it('mentions a dry run and the simulator when that is what is going on', () => {
    const dry = health({ mode: 'dry', target: 'simulator' })
    const topics = new Set([0, 1, 2, 3].map((turn) => situationOf(narration({ health: { taker: dry, maker: dry } }), 'es', turn).topic))
    expect(topics).toEqual(new Set(['quiet', 'tick', 'dry', 'simulator']))
  })

  it('skips the tick talk before any tick was seen', () => {
    const topics = new Set([0, 1, 2].map((turn) => situationOf(narration({ tick: null }), 'es', turn).topic))
    expect(topics).toEqual(new Set(['quiet']))
  })
})
