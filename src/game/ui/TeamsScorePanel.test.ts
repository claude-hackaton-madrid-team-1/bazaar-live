/** The "every team's score" panel renders the mock day (no browser: a crash or a lost part shows here), and its words. */
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mockHistory } from '../history.ts'
import { TEAMS_STRINGS, signedGap } from '../teamsStrings.ts'
import { TeamsScorePanel } from './TeamsScorePanel.tsx'

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

describe('TeamsScorePanel', () => {
  it('leads with the answer, then the gap table, every team to follow and both charts', () => {
    const h = mockHistory(400)
    const html = renderToString(createElement(TeamsScorePanel, { board: h.board, marks: h.marks, us: 't01' }))
    const words = text(html)
    expect(words).toMatch(/Puntos de todos los equipos 18 equipos/)
    expect(words).toMatch(/ganamos/i)
    expect(words).toContain('vs la media')
    expect(words).toContain('no puntúa')
    expect(html.match(/class="ts-chip"/g)).toHaveLength(18)
    expect(html.match(/<svg/g)).toHaveLength(2)
  })

  it('says so when the board has no read of the day or none of ours', () => {
    expect(text(renderToString(createElement(TeamsScorePanel, { board: [], marks: [], us: 't01' })))).toContain('Todavía no hay lecturas')
    const h = mockHistory(400)
    expect(text(renderToString(createElement(TeamsScorePanel, { board: h.board, marks: [], us: 't99' })))).toContain('Todavía no estamos')
  })
})

describe('the headline', () => {
  const name = (team: string) => `Equipo ${team.slice(1)}`
  it('says where they beat us and where we beat them, and how far the leader is', () => {
    const h = { worst: { part: 'market', gap: -3.17 }, best: { part: 'negotiating', gap: 1.67, scored: true }, leader: { team: 't5', part: 'market', gap: -5 } } as const
    expect(TEAMS_STRINGS.es.headline(h, name)).toBe('Nos ganan sobre todo en creación de mercado (−3.17 vs la media); ganamos en negociación (+1.67). El líder, Equipo 5, nos saca 5 en creación de mercado.')
    expect(TEAMS_STRINGS.en.headline({ ...h, leader: null }, name)).toBe('They beat us most in market-making (−3.17 vs the average); we beat them in negotiation (+1.67).')
  })

  it('marks a lead that scores nothing, and the level case', () => {
    expect(TEAMS_STRINGS.es.headline({ worst: { part: 'negotiating', gap: -2 }, best: { part: 'pages', gap: 1.5, scored: false }, leader: null }, name)).toContain('páginas completas (+1.5, no puntúa)')
    expect(TEAMS_STRINGS.es.headline({ worst: null, best: null, leader: null }, name)).toBe('A la par de la media en todo lo que puntúa.')
    expect(signedGap(-0.004)).toBe('0')
  })
})
