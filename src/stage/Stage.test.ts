import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ShowEngine } from '../show/engine'
import { SpeechQueue } from '../tts/queue'
import { Stage } from './Stage'

const empty = () => new ShowEngine({ speech: new SpeechQueue({ provider: { name: 'webspeech', speak: async () => {} } }), idle: false }).getSnapshot()

describe('permanent Sales lead', () => {
  it('keeps all three orbs present even without authorised feed data', () => {
    const html = renderToStaticMarkup(createElement(Stage, { state: { ...empty(), broadcastStatus: 'locked' } }))
    expect(html.match(/class="voice lead"/g)).toHaveLength(3)
    expect(html).toContain('aria-label="Agente de ventas"')
    expect(html).toContain('protegido')
    expect(html).toContain('coordinadas con Maker')
  })
  it('routes acknowledged Sales identity to its orb and caption without animating Maker', () => {
    const html = renderToStaticMarkup(createElement(Stage, { state: { ...empty(), line: { speaker: 'seller', dealer: 'sales', text: 'Nuestra oferta pública está disponible.', lang: 'es' }, broadcastStatus: 'live' } }))
    expect(html).toContain('data-voice="sales" data-pose="haggle" data-talking="true"')
    expect(html).toContain('data-voice="seller" data-pose="idle"')
    expect(html).not.toContain('data-voice="seller" data-pose="idle" data-talking="true"')
    expect(html).toContain('class="caption glass" data-voice="sales"')
  })
})
