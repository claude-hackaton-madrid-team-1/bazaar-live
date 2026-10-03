import { describe, expect, it } from 'vitest'
import { hrefOf, PATHS, ROUTES, routeOf } from './route'

describe('routeOf', () => {
  it('maps every screen path, with or without a trailing slash', () => {
    for (const r of ROUTES) {
      expect(routeOf(PATHS[r])).toBe(r)
      expect(routeOf(`${PATHS[r]}/`)).toBe(r)
    }
  })

  it('treats an unknown path as the show', () => {
    expect(routeOf('/nope')).toBe('show')
    expect(routeOf('')).toBe('show')
  })
})

describe('hrefOf', () => {
  it('keeps the shared parameters and drops the screen ones', () => {
    expect(hrefOf('market', '?mock=1&lang=en&id=61')).toBe('/market?mock=1&lang=en')
    expect(hrefOf('show', '?id=3')).toBe('/')
    expect(hrefOf('duels', '?lang=es&dealer=pilar&id=7')).toBe('/duels?lang=es')
    expect(hrefOf('album', '?token=x&team=t14')).toBe('/album?token=x')
    expect(hrefOf('debug', '')).toBe('/debug')
  })
})
