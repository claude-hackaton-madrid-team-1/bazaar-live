/** The Market Test panel renders the mock day beside our bench run (no browser: a crash or a lost part shows here). */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mockHistory } from '../history.ts'
import { MarketTestPanel } from './MarketTestPanel.tsx'

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const SCORE = { market: 7.5, mm_points: 0, bench_points: 0.5, bench_efficiency: 0.886, bench_venue: 'v19' }

describe('MarketTestPanel', () => {
  it('leads with our market against the leader, every level of the board, then our bench run and the venue note', () => {
    const h = mockHistory(400)
    const html = renderToString(createElement(MarketTestPanel, { board: h.board, us: 't01', score: SCORE }))
    const words = text(html)
    expect(words).toMatch(/Market Test/)
    expect(words).toMatch(/Nuestro mercado [\d,]+ · #\d+ de 18 · .+ va primero con/)
    expect(html).toMatch(/class="mt-level" data-us="true"/)
    expect(words).toContain('banco 0,5 · eficiencia 88,6 % · puesto v19 · creación de mercado 0')
    expect(words).toContain('nuestro puesto v19 muestre 0 operaciones')
  })

  it('renders nothing with neither a board nor a bench run', () => {
    expect(renderToString(createElement(MarketTestPanel, { board: [], us: 't01', score: {} }))).toBe('')
  })
})
