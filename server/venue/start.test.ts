import { describe, expect, it } from 'vitest'
import { EMPTY_VENUE } from '../../shared/venue.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { startVenue } from './start.ts'

describe('startVenue', () => {
  it('without the shared pool it is off and opens nothing of its own', () => {
    const venue = startVenue({ SHOW_DATABASE_URL: 'postgres://u:p@h/db', GAME_VIEW_TOKEN: ' secret ' }, () => undefined, null)
    expect(venue.enabled()).toBe(false)
    expect(venue.snapshot()).toBe(EMPTY_VENUE)
    expect(venue.token).toBe('secret')
  })

  it('reads on the shared pool and never ends it', async () => {
    const queries: string[] = []
    let ended = false
    const shared: SharedShowPool = {
      pool: { query: (sql) => (queries.push(sql), Promise.resolve({ rows: [] })), end: () => ((ended = true), Promise.resolve()) },
      secrets: [],
    }
    const venue = startVenue({}, () => undefined, shared)
    expect(venue.enabled()).toBe(true)
    expect(venue.token).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    venue.stop()
    expect(queries.length).toBeGreaterThan(0)
    expect(ended).toBe(false)
  })
})
