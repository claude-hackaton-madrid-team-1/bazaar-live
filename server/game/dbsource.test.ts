import { afterEach, describe, expect, it, vi } from 'vitest'
import { DB_SQL, dayOf, duelRowEvents, feedRowEvent, FIRST_OURS_ID, GameDbSource, meRow, ourOfferRows, salesMessageEvent } from './dbsource.ts'
import { duelEventId } from './duels.ts'
import { GameHub, type GameEvent } from './relay.ts'
import { startGame } from './start.ts'
import { vouchSalesQuote } from '../../shared/sales.ts'
import { apply, createState } from '../../src/game/state.ts'

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

describe('ourOfferRows', () => {
  it('keeps listing rows with an offer id, with their hand flag', () => {
    const row = { id: '7', tick: 3, type: 'offer.listed', actor: 't01', payload: { offer: { id: 9 } }, hand: true }
    expect(ourOfferRows([row, { ...row, id: 8, hand: 'yes' }, { ...row, payload: { offer: { id: 'x' } } }, { ...row, type: 'settlement' }, null])).toEqual([
      { id: 7, tick: 3, actor: 't01', payload: { offer: { id: 9 } }, hand: true },
      { id: 8, tick: 3, actor: 't01', payload: { offer: { id: 9 } }, hand: false },
    ])
  })
})

