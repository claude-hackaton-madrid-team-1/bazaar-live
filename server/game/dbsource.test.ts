import { afterEach, describe, expect, it, vi } from 'vitest'
import { DB_SQL, dayOf, duelRowEvents, feedRowEvent, GameDbSource, meRow } from './dbsource.ts'
import { duelEventId } from './duels.ts'
import { GameHub, type GameEvent } from './relay.ts'
import { startGame } from './start.ts'

afterEach(() => vi.unstubAllGlobals())

// Rows as the views return them on the production data (2026-10-03), trimmed; pg hands bigint over as text.
const FEED = [
  { id: '10940', tick: 160, type: 'round.started', actor: '', payload: { name: 'Saturday · Gran Vía', reset: false, round: 2, weight: 1.0 } },
  { id: 21154, tick: 401, type: 'offer.listed', actor: 't04', payload: { offer: { id: 6152, to: null, give: { cash: 0, types: [], assets: [{ id: 197, ref: 'LAT-03' }] }, want: { cash: 30, types: [] } } } },
  { id: 21155, tick: 401, type: 'thread.message', actor: 't01', payload: { team: 't01', with: 'abuela', sender: 'abuela', thread: 574, text: 'Ay, cariño' } },
]

const ME = {
  tick: 401, tick_seconds: 30, stamp: '2026-10-03T09:30:17.123456Z',
  me: {
    id: 't01', name: 'Team 1', cash: 176,
    score: { score: 23.14, rank: 6, deals: 17, duel_points: 0, ladder_points: 0.009, neg_points: 18.5, mm_points: 0, bench_points: null, luck_private: 9 },
    album: { pages: [{ set: 'LAV', name: 'Lavapiés', have: 8, of: 10, complete: false, master: false }] },
    assets: [{ id: 1, kind: 'card', ref: 'SAL-03', serial: 1, your_value: 3.2, print_run: 300 }],
    affinity: { LAV: 1.4 }, collection_value: 999, starter_broker_key: 'sk-never',
  },
}

const DUEL_DEAL = {
  duel: 274, session: 1, tick: 367, status: 'deal', role: 'buyer', item: 'Plaza de Olavide', rival: 'Rival Rojo', deadline_tick: 163, price: 103, days: 0,
  your_limit: 136, rounds: 2, decay_per_round: 0.06, result: 29.2,
  stamp: '2026-10-03T09:13:30.000001Z',
  messages: [{ from: 'you', tick: 151, price: 59, days: null }, { from: 'Rival Rojo', tick: 151, price: 154, days: null }, { from: 'Rival Rojo', tick: 152, price: 103, days: null }],
}

const DUEL_NO_DEAL = {
  duel: 280, session: 1, tick: 367, status: 'no_deal', role: 'buyer', item: 'El Rastro al Amanecer', rival: 'Rival Noche', deadline_tick: 176, price: null, days: null,
  your_limit: 61, rounds: 0, decay_per_round: 0.06, result: '0',
  stamp: '2026-10-03T09:13:30.000001Z', messages: [{ from: 'you', tick: 164, price: 42, days: null }],
}

