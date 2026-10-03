import { describe, expect, it } from 'vitest'
import { EMPTY_STRATEGY } from '../../shared/strategy.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { startStrategy } from './start.ts'

describe('startStrategy', () => {
  it('without the shared pool it is off and opens nothing of its own', () => {
    const strategy = startStrategy({ SHOW_DATABASE_URL: 'postgres://u:p@h/db', GAME_VIEW_TOKEN: ' secret ' }, () => undefined, null)
    expect(strategy.enabled()).toBe(false)
    expect(strategy.snapshot()).toBe(EMPTY_STRATEGY)
    expect(strategy.token).toBe('secret')
  })

  it('reads on the shared pool and never ends it', async () => {
    const queries: string[] = []
    let ended = false
    const shared: SharedShowPool = {
      pool: { query: (sql) => (queries.push(sql), Promise.resolve({ rows: [] })), end: () => ((ended = true), Promise.resolve()) },
      secrets: [],
    }
    const strategy = startStrategy({}, () => undefined, shared)
    expect(strategy.enabled()).toBe(true)
    expect(strategy.token).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    strategy.stop()
    expect(queries.length).toBeGreaterThan(0)
    expect(ended).toBe(false)
  })
})
