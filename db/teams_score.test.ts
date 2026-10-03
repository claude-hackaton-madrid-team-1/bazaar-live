/**
 * Proof for db/teams_score.sql, on a LOCAL Postgres 17 with synthetic rows: every team's board reads of the day, a
 * team's unchanged reads dropped (its first and latest of each day kept), the sim world and non-team ids left out, and
 * nothing of ours in the view.
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
const TEAMS_SQL = readFileSync(new URL('./teams_score.sql', import.meta.url), 'utf8')

/** The table the view reads, one of ours it must never read, and the two db/show.sql's own views need, as the agents' schema declares them today. */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table me_snapshots (world text, team text, tick int, epoch bigint, digest text, read_at timestamptz default now(), read_by text,
    cash int, level int, cards jsonb, duplicates jsonb, packs jsonb, pages jsonb, affinity jsonb, score jsonb, me jsonb);
  create table leaderboard_snapshots (world text, tick int, team text, rank int, score numeric, negotiating numeric, market numeric,
    level int, pages int, deals int, venue text, read_at timestamptz);
`

const SECRET = 'SECRET-plugh'

const dbName = `teams_score_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe.skipIf(!ADMIN_URL)('db/teams_score.sql (local Postgres)', () => {
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
    // our own private breakdown: the view must never read it
    await adminDb.query(`insert into me_snapshots (world, team, tick, cash, score) values ('real', 't01', 820, 777, $1)`, [
      JSON.stringify({ score: 25, neg_points: 134.7, luck_private: 9.99, note: SECRET }),
    ])
    // 15:00 UTC is 17:00 in Madrid (2026-10-03); 22:30 UTC on the 3rd is already the 4th there
    await adminDb.query(
      `insert into leaderboard_snapshots (world, tick, team, rank, score, negotiating, market, level, pages, deals, venue, read_at) values
        ('real', 800, 't01', 2, 25.2604, 17.7604, 7.5, 3, 1, 18, 'v19', '2026-10-03 15:00:00+00'),
        ('real', 810, 't01', 2, 25.2604, 17.7604, 7.5, 3, 1, 18, 'v19', '2026-10-03 15:05:00+00'),
        ('real', 820, 't01', 3, 25.2604, 17.7604, 7.5, 3, 1, 18, 'v19', '2026-10-03 15:10:00+00'),
        ('real', 830, 't01', 3, 25.2604, 17.7604, 7.5, 3, 1, 18, 'v19', '2026-10-03 15:15:00+00'),
        ('real', 840, 't01', 3, 25.2604, 17.7604, 7.5, 3, 1, 18, 'v19', '2026-10-03 15:20:00+00'),
        ('real', 800, 't05', 1, 30, 20, 10, 4, 2, 40, 'v10', '2026-10-03 15:00:00+00'),
        ('real', 810, 't05', 1, 30, 20, 10, 4, 2, 40, 'v10', '2026-10-03 15:05:00+00'),
        ('real', 820, 't05', 1, 30, 20, 10, 4, 2, 41, 'v10', '2026-10-03 15:10:00+00'),
        ('real', 800, 't07', 3, 20, 20, 0, 3, 0, 10, null, '2026-10-03 15:00:00+00'),
        ('real', 820, 't07', 2, 26, 26, 0, 3, 0, 11, null, '2026-10-03 15:10:00+00'),
        ('real', 5, 't01', 4, 25.1, 17.6, 7.5, 3, 1, 18, 'v19', '2026-10-03 22:30:00+00'),
        ('sim', 820, 't09', 1, 99, 99, 0, 9, 9, 99, null, '2026-10-03 15:10:00+00'),
        ('real', 820, 'abuela', 1, 1, 1, 0, 1, 1, 1, null, '2026-10-03 15:10:00+00'),
        ('real', 820, 't11', null, 5, 5, 0, 1, 0, 1, null, '2026-10-03 15:10:00+00')`,
    )
    // The order the coordinator applies them in, then again: show.sql's re-run drops these grants, teams_score.sql's puts them back.
    await adminDb.query(SHOW_SQL)
    await adminDb.query(TEAMS_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(TEAMS_SQL)
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

  it("keeps a team's read when something moved (a rank too), and each team's first and latest read of the day", async () => {
    const r = await reader.query(
      `select day::text as day, tick, team, rank, score::float8 as score, negotiating::float8 as negotiating, market::float8 as market, level, pages, deals
         from show.team_scores order by day, team, tick`,
    )
    expect(r.rows).toEqual([
      // t01: 800 the first, 810 unchanged (dropped), 820 its rank moved, 830 unchanged (dropped), 840 the latest
      { day: '2026-10-03', tick: 800, team: 't01', rank: 2, score: 25.26, negotiating: 17.76, market: 7.5, level: 3, pages: 1, deals: 18 },
      { day: '2026-10-03', tick: 820, team: 't01', rank: 3, score: 25.26, negotiating: 17.76, market: 7.5, level: 3, pages: 1, deals: 18 },
      { day: '2026-10-03', tick: 840, team: 't01', rank: 3, score: 25.26, negotiating: 17.76, market: 7.5, level: 3, pages: 1, deals: 18 },
      // t05: 810 unchanged, 820 one more deal
      { day: '2026-10-03', tick: 800, team: 't05', rank: 1, score: 30, negotiating: 20, market: 10, level: 4, pages: 2, deals: 40 },
      { day: '2026-10-03', tick: 820, team: 't05', rank: 1, score: 30, negotiating: 20, market: 10, level: 4, pages: 2, deals: 41 },
      { day: '2026-10-03', tick: 800, team: 't07', rank: 3, score: 20, negotiating: 20, market: 0, level: 3, pages: 0, deals: 10 },
      { day: '2026-10-03', tick: 820, team: 't07', rank: 2, score: 26, negotiating: 26, market: 0, level: 3, pages: 0, deals: 11 },
      // a new Madrid day starts its own run (the tick started again)
      { day: '2026-10-04', tick: 5, team: 't01', rank: 4, score: 25.1, negotiating: 17.6, market: 7.5, level: 3, pages: 1, deals: 18 },
    ])
  })

  it('rounds the points to three decimals and gives when the board was read', async () => {
    const r = await reader.query(`select score::text as score, read_at from show.team_scores where team = 't01' and tick = 800`)
    expect(r.rows).toEqual([{ score: '25.260', read_at: new Date('2026-10-03T15:00:00Z') }])
  })

  it('leaves out the sim world, a dealer id and a row without a rank', async () => {
    const r = await reader.query(`select team from show.team_scores where team in ('t09', 'abuela', 't11')`)
    expect(r.rows).toEqual([])
  })

  it('never carries anything of ours', async () => {
    const r = await reader.query('select * from show.team_scores')
    const text = JSON.stringify(r.rows)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('134.7')
    expect(text).not.toContain('777')
    expect(Object.keys(r.rows[0] ?? {})).toEqual(['day', 'tick', 'team', 'rank', 'score', 'negotiating', 'market', 'level', 'pages', 'deals', 'read_at', 'venue'])
  })

  it.each(['public.me_snapshots', 'public.leaderboard_snapshots'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })
})