describe('row translation', () => {
  it('passes a feed row through as a public event, with a numeric id', () => {
    expect(feedRowEvent(FEED[0])).toEqual({ id: 10940, tick: 160, type: 'round.started', scope: 'public', actor: '', payload: FEED[0]?.payload })
    expect(feedRowEvent({ id: 'x', type: 'a' })).toBeNull()
    expect(feedRowEvent({ id: 1 })).toBeNull()
    expect(feedRowEvent({ id: 2, type: 'a', payload: 'odd' })).toEqual({ id: 2, type: 'a', scope: 'public', actor: '', payload: {} })
  })

  it('reads the day from the round, or the day, that opened it', () => {
    expect(dayOf(FEED[0])).toBe('Saturday · Gran Vía')
    expect(dayOf({ id: 3, type: 'day.opened', payload: { name: 'Saturday' } })).toBe('Saturday')
    expect(dayOf(FEED[1])).toBeNull()
  })

  it('projects /me again: nothing past the allow-list (the affinity, but no key)', () => {
    const row = meRow(ME)
    expect(row?.tick).toBe(401)
    expect(row?.tickSeconds).toBe(30)
    expect(row?.stamp).toBe(ME.stamp)
    const text = JSON.stringify(row?.me)
    expect(text).not.toMatch(/collection_value|sk-never|luck_private|print_run/)
    expect(row?.me.affinity).toEqual({ LAV: 1.4 })
    expect(row?.me.score).toMatchObject({ score: 23.14, rank: 6 })
    expect(meRow({ tick: 1 })).toBeNull()
  })

  it('turns duel rows into the relay\'s duel events, with our limit, the rounds and our gain (never points: the view has none)', () => {
    const events = duelRowEvents([DUEL_NO_DEAL, DUEL_DEAL], 't01', 50)
    expect(events.map((e) => [e.id, e.type])).toEqual([
      [duelEventId(274, 998), 'duel.started'], [duelEventId(274, 0), 'duel.message'], [duelEventId(274, 1), 'duel.message'], [duelEventId(274, 2), 'duel.message'], [duelEventId(274, 999), 'duel.result'],
      [duelEventId(280, 998), 'duel.started'], [duelEventId(280, 0), 'duel.message'], [duelEventId(280, 999), 'duel.result'],
    ])
    expect(events[0]).toMatchObject({ tick: 151, scope: 'team', payload: { duel: 274, session: 1, role: 'buyer', rival: 'Rival Rojo', item: 'Plaza de Olavide', deadline_tick: 163, limit: 136, decay: 0.06 } })
    expect(events[1]?.payload).toEqual({ duel: 274, role: 'buyer', rival: 'Rival Rojo', sender: 't01', price: 59, days: null })
    expect(events[2]?.payload.sender).toBe('Rival Rojo')
    expect(events[4]).toMatchObject({ tick: 153, scope: 'team', payload: { duel: 274, rival: 'Rival Rojo', deal: true, price: 103, points: null, gain: 29.2, rounds: 2, limit: 136 } })
    expect(events[7]?.payload).toEqual({ duel: 280, rival: 'Rival Noche', deal: false, price: null, points: null, gain: 0, rounds: 0, limit: 61 })
  })
})

/** A fake pool that answers each statement of DB_SQL from a table of canned answers. */
function fakeDb(answers: Map<string, unknown[] | Error>) {
  const calls: { sql: string; params?: readonly unknown[] }[] = []
  return {
    calls,
    query: (sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, params })
      const a = answers.get(sql) ?? []
      return a instanceof Error ? Promise.reject(a) : Promise.resolve({ rows: a })
    },
  }
}

const missing = (): Error => Object.assign(new Error('relation "show.game_feed" does not exist'), { code: '42P01' })

