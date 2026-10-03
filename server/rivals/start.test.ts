import { describe, expect, it } from 'vitest'
import { EMPTY_RIVALS } from '../../shared/rivals.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { startRivals } from './start.ts'

describe('startRivals', () => {
  it('without the shared pool it is off and opens nothing of its own', () => {
    const rivals = startRivals({ SHOW_DATABASE_URL: 'postgres://u:p@h/db', GAME_VIEW_TOKEN: ' secret ' }, () => undefined, null)
    expect(rivals.enabled()).toBe(false)
    expect(rivals.snapshot()).toBe(EMPTY_RIVALS)
    expect(rivals.token).toBe('secret')
  })

  it('reads on the shared pool and never ends it', async () => {
    const queries: string[] = []
    let ended = false
    const shared: SharedShowPool = {
      pool: { query: (sql) => (queries.push(sql), Promise.resolve({ rows: [] })), end: () => ((ended = true), Promise.resolve()) },
      secrets: [],
    }
    const rivals = startRivals({}, () => undefined, shared)
    expect(rivals.enabled()).toBe(true)
    expect(rivals.token).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    rivals.stop()
    expect(queries.length).toBeGreaterThan(0)
    expect(ended).toBe(false)
  })
})