describe('GameDbSource', () => {
  it('publishes clock, hello, me, our duels, then the feed; later polls read only what is newer', async () => {
    const answers = new Map<string, unknown[] | Error>([
      [DB_SQL.feedWindow, FEED.slice(1)], [DB_SQL.day, [FEED[0]]], [DB_SQL.meFirst, [ME]], [DB_SQL.duelsFirst, [DUEL_DEAL]],
    ])
    const db = fakeDb(answers)
    const hub = new GameHub()
    const batches: (readonly GameEvent[])[] = []
    // our open offers come as their own status (tested below)
    hub.subscribe((b) => b[0]?.type !== 'offers.ours' && batches.push(b))
    const source = new GameDbSource({ db, hub, log: () => {} })
    await source.pollOnce()
    const first = batches[0] ?? []
    expect(first.map((e) => e.type)).toEqual(['clock', 'agent.hello', 'agent.me', 'duel.started', 'duel.message', 'duel.message', 'duel.message', 'duel.result', 'offer.listed', 'thread.message'])
    expect(first[0]).toMatchObject({ tick: 401, scope: 'team', payload: { day: 'Saturday · Gran Vía', tick_seconds: 30 } })
    expect(first[1]?.payload).toEqual({ team: 't01', name: 'Team 1' })
    expect(JSON.stringify(first)).not.toMatch(/collection_value|sk-never/)
    // /me first: its tick bounds the first feed read (the newest 2000 rows of the last 300 ticks), never the whole feed
    expect(db.calls.slice(0, 3).map((c) => c.sql)).toEqual([DB_SQL.meFirst, DB_SQL.duelsFirst, DB_SQL.feedWindow])
    expect(db.calls[2]?.params).toEqual([2000, 101])

    // Nothing new: nothing published. Then a new feed row, a new /me and a new message in the same duel.
    await source.pollOnce()
    expect(batches).toHaveLength(1)
    const after = db.calls.filter((c) => c.sql !== DB_SQL.sales).slice(-4, -1)
    expect(after.map((c) => c.sql)).toEqual([DB_SQL.meAfter, DB_SQL.duelsAfter, DB_SQL.feedAfter])
    expect(after[0]?.params).toEqual([ME.stamp])
    expect(after[1]?.params).toEqual([DUEL_DEAL.stamp, 274, 50])
    expect(after[2]?.params).toEqual([21155, 500])

    answers.set(DB_SQL.feedAfter, [{ id: 21160, tick: 402, type: 'settlement', actor: '', payload: { parties: ['t01', 'abuela'], price: 21 } }])
    answers.set(DB_SQL.meAfter, [{ ...ME, tick: 402, stamp: '2026-10-03T09:30:47.000000Z' }])
    answers.set(DB_SQL.duelsAfter, [{ ...DUEL_DEAL, stamp: '2026-10-03T09:31:00.000000Z', messages: [...DUEL_DEAL.messages, { from: 'you', tick: 153, price: 103, days: null }] }])
    await source.pollOnce()
    expect(batches[1]?.map((e) => e.type)).toEqual(['clock', 'agent.me', 'duel.message', 'settlement'])
    expect(batches[1]?.[0]?.tick).toBe(402)
    expect(batches[1]?.[2]?.id).toBe(duelEventId(274, 3))
  })

  it('publishes every open offer of ours, however far behind the feed replay it was listed, as a status replayed after the backlog', async () => {
    // A bid listed 600 rows before the replay window, still open; a newer listing inside the window.
    const OLD = { id: 100, tick: 300, type: 'offer.listed', actor: 't01', payload: { venue: 'v02', offer: { id: 1, maker: 't01', give: { cash: 16 }, want: { types: ['card:RET-08'] }, expires_tick: 600 } }, hand: true }
    const answers = new Map<string, unknown[] | Error>([
      [DB_SQL.feedWindow, FEED.slice(1)], [DB_SQL.day, [FEED[0]]], [DB_SQL.meFirst, [ME]], [DB_SQL.ours, [OLD, { id: 'odd' }]],
    ])
    const hub = new GameHub()
    const statuses: GameEvent[] = []
    hub.subscribe((b) => b.forEach((e) => e.type === 'offers.ours' && statuses.push(e)))
    const source = new GameDbSource({ db: fakeDb(answers), hub, log: () => {}, feedBackfill: 2 })
    await source.pollOnce()
    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({ id: FIRST_OURS_ID, type: 'offers.ours', scope: 'team', payload: { offers: [{ id: 100, tick: 300, actor: 't01', hand: true, payload: OLD.payload }] } })
    // the same offers at the same tick: nothing new; a new tick: sent again (a page may have guessed one away); one fewer: sent again
    await source.pollOnce()
    expect(statuses).toHaveLength(1)
    answers.set(DB_SQL.feedAfter, [{ id: 21200, tick: 402, type: 'settlement', actor: '', payload: {} }])
    await source.pollOnce()
    answers.set(DB_SQL.feedAfter, [])
    expect(statuses.map((e) => e.tick)).toEqual([401, 402])
    answers.set(DB_SQL.ours, [])
    await source.pollOnce()
    expect(statuses.map((e) => e.payload.offers)).toEqual([[expect.objectContaining({ id: 100 })], [expect.objectContaining({ id: 100 })], []])
    // a page that opens now gets the backlog first, then the latest list of ours
    const replay = hub.replay()
    expect(replay.at(-1)).toBe(statuses[2])
    expect(replay.filter((e) => e.type === 'offers.ours')).toHaveLength(1)
  })

  it('keeps the source going when show.game_our_offers is not applied yet, and tries again later', async () => {
    const logs: Record<string, unknown>[] = []
    const onMissing = vi.fn()
    const notYet = Object.assign(new Error('relation "show.game_our_offers" does not exist'), { code: '42P01' })
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.feedWindow, FEED.slice(1)], [DB_SQL.meFirst, [ME]], [DB_SQL.ours, notYet]])
    const db = fakeDb(answers)
    const hub = new GameHub()
    const source = new GameDbSource({ db, hub, log: (e) => logs.push(e), onMissing, oursRetryPolls: 2 })
    await source.pollOnce()
    expect(source.viewsMissing).toBe(false)
    expect(onMissing).not.toHaveBeenCalled()
    expect(hub.replay().map((e) => e.type)).toContain('offer.listed')
    await source.pollOnce()
    await source.pollOnce()
    expect(db.calls.filter((c) => c.sql === DB_SQL.ours)).toHaveLength(1)
    answers.set(DB_SQL.ours, [])
    await source.pollOnce()
    expect(db.calls.filter((c) => c.sql === DB_SQL.ours)).toHaveLength(2)
    expect(logs.filter((l) => l.event === 'db_our_offers_missing')).toHaveLength(1)
    expect(hub.replay().at(-1)).toMatchObject({ type: 'offers.ours', payload: { offers: [] } })
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

  it('a failing feed read (temp_file_limit, 53400) still publishes /me and the clock, backs off, and recovers', async () => {
    const logs: Record<string, unknown>[] = []
    const tooBig = Object.assign(new Error('temporary file size exceeds "temp_file_limit" (16384kB)'), { code: '53400' })
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.feedWindow, tooBig], [DB_SQL.meFirst, [ME]], [DB_SQL.duelsFirst, [DUEL_DEAL]]])
    const db = fakeDb(answers)
    const hub = new GameHub()
    const source = new GameDbSource({ db, hub, log: (e) => logs.push(e), random: () => 0.5 })
    await source.pollOnce()
    expect(hub.replay().map((e) => e.type)).toEqual(['agent.hello', 'agent.me', 'clock', 'duel.started', 'duel.message', 'duel.message', 'duel.message', 'duel.result'])
    expect(hub.replay()[1]?.payload).toMatchObject({ id: 't01', cash: 176 })
    expect(logs).toEqual([expect.objectContaining({ event: 'db_poll_failed', fails: 1, parts: ['feed'], code: '53400' })])
    expect(source.nextDelayMs()).toBe(6000)
    expect(db.calls.some((c) => c.sql === DB_SQL.ours)).toBe(false)
    // the backoff never waits longer than a tick
    for (let i = 0; i < 5; i += 1) await source.pollOnce()
    expect(source.nextDelayMs()).toBe(15_000)
    // the window is read again (no mark was taken), and the feed comes back
    answers.set(DB_SQL.feedWindow, FEED.slice(1))
    await source.pollOnce()
    expect(db.calls.filter((c) => c.sql === DB_SQL.feedWindow)).toHaveLength(7)
    expect(hub.replay().map((e) => e.type)).toContain('thread.message')
    expect(logs.at(-1)).toMatchObject({ event: 'db_poll_recovered', after: 6 })
    expect(source.nextDelayMs()).toBe(3000)
  })

  it('an empty window is read again next time, never as `id > 0` (the whole feed, sorted)', async () => {
    const db = fakeDb(new Map([[DB_SQL.meFirst, [ME]]]))
    const source = new GameDbSource({ db, hub: new GameHub(), log: () => undefined })
    await source.pollOnce()
    await source.pollOnce()
    expect(db.calls.filter((c) => c.sql === DB_SQL.feedWindow)).toHaveLength(2)
    expect(db.calls.some((c) => c.sql === DB_SQL.feedAfter)).toBe(false)
  })

  it('without any /me yet, the first read takes the newest rows by id, as before', async () => {
    const db = fakeDb(new Map([[DB_SQL.feedFirst, FEED.slice(1)]]))
    const source = new GameDbSource({ db, hub: new GameHub(), log: () => undefined })
    await source.pollOnce()
    expect(db.calls.filter((c) => c.sql === DB_SQL.feedFirst)).toHaveLength(1)
    await source.pollOnce()
    expect(db.calls.at(-1)?.sql === DB_SQL.ours ? db.calls.at(-2)?.params : db.calls.at(-1)?.params).toEqual([21155, 500])
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
      if (sql === DB_SQL.meFirst || sql === DB_SQL.meAfter) reads.count += 1
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

describe('late acknowledged words', () => {
  it('updates a missing own quote once after the feed cursor passed it, without resending the offer', async () => {
    const missing = { id: 30000, tick: 401, type: 'thread.message', payload: { sender: 't01', thread: 44, message: 50, text: null } }
    const answers = new Map<string, unknown[]>([[DB_SQL.feedFirst, [missing]], [DB_SQL.feedWindow, [missing]], [DB_SQL.meFirst, [ME]]])
    const db = fakeDb(answers)
    const hub = new GameHub()
    const source = new GameDbSource({ db, hub, log: () => undefined })
    await source.pollOnce()
    expect(hub.replay().filter((e) => e.type === 'thread.message.quote')).toHaveLength(0)
    answers.set(DB_SQL.quotes, [{ ...missing, payload: { ...missing.payload, text: 'I can trade my Retiro card.' } }])
    await source.pollOnce()
    await source.pollOnce()
    expect(hub.replay().filter((e) => e.type === 'thread.message')).toHaveLength(1)
    expect(hub.replay().filter((e) => e.type === 'thread.message.quote')).toMatchObject([{ tick: 401, scope: 'team', payload: { feed_id: 30000, text: 'I can trade my Retiro card.' } }])
    expect(db.calls.filter((c) => c.sql === DB_SQL.quotes)).toHaveLength(2)
  })
})

describe('private acknowledged Sales messages', () => {
  const quote = { id: '16779', thread_id: '3334', tick: 399, sender: 't01', counterpart: 't03', venue: 'rastro', text: 'Oferta pública #25737 en v19.' }

  it('bridges stored words without any public event, with stable IDs and no duplicate on later public arrival', async () => {
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.meFirst, [ME]], [DB_SQL.sales, [quote]]])
    const db = fakeDb(answers), hub = new GameHub()
    const source = new GameDbSource({ db, hub, log: () => {} })
    await source.pollOnce()
    const messages = () => hub.replay().filter((e) => e.type === 'thread.message')
    expect(messages()).toHaveLength(1)
    const event = messages()[0]
    expect(event).toMatchObject({ tick: 399, scope: 'team', actor: 't01', payload: { sender: 't01', team: 't01', with: 't03', message: 16779, thread: 3334, text: quote.text, venue: 'rastro' } })
    expect(event?.id).toBeLessThan(0)
    await source.pollOnce()
    expect(messages()).toHaveLength(1)
    answers.set(DB_SQL.feedWindow, [{ id: 30001, tick: 399, type: 'thread.message', actor: 't01', payload: { ...event?.payload } }])
    await source.pollOnce()
    expect(messages()).toHaveLength(1)
    const restarted = new GameHub()
    await new GameDbSource({ db: fakeDb(new Map([[DB_SQL.meFirst, [ME]], [DB_SQL.sales, [quote]]])), hub: restarted, log: () => {} }).pollOnce()
    expect(restarted.replay().find((e) => e.type === 'thread.message')?.id).toBe(event?.id)
  })

  it('proves exact TTS text and shows the recorded closed conversation status', async () => {
    const hub = new GameHub()
    const historical = { ...quote, tick: 200, thread_status: 'closed', closed_tick: 205 }
    await new GameDbSource({ db: fakeDb(new Map([[DB_SQL.meFirst, [ME]], [DB_SQL.sales, [historical]]])), hub, log: () => {} }).pollOnce()
    const decision: GameEvent = { id: -100, tick: 200, type: 'agent.decision', scope: 'team', actor: '', payload: { agent: 'sales', status: 'done', decision: 3, kind: 'sales_promotion', counterparty: 't03', trade: { threadId: 3334 } } }
    const rows = [...hub.replay(), decision]
    expect(vouchSalesQuote(rows, historical.text)).toBe(true)
    expect(vouchSalesQuote(rows, 'invented text')).toBe(false)
    const state = rows.reduce((s, e) => apply(s, e), createState())
    expect(state.teamThreads.get(3334)).toMatchObject({ venue: 'rastro', status: 'closed' })
  })

  it('enriches an earlier public envelope exactly once when ACK persistence arrives late', async () => {
    const original = { id: 30001, tick: 399, type: 'thread.message', actor: 't01', payload: { message: 16779, thread: 3334, sender: 't01', team: 't01', with: 't03', kind: 'team', text: null } }
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.meFirst, [ME]], [DB_SQL.feedWindow, [original]], [DB_SQL.sales, []]])
    const hub = new GameHub()
    const source = new GameDbSource({ db: fakeDb(answers), hub, log: () => {} })
    await source.pollOnce()
    answers.set(DB_SQL.sales, [quote])
    answers.set(DB_SQL.quotes, [{ ...original, payload: { ...original.payload, text: quote.text } }])
    await source.pollOnce()
    await source.pollOnce()
    expect(hub.replay().filter((e) => e.type === 'thread.message')).toHaveLength(1)
    expect(hub.replay().filter((e) => e.type === 'thread.message.quote')).toEqual([expect.objectContaining({ scope: 'team', payload: expect.objectContaining({ feed_id: 30001, message: 16779, text: quote.text }) })])
  })

  it('loads bounded initial history, then finds late lower message IDs in the rolling window', async () => {
    const old = { ...quote, id: 100, tick: 200 }
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.meFirst, [ME]], [DB_SQL.sales, [old]]])
    const db = fakeDb(answers), hub = new GameHub()
    const source = new GameDbSource({ db, hub, log: () => {} })
    await source.pollOnce()
    expect(hub.replay().find((e) => e.type === 'thread.message')?.tick).toBe(200)
    answers.set(DB_SQL.sales, [{ ...quote, id: 99 }])
    await source.pollOnce()
    expect(hub.replay().filter((e) => e.type === 'thread.message')).toHaveLength(2)
    expect(db.calls.filter((c) => c.sql === DB_SQL.sales).map((c) => c.params)).toEqual([[101], [393]])
  })

  it('isolates an unapplied optional view and validates sender, venue and message shape', async () => {
    const answers = new Map<string, unknown[] | Error>([[DB_SQL.meFirst, [ME]], [DB_SQL.sales, missing()]])
    const hub = new GameHub(), onMissing = vi.fn()
    const source = new GameDbSource({ db: fakeDb(answers), hub, onMissing, log: () => {} })
    await source.pollOnce()
    expect(source.viewsMissing).toBe(false)
    expect(onMissing).not.toHaveBeenCalled()
    expect(hub.replay().some((e) => e.type === 'agent.me')).toBe(true)
    for (const bad of [{ ...quote, sender: 't03' }, { ...quote, venue: 'bad venue' }, { ...quote, id: -1 }, { ...quote, text: null }]) {
      expect(salesMessageEvent(bad, 't01')).toBeNull()
    }
    expect(salesMessageEvent(quote, 't02')).toBeNull()
  })
})
