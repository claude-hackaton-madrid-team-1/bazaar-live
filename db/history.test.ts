/**
 * Privacy proof for db/history.sql's score views, on a LOCAL Postgres 17 with synthetic rows.
 *
 *   sh scripts/test-sql.sh        # starts a throwaway container, runs the SQL tests, removes it
 *
 * Runs only when SHOW_TEST_ADMIN_URL is set, and only against a loopback host: it creates and drops a
 * database and a role, so it must never meet a shared server.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_URL = process.env.SHOW_TEST_ADMIN_URL
const SHOW_SQL = readFileSync(new URL('./show.sql', import.meta.url), 'utf8')
const HISTORY_SQL = readFileSync(new URL('./history.sql', import.meta.url), 'utf8')

/** The tables the views read, as the agents' schema declares them today. */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table me_snapshots (world text, team text, tick int, epoch bigint, digest text, read_at timestamptz default now(), read_by text,
    cash int, level int, cards jsonb, duplicates jsonb, packs jsonb, pages jsonb, affinity jsonb, score jsonb, me jsonb);
  create table ledger (id bigserial primary key, kind text, tick int, t_hours numeric, price int, item text, source text, created_at timestamptz default now());
  create table decisions (id bigserial primary key, intent_id bigint, thread_id bigint, tick int, state_digest text, rag_context jsonb,
    candidates jsonb, jev jsonb, jev_digest text, policy_checks jsonb, chosen jsonb, status text, reason text, agent text, kind text, dry_run boolean);
