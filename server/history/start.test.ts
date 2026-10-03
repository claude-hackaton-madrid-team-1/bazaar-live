import { describe, expect, it } from 'vitest'
import { EMPTY_HISTORY } from '../../shared/history.ts'
import type { SharedShowPool } from '../transcript/pg.ts'
import { startHistory } from './start.ts'

describe('startHistory', () => {
  it('without the shared pool it is off and opens nothing of its own', () => {
    const history = startHistory({ SHOW_DATABASE_URL: 'postgres://u:p@h/db', GAME_VIEW_TOKEN: ' secret ' }, () => undefined, null)
    expect(history.enabled()).toBe(false)
    expect(history.snapshot()).toBe(EMPTY_HISTORY)
    expect(history.token).toBe('secret')
  })

  it('reads on the shared pool and never ends it', async () => {
    const queries: string[] = []
    let ended = false
    const shared: SharedShowPool = {
      pool: { query: (sql) => (queries.push(sql), Promise.resolve({ rows: [] })), end: () => ((ended = true), Promise.resolve()) },
      secrets: [],
    }
    const history = startHistory({}, () => undefined, shared)
    expect(history.enabled()).toBe(true)
    expect(history.token).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    history.stop()
    expect(queries.length).toBeGreaterThan(0)
    expect(ended).toBe(false)
  })
})
