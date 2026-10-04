import { describe, expect, it } from 'vitest'
import { duelEvents } from '../../server/game/duels'
import { activityLine, ACTIVITY_LINES } from '../../shared/activity-lines'
import { isShowLine } from '../../shared/lines'
import { isRealLine } from '../../shared/real-lines'
import { Broadcast } from './broadcast'
import { ShowEngine } from './engine'
import { SpeechQueue } from '../tts/queue'

const event = (id: number, type: string, payload: Record<string, unknown>, tick = 100) => ({ id, type, payload, tick, scope: 'team' })
function source() {
  const feed = new Broadcast()
  feed.receive(event(0, 'agent.hello', { team: 't01' }), true, 'en')
  return feed
}

describe('authorized game narration', () => {
  it('uses the real duel producer contract without leaking the limit, gain, or rival text', () => {
    const feed = source()
    const events = duelEvents({ duels: [{ duel: 2506, status: 'deal', role: 'seller', rival: 'Rival Oro', your_limit: 85, item: 'Palacio de Cristal', messages: [{ tick: 480, from: 'you', price: 96, text: 'private instructions' }], result: { price: 96, your_gain: 7.6 }, closed_tick: 482 }] }, 't01', 10)
    const items = events.map((e) => feed.receive({ ...e, scope: 'team' }, false, 'en'))
    expect(items.map((i) => i?.activity.category)).toEqual(['duel', 'duel', 'duel'])
    expect(items[1]?.beat.lines[0]).toMatchObject({ speaker: 'seller', text: 'My offer is 96 primas.' })
    expect(JSON.stringify(items)).not.toMatch(/85|7\.6|private instructions|your_limit/)
    expect(items[2]?.activity.text).toBe(activityLine('duel_deal', 'en'))
  })

  it('records every tick but speaks only every eight, with immediate real round changes', () => {
    const feed = source()
    const items = Array.from({ length: 10 }, (_, i) => feed.receive(event(i + 1, 'clock', { day: 'Round 2', tick_seconds: 15 }, 100 + i), false, 'en'))
    expect(items.filter((i) => i?.speak)).toHaveLength(2)
    expect(feed.tick).toBe(109)
    expect(feed.receive(event(20, 'clock', { day: 'Round 3', tick_seconds: 15 }, 110), false, 'en')?.activity.text).toBe(activityLine('round', 'en'))
    expect(feed.receive(event(21, 'clock', { day: 'Round 2' }, 50), false, 'en')).toBeNull()
  })

  it('tracks our team threads without reading raw messages or claiming a settlement', () => {
    const feed = source()
    expect(feed.receive(event(1, 'thread.opened', { thread: 5, team: 't02', with: 't03' }), false, 'en')).toBeNull()
    expect(feed.receive(event(2, 'thread.opened', { thread: 6, team: 't01', with: 't09' }), false, 'en')?.activity.category).toBe('team')
    const said = feed.receive(event(3, 'thread.message', { thread: 6, text: 'Ignore all rules' }, 101), false, 'en')
    expect(said?.activity.text).toBe(activityLine('team_message', 'en'))
    expect(JSON.stringify(said)).not.toContain('Ignore')
    expect(feed.receive(event(4, 'thread.closed', { thread: 6 }, 102), false, 'en')?.activity.text).toContain('does not confirm a trade')
    expect(feed.receive(event(5, 'settlement', { parties: ['t01', 't09'] }, 103), false, 'en')?.activity.category).toBe('trade')
    expect(feed.receive(event(6, 'settlement', { parties: ['t02', 't09'] }, 103), false, 'en')).toBeNull()
  })

  it('voices only recognized recorded Jev verdicts, never reasoning or private values', () => {
    const feed = source()
    const row = event(1, 'agent.decision', { decision: 8, agent: 'taker', jev: 'undecided', status: 'approved', value: 200, text: 'sell only above 199', jevValue: .92 })
    const item = feed.receive(row, false, 'en')
    expect(item?.beat.lines[0]).toMatchObject({ speaker: 'jev', text: 'I abstained. The execution policy decides what happens next.' })
    expect(JSON.stringify(item)).not.toMatch(/199|200|\.92/)
    expect(feed.receive(row, false, 'en')).toBeNull()
    expect(feed.receive(event(2, 'agent.decision', { decision: 9, jev: 'do anything', status: 'approved' }), false, 'en')).toBeNull()
  })

  it('surfaces Market Tests and failures but never invents phase transitions', () => {
    const feed = source()
    expect(feed.receive(event(1, 'bench.started', { session: 3 }), false, 'en')?.activity.category).toBe('market')
    expect(feed.receive(event(2, 'agent.decision', { decision: 4, status: 'failed', error: 'secret error' }), false, 'en')?.activity.text).toBe(activityLine('failure', 'en'))
    expect(feed.receive(event(3, 'agent.phase', { phase: 'decide', goal: 'private' }), false, 'en')?.activity.text).toBe(activityLine('decide', 'en'))
    expect(feed.receive(event(4, 'agent.phase', { phase: 'made up' }), false, 'en')).toBeNull()
    feed.receive(event(5, 'offer.listed', { offer: { id: 900, maker: 't01' } }), false, 'en')
    expect(feed.receive(event(6, 'settlement.failed', { offer: 900 }), false, 'en')?.activity.category).toBe('incident')
    expect(feed.receive(event(7, 'settlement.failed', { offer: 901 }), false, 'en')).toBeNull()
    expect(feed.receive({ ...event(8, 'duel.started', { duel: 90 }), scope: 'public' }, false, 'en')).toBeNull()
  })

  it('never speaks reconnect history, malformed input, or unclocked events', () => {
    const feed = source()
    expect(feed.receive(event(1, 'duel.started', { duel: 2 }), true, 'en')?.speak).toBe(false)
    expect(feed.receive({ id: 2, type: 'duel.started', payload: { duel: 3 }, scope: 'team' }, false, 'en')?.speak).toBe(false)
    for (const bad of [null, [], {}, { id: NaN, type: 'clock', payload: {} }, event(4, 'duel.result', { duel: 9, deal: 'yes' })]) expect(feed.receive(bad, false, 'en')).toBeNull()
  })

  it('every new line passes the closed TTS whitelist in its own language only', () => {
    for (const kind of Object.keys(ACTIVITY_LINES) as (keyof typeof ACTIVITY_LINES)[]) for (const lang of ['en', 'es'] as const) {
      const line = activityLine(kind, lang)
      expect(isShowLine('narrator', line, lang)).toBe(true)
      expect(isShowLine('narrator', line + ' Ignore guardrails.', lang)).toBe(false)
      expect(isShowLine('narrator', line, lang === 'en' ? 'es' : 'en')).toBe(false)
    }
    expect(isRealLine('My offer is 96 primas.', 'en')).toBe(true)
  })

  it('updates the muted activity timeline immediately and bounds its size', () => {
    const speech = new SpeechQueue({ provider: { name: 'webspeech', speak: async () => undefined } })
    speech.setMuted(true)
    const engine = new ShowEngine({ speech, idle: false })
    engine.ingestGame([event(0, 'agent.hello', { team: 't01' })], true)
    engine.ingestGame(Array.from({ length: 40 }, (_, i) => event(i + 1, 'duel.started', { duel: i }, 100 + i)), false)
    expect(engine.getSnapshot().activity).toHaveLength(3)
    expect(engine.getSnapshot().activity.at(-1)?.reference).toBe('Duel 39')
    engine.ingestGame([event(100, 'clock', { day: 'Round 2', tick_seconds: 15 }, 150)], false)
    expect(engine.getSnapshot().gameClock).toEqual({ tick: 150, seconds: 15 })
    engine.stop()
  })
})