describe('GameDbSource', () => {
  it('publishes clock, hello, me, our duels, then the feed; later polls read only what is newer', async () => {
    const answers = new Map<string, unknown[] | Error>([
      [DB_SQL.feedFirst, FEED.slice(1)], [DB_SQL.day, [FEED[0]]], [DB_SQL.meFirst, [ME]], [DB_SQL.duelsFirst, [DUEL_DEAL]],
    ])
    const db = fakeDb(answers)
    const hub = new GameHub()
    const batches: (readonly GameEvent[])[] = []
    // the teams' multipliers are a status of their own (tested below)
    hub.subscribe((b) => b[0]?.type !== 'agent.affinity' && batches.push(b))
    const source = new GameDbSource({ db, hub, log: () => {} })
    await source.pollOnce()
    const first = batches[0] ?? []
    expect(first.map((e) => e.type)).toEqual(['clock', 'agent.hello', 'agent.me', 'duel.started', 'duel.message', 'duel.message', 'duel.message', 'duel.result', 'offer.listed', 'thread.message'])
    expect(first[0]).toMatchObject({ tick: 401, scope: 'team', payload: { day: 'Saturday · Gran Vía', tick_seconds: 30 } })
    expect(first[1]?.payload).toEqual({ team: 't01', name: 'Team 1' })
    expect(JSON.stringify(first)).not.toMatch(/collection_value|sk-never/)

    // Nothing new: nothing published. Then a new feed row, a new /me and a new message in the same duel.
    await source.pollOnce()
    expect(batches).toHaveLength(1)
    const after = db.calls.filter((c) => c.sql !== DB_SQL.affinity).slice(-3)
    expect(after.map((c) => c.sql)).toEqual([DB_SQL.feedAfter, DB_SQL.meAfter, DB_SQL.duelsAfter])
    expect(after[0]?.params).toEqual([21155, 500])
    expect(after[1]?.params).toEqual([ME.stamp])
    expect(after[2]?.params).toEqual([DUEL_DEAL.stamp, 274, 50])

    answers.set(DB_SQL.feedAfter, [{ id: 21160, tick: 402, type: 'settlement', actor: '', payload: { parties: ['t01', 'abuela'], price: 21 } }])
    answers.set(DB_SQL.meAfter, [{ ...ME, tick: 402, stamp: '2026-10-03T09:30:47.000000Z' }])
    answers.set(DB_SQL.duelsAfter, [{ ...DUEL_DEAL, stamp: '2026-10-03T09:31:00.000000Z', messages: [...DUEL_DEAL.messages, { from: 'you', tick: 153, price: 103, days: null }] }])
    await source.pollOnce()
    expect(batches[1]?.map((e) => e.type)).toEqual(['clock', 'agent.me', 'duel.message', 'settlement'])
    expect(batches[1]?.[0]?.tick).toBe(402)
    expect(batches[1]?.[2]?.id).toBe(duelEventId(274, 3))
  })

  it('says once that the views are missing, stops, and hands over', async () => {
    const logs: Record<string, unknown>[] = []
    const onMissing = vi.fn()
    const source = new GameDbSource({ db: fakeDb(new Map([[DB_SQL.feedFirst, missing()]])), hub: new GameHub(), log: (e) => logs.push(e), onMissing })
    await source.pollOnce()
    await source.pollOnce()
    expect(source.viewsMissing).toBe(true)
    expect(onMissing).toHaveBeenCalledTimes(1)
    expect(logs.filter((l) => l.event === 'db_views_missing')).toHaveLength(1)
  })

  it('an older view without the columns this code reads counts as missing (db/game.sql not re-applied)', async () => {
    const onMissing = vi.fn()
    const stale = Object.assign(new Error('column "your_limit" does not exist'), { code: '42703' })
    const source = new GameDbSource({ db: fakeDb(new Map([[DB_SQL.duelsFirst, stale]])), hub: new GameHub(), log: () => undefined, onMissing })
    await source.pollOnce()
    expect(source.viewsMissing).toBe(true)
    expect(onMissing).toHaveBeenCalledTimes(1)
  })

  it('logs any other failure redacted, and keeps going', async () => {
    const logs: Record<string, unknown>[] = []
    const err = Object.assign(new Error('connect to secret-host failed'), { code: 'ECONNREFUSED' })
    const source = new GameDbSource({ db: fakeDb(new Map([[DB_SQL.feedFirst, err]])), hub: new GameHub(), log: (e) => logs.push(e), secrets: ['secret-host'], random: () => 0.5 })
    await source.pollOnce()
    expect(source.viewsMissing).toBe(false)
    expect(source.nextDelayMs()).toBe(6000)
    expect(JSON.stringify(logs)).not.toContain('secret-host')
  })
})

