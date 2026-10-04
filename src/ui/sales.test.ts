import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OffersTracker } from './offers'
import { SalesPanel } from './SalesPanel'
import type { GameEvent } from '../game/state'

let id = 1000
const event = (type: string, payload: GameEvent['payload']): GameEvent => ({ id: id++, type, payload, tick: 200 })
const conversation = () => new OffersTracker().receive([
  event('agent.hello', { team: 't01' }),
  event('thread.opened', { thread: 44, kind: 'team', team: 't01', with: 't18', venue: 'v28' }),
  event('agent.decision', { decision: 9, agent: 'sales', status: 'done', kind: 'team_open', trade: { threadId: 44 } }),
  event('thread.message', { thread: 44, sender: 't01', text: 'I can exchange my Retiro card.', offer: { maker: 't01', give: { assets: [{ ref: 'RET-01' }] }, want: { types: ['card:LAT-02'], cash: 3 }, expires_tick: 205 } }),
  event('thread.message', { thread: 44, sender: 't18', text: '<script>not executed</script>' }),
  event('thread.message', { thread: 44, sender: 't01' }),
  event('thread.closed', { thread: 44 }),
], true).conversations

describe('Sales conversations in the existing protected feed', () => {
  it('retains the observed speaker, counterpart, venue, words and both swap legs', () => {
    const threads = conversation()
    expect(threads[0]).toMatchObject({ sales: true, with: 't18', venue: 'v28', status: 'closed' })
    expect(threads[0]?.messages.map((m) => [m.ours, m.text])).toEqual([[true, 'I can exchange my Retiro card.'], [false, 'not executed'], [true, null]])
    const html = renderToStaticMarkup(createElement(SalesPanel, { threads, status: 'live' }))
    for (const word of ['Ventas', 't18', 'v28', 'RET-01', 'LAT-02', '3 P', 'no confirma venta', 'no incluye']) expect(html).toContain(word)
    expect(html).not.toContain('<script>')
  })
  it('enriches the original missing message without duplicating its offer', () => {
    const tracker = new OffersTracker()
    const original = event('thread.message', { thread: 44, sender: 't01', text: null })
    tracker.receive([event('agent.hello', { team: 't01' }), event('thread.opened', { thread: 44, team: 't01', with: 't18' }), original], true)
    const view = tracker.receive([event('thread.message.quote', { ...original.payload, feed_id: original.id, text: 'I can exchange this card.' })], false)
    expect(view.conversations[0]?.messages).toHaveLength(1)
    expect(view.conversations[0]?.messages[0]?.text).toBe('I can exchange this card.')
  })
  it('hides private conversations while locked or showing replay', () => {
    for (const props of [{ status: 'locked' as const }, { status: 'live' as const, replay: true }]) expect(renderToStaticMarkup(createElement(SalesPanel, { threads: conversation(), ...props }))).toBe('')
  })
})