`

const SECRET = 'SECRET-plugh'

const score = (s: number, neg: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ score: s, rank: 8, duel_points: 1.5, ladder_points: 0.009, neg_points: neg, mm_points: 0, bench_points: null, luck_private: SECRET, name: SECRET, ...extra })

const dbName = `history_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe.skipIf(!ADMIN_URL)('db/history.sql score views (local Postgres)', () => {
  let admin: pg.Client
  let reader: pg.Client
  let adminDb: pg.Client

  beforeAll(async () => {
    const url = new URL(ADMIN_URL ?? '')
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('refusing to run the SQL test against a non-local host')
    admin = new pg.Client({ connectionString: ADMIN_URL })
    await admin.connect()
    await admin.query(`create database ${dbName}`)
    adminDb = new pg.Client({ connectionString: withDb(ADMIN_URL ?? '', dbName) })
    await adminDb.connect()
    await adminDb.query(TABLES)
    // Saturday 159..162, then Sunday's clock starts again at 5 and runs past Saturday's ticks (to 400).
    await adminDb.query(
      `insert into me_snapshots (world, team, tick, read_at, cash, score) values
        ('real', 't01', 159, '2026-10-03 09:28:00+02', 353, $1),
        ('real', 't01', 160, '2026-10-03 09:29:00+02', 999, $1),
        ('real', 't01', 160, '2026-10-03 09:29:20+02', 348, $2),
        ('real', 't01', 161, '2026-10-03 09:29:40+02', 348, $2),
        ('real', 't01', 162, '2026-10-03 09:30:10+02', 348, $2),
        ('real', 't01', 163, '2026-10-03 09:30:40+02', 348, '"odd"'),
        ('sim', 't01', 164, '2026-10-03 09:31:00+02', 1, $2),
        ('real', 't01', 5, '2026-10-04 09:00:00+02', 400, $3),
        ('real', 't01', 400, '2026-10-04 12:00:00+02', 400, $3)`,
      [score(8.34, 0), score(8.39, 5.7), score(0.1, 0, { bench_points: 0.5 })],
    )
    await adminDb.query(
      `insert into decisions (id, tick, agent, kind, status, dry_run, candidates, reason) values
        (1, 300, 'taker', 'accept_ask', 'done', false, null, null),
        (2, 307, 'taker', 'process_started', 'done', false, $1, $2),
        (3, -1, 'mcp', 'note', 'done', false, null, null),
        (30, 12, 'duels', 'duel_hold', 'done', false, null, null),
        (31, 308, 'taker', 'process_started', 'done', false, null, null),
        (40, 5, 'maker', 'post_ask', 'done', false, null, null),
        (50, 999, 'taker', 'process_started', 'done', true, null, null),
        (60, 6, 'maker', 'process_started', 'done', false, $1, $2)`,
      [JSON.stringify({ owner: SECRET }), SECRET],
    )
    await adminDb.query(
      `insert into feed_events (id, tick, type, actor, payload, received_at) values
        (10907, 159, 'day.opened', '', '{"day": "sat", "name": "Saturday"}', '2026-10-03 09:28:00+02'),
        (10941, 160, 'schedule.fired', '', '{"note": "Round 2 starts", "action": "round"}', '2026-10-03 09:29:00+02'),
        (10942, 161, 'schedule.fired', '', '{"note": "welcome", "action": "announce"}', '2026-10-03 09:29:30+02'),
        (10943, 162, 'thread.message', 't01', '{"text": "${SECRET}"}', '2026-10-03 09:30:00+02')`,
    )
    // The order the coordinator applies them in, then again: show.sql's re-run drops these grants, history.sql's puts them back.
    await adminDb.query(SHOW_SQL)
    await adminDb.query(HISTORY_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(HISTORY_SQL)
    await adminDb.query(`alter role bazaar_live_reader login password '${readerPassword}'`)
    reader = new pg.Client({ connectionString: withDb(ADMIN_URL ?? '', dbName).replace(/\/\/[^@]*@/, `//bazaar_live_reader:${readerPassword}@`) })
    await reader.connect()
  })

  afterAll(async () => {
    await reader?.end().catch(() => undefined)
    await adminDb?.end().catch(() => undefined)
    await admin?.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined)
    await admin?.query('drop role if exists bazaar_live_reader').catch(() => undefined)
    await admin?.query('grant connect on database postgres to public').catch(() => undefined)
    await admin?.end().catch(() => undefined)
  })

  it('reads the score and its parts at each tick something moved, keyed by day, never the whole score object', async () => {
    const r = await reader.query('select day::text as day, tick, cash, score::float, duel::float, ladder::float, neg::float, mm::float, bench::float from show.score_points order by day, tick')
    expect(r.rows.map((x) => [x.day, x.tick, x.cash, x.score, x.neg, x.bench])).toEqual([
      ['2026-10-03', 159, 353, 8.34, 0, null],
      ['2026-10-03', 160, 348, 8.39, 5.7, null],
      ['2026-10-04', 5, 400, 0.1, 0, 0.5],
      ['2026-10-04', 400, 400, 0.1, 0, 0.5],
    ])
    expect(r.rows[0]).toMatchObject({ duel: 1.5, ladder: 0.009, mm: 0 })
    const all = await reader.query('select * from show.score_points')
    expect(Object.keys(all.rows[0])).toEqual(['day', 'tick', 'read_at', 'cash', 'score', 'duel', 'ladder', 'neg', 'mm', 'bench'])
    expect(JSON.stringify(all.rows)).not.toContain(SECRET)
  })

  it("puts an agent's start on its day by order, though Sunday's clock runs past Saturday's tick", async () => {
    const r = await reader.query("select kind, id::int, day::text as day, tick, agent, action, note from show.score_marks order by day, tick, kind")
    expect(r.rows).toEqual([
      { kind: 'game', id: 10907, day: '2026-10-03', tick: 159, agent: null, action: 'day', note: 'Saturday' },
      { kind: 'game', id: 10941, day: '2026-10-03', tick: 160, agent: null, action: 'round', note: 'Round 2 starts' },
      { kind: 'start', id: 2, day: '2026-10-03', tick: 307, agent: 'taker', action: null, note: null },
      // one decision written with a stale tick (12) is not a new day
      { kind: 'start', id: 31, day: '2026-10-03', tick: 308, agent: 'taker', action: null, note: null },
      { kind: 'start', id: 60, day: '2026-10-04', tick: 6, agent: 'maker', action: null, note: null },
    ])
    const all = await reader.query('select * from show.score_marks')
    expect(JSON.stringify(all.rows)).not.toContain(SECRET)
  })

  it.each(['public.me_snapshots', 'public.decisions', 'public.feed_events'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })
})