describe('GameDbSource: other teams\' set multipliers', () => {
  const AFFINITY = [
    { team: 't05', set_code: 'LAV', said: 1.6, said_confidence: 0.9, said_tick: 212, quote: '[laughs] <i>we pay x1.6</i>', inferred: '1.3', inferred_confidence: 0.72, inferred_tick: 230 },
    { team: 'abuela', set_code: 'LAV', said: 1.1, said_confidence: null, said_tick: 1, quote: 'not a team', inferred: null, inferred_confidence: null, inferred_tick: null },
  ]
  const setup = (answers: Map<string, unknown[] | Error>, logs: Record<string, unknown>[] = []) => {
    let now = 0
    const db = fakeDb(answers)
    const hub = new GameHub()
    const statuses: GameEvent[] = []
    hub.subscribe((b) => b.forEach((e) => e.type === 'agent.affinity' && statuses.push(e)))
    const onMissing = vi.fn()
    const source = new GameDbSource({ db, hub, log: (e) => logs.push(e), onMissing, now: () => now, affinityEveryMs: 15_000, affinityRecheckMs: 60_000, secrets: ['secret-host'] })
    return { db, hub, statuses, source, onMissing, logs, at: (ms: number) => (now = ms) }
  }
  const affinityReads = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.sql === DB_SQL.affinity)

  it('publishes the cleaned rows as the sticky agent.affinity, again only when they change, at most every 15 s', async () => {
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.affinity, AFFINITY]])
    const { db, hub, statuses, source, at } = setup(answers)
    await source.pollOnce()
    expect(affinityReads(db)).toHaveLength(1)
    expect(affinityReads(db)[0]?.params).toEqual([200])
    expect(statuses).toHaveLength(1)
    expect(statuses[0]?.payload).toEqual({ rows: [{ team: 't05', set: 'LAV', said: 1.6, saidConfidence: 0.9, saidTick: 212, quote: 'we pay x1.6', inferred: 1.3, inferredConfidence: 0.72, inferredTick: 230 }] })
    // a status: first in a late viewer's replay, never in the backlog
    expect(hub.replay().filter((e) => e.type === 'agent.affinity')).toHaveLength(1)
    expect(hub.size).toBe(1) // the clock alone

    at(14_999)
    await source.pollOnce()
    expect(affinityReads(db)).toHaveLength(1)
    at(15_000)
    await source.pollOnce()
    expect(affinityReads(db)).toHaveLength(2)
    expect(statuses).toHaveLength(1)

    answers.set(DB_SQL.affinity, [{ ...AFFINITY[0], inferred: 1.1 }])
    at(30_000)
    await source.pollOnce()
    expect(statuses).toHaveLength(2)
    expect(statuses[1]?.payload.rows).toMatchObject([{ team: 't05', inferred: 1.1 }])
  })

  it('a missing view is said once and looked for again each minute; the rest of the source never notices', async () => {
    const logs: Record<string, unknown>[] = []
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.affinity, Object.assign(new Error('relation "show.game_team_affinity" does not exist'), { code: '42P01' })]])
    const { db, statuses, source, onMissing, at } = setup(answers, logs)
    await source.pollOnce()
    at(30_000)
    await source.pollOnce()
    expect(source.viewsMissing).toBe(false)
    expect(onMissing).not.toHaveBeenCalled()
    expect(affinityReads(db)).toHaveLength(1)
    expect(logs.filter((l) => l.event === 'db_affinity_missing')).toHaveLength(1)
    expect(statuses).toHaveLength(0)

    answers.set(DB_SQL.affinity, AFFINITY)
    at(60_000)
    await source.pollOnce()
    expect(statuses).toHaveLength(1)
    expect(logs.filter((l) => l.event === 'db_affinity_on')).toHaveLength(1)
  })

  it('an empty table is published once as no rows (the page says no data yet)', async () => {
    const { statuses, source } = setup(new Map())
    await source.pollOnce()
    expect(statuses.map((e) => e.payload)).toEqual([{ rows: [] }])
  })

  it('any other failure is logged redacted and retried later, without backing off the source', async () => {
    const logs: Record<string, unknown>[] = []
    const err = Object.assign(new Error('connect to secret-host failed'), { code: 'ECONNRESET' })
    const { source, statuses, at } = setup(new Map([[DB_SQL.affinity, err]]), logs)
    await source.pollOnce()
    expect(source.nextDelayMs()).toBe(3000)
    expect(statuses).toHaveLength(0)
    expect(logs.filter((l) => l.event === 'db_affinity_failed')).toHaveLength(1)
    expect(JSON.stringify(logs)).not.toContain('secret-host')
    at(15_000)
    await source.pollOnce()
    expect(logs.filter((l) => l.event === 'db_affinity_failed')).toHaveLength(1)
  })

  it('is not read when the main poll failed', async () => {
    const { db, source } = setup(new Map([[DB_SQL.feedFirst, Object.assign(new Error('boom'), { code: 'XX000' })]]))
    await source.pollOnce()
    expect(affinityReads(db)).toHaveLength(0)
  })
})

