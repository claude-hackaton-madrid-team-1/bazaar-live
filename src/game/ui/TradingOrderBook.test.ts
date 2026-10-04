import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { TradingOrderBook } from './TradingOrderBook.tsx'
import type { TradingBook } from '../views/market.ts'

it('labels provenance, exact order identity, own orders and unknown freshness in both languages', () => {
  const book: TradingBook = { excluded: 2, ladders: [{ key: 'v15:LAT-01', venue: 'v15', venueName: 'Mercado quince', venueStatus: 'open', venueOwner: 't15', ref: 'LAT-01', spread: null,
    bids: [{ id: 42, eventId: 9, maker: 't01', ours: true, quantity: 1, price: 10, expiresTick: null, to: null, assetIds: [], wantAssetIds: [] }], asks: [] }] }
  for (const lang of ['es', 'en'] as const) {
    const html = renderToString(createElement(TradingOrderBook, { book, lang, tick: 2000, stale: true, mock: false }))
    expect(html).toContain('LAT-01')
    expect(html.replace(/<!--.*?-->/g, '')).toContain('#42')
    expect(html).toContain('v15')
    expect(html).toContain('400')
    expect(html).toContain('role="status"')
    expect(html).toContain('data-ours="true"')
    expect(html).toContain(lang === 'es' ? 'Caducidad desconocida' : 'Expiry unknown')
    expect(html).toContain(lang === 'es' ? 'Sin órdenes en este lado.' : 'No orders on this side.')
  }
})

it('renders an honest empty book without inventing a spread or price', () => {
  const html = renderToString(createElement(TradingOrderBook, { book: { ladders: [], excluded: 0 }, lang: 'es', tick: 0, stale: true, mock: false }))
  expect(html).toContain('Sin órdenes observadas para esta selección.')
  expect(html).not.toContain('<tbody>')
})