describe('startGame with the show pool', () => {
  const pool = (answers: Map<string, unknown[] | Error>) => ({ pool: { ...fakeDb(answers), end: () => Promise.resolve() }, secrets: [] })

  it('reads the database when it has the pool, without any key', () => {
    const game = startGame({}, () => {}, undefined, pool(new Map()))
    expect(game.source()).toBe('db')
    expect(game.enabled()).toBe(true)
    expect(game.target).toBe('real')
    game.stop()
  })

  it('GAME_SOURCE=api keeps the API relay', () => {
    const game = startGame({ GAME_SOURCE: 'api' }, () => {}, undefined, pool(new Map()))
    expect(game.source()).toBeNull()
    expect(game.enabled()).toBe(false)
  })

  it('falls back to the API relay when the views are missing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify({ tick: 1, events: [] }), { status: 200 })))
    const logs: Record<string, unknown>[] = []
    const game = startGame({ BAZAAR_SIM: '1' }, (e) => logs.push(e), undefined, pool(new Map([[DB_SQL.feedFirst, missing()]])))
    expect(game.source()).toBe('db')
    await game.db?.pollOnce()
    expect(game.source()).toBe('api')
    expect(game.relay).not.toBeNull()
    expect(logs.map((l) => l.event)).toContain('db_views_missing')
    game.stop()
  })
})

/** Timers the test fires by hand, and a database whose answers wait until the test lets them go. */
function manual() {
  const tasks: { fn: () => void; ms: number }[] = []
  const gates: (() => void)[] = []
  let gated = false
  let fail: Error | null = null
  const reads = { count: 0 }
  const db = {
    query: async (sql: string) => {
      if (sql === DB_SQL.feedFirst || sql === DB_SQL.feedAfter) reads.count += 1
      if (gated) await new Promise<void>((r) => gates.push(r))
      if (fail) throw fail
      return { rows: [] }
    },
  }
  return {
    db, reads, tasks,
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, ms }
      tasks.push(t)
      return t
    },
    clearTimer: (h: unknown) => {
      const i = tasks.indexOf(h as { fn: () => void; ms: number })
      if (i >= 0) tasks.splice(i, 1)
    },
    /** Fire every timer due within `ms` (a poke's is 0, the poll's 3000), then let the reads settle. */
    fire: async (ms = 0) => {
      for (const t of tasks.splice(0).filter((x) => x.ms <= ms)) t.fn()
      for (let i = 0; i < 20; i += 1) await Promise.resolve()
    },
    gate: (on: boolean) => {
      gated = on
      if (!on) gates.splice(0).forEach((r) => r())
    },
    failWith: (e: Error | null) => {
      fail = e
    },
  }
}

describe('GameDbSource.poke', () => {
  const source = (m: ReturnType<typeof manual>) => new GameDbSource({ db: m.db, hub: new GameHub(), log: () => undefined, setTimer: m.setTimer, clearTimer: m.clearTimer, random: () => 0.5 })

  it('reads now instead of at the next 3 s turn, then goes back to the 3 s poll', async () => {
    const m = manual()
    const s = source(m)
    expect(s.poke()).toBe(false) // not started
    s.start()
    await m.fire()
    expect(m.reads.count).toBe(1)
    expect(m.tasks.map((t) => t.ms)).toEqual([3000])
    expect(s.poke()).toBe(true)
    expect(m.tasks.map((t) => t.ms)).toEqual([0])
    await m.fire()
    expect(m.reads.count).toBe(2)
    expect(m.tasks.map((t) => t.ms)).toEqual([3000])
    s.stop()
  })

  it('never reads twice at once: pokes during a read make one more read right after it', async () => {
    const m = manual()
    const s = source(m)
    s.start()
    m.gate(true)
    await m.fire()
    expect(m.reads.count).toBe(1)
    expect(s.poke()).toBe(true)
    expect(s.poke()).toBe(true)
    expect(m.tasks).toEqual([])
    m.gate(false)
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    expect(m.tasks.map((t) => t.ms)).toEqual([0])
    await m.fire()
    expect(m.reads.count).toBe(2)
    expect(m.tasks.map((t) => t.ms)).toEqual([3000])
    s.stop()
  })

  it('does nothing while the database fails: the backoff holds', async () => {
    const m = manual()
    const s = source(m)
    m.failWith(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }))
    s.start()
    await m.fire()
    expect(m.tasks.map((t) => t.ms)).toEqual([6000])
    expect(s.poke()).toBe(false)
    expect(m.tasks.map((t) => t.ms)).toEqual([6000])
    s.stop()
  })
})
