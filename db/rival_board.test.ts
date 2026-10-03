/**
 * Privacy proof for db/rival_board.sql, on a LOCAL Postgres 17 with a stand-in for the agents' public.rival_board.
 *
 *   SHOW_TEST_ADMIN_URL=postgresql://postgres:<password>@127.0.0.1:<port>/postgres npx vitest run db/rivals.test.ts
 *   (against a throwaway container, as scripts/test-sql.sh starts one for the other db/ tests)
 *
 * Runs only when SHOW_TEST_ADMIN_URL is set, and only against a loopback host: it creates and drops a
 * database and a role, so it must never meet a shared server.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOARD_COLUMNS as COLUMNS, boardRowsOf } from '../server/rivals/boardRows.ts'
import { CAPS, SQL } from '../server/rivals/poller.ts'

const ADMIN_URL = process.env.SHOW_TEST_ADMIN_URL
const SHOW_SQL = readFileSync(new URL('./show.sql', import.meta.url), 'utf8')
const RIVALS_SQL = readFileSync(new URL('./rival_board.sql', import.meta.url), 'utf8')

/** public.rival_board's contract (bazaar #224), in its order, with the types the agents declare. */
const CONTRACT: readonly (readonly [string, string])[] = [
  ['team', 'text'], ['tick', 'int'], ['rank', 'int'], ['score', 'numeric'], ['negotiating', 'numeric'], ['market', 'numeric'],
  ['level', 'int'], ['pages', 'int'], ['deals', 'int'], ['venue', 'text'],
  ['rank_change', 'int'], ['score_change', 'numeric'], ['trend_ticks', 'int'], ['trend', 'jsonb'],
  ['our_team', 'text'], ['our_rank', 'int'], ['our_score', 'numeric'], ['our_negotiating', 'numeric'], ['our_market', 'numeric'], ['our_pages', 'int'],
  ['dealer_deals', 'int'], ['venue_trades', 'int'], ['top_set', 'text'], ['set_interest', 'jsonb'],
  ['strengths', 'text[]'], ['weaknesses', 'text[]'],
  ['they_want', 'jsonb'], ['they_have', 'jsonb'], ['we_have_for_them', 'jsonb'], ['they_have_for_us', 'jsonb'], ['match_count', 'int'],
  ['guarded', 'boolean'], ['guard_reason', 'text'],
  ['move_kind', 'text'], ['move_give', 'text'], ['move_get', 'text'], ['move_price', 'int'], ['our_gain', 'numeric'], ['their_gain', 'numeric'],
  ['suggested_move', 'text'],
  ['why_climbed', 'text'], ['why_climbed_tick', 'int'],
]
const NAMES = CONTRACT.map(([name]) => name)

/** A stand-in TABLE for the agents' view, plus one column of theirs that is not in the contract. */
const BOARD_COLUMNS = [...NAMES, 'agent_note']
const BOARD = `create table public.rival_board (${CONTRACT.map(([n, t]) => `${n} ${t}`).join(', ')}, agent_note text)`

/** What db/show.sql's own two views read. */
const SHOW_TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
`

const SECRET = 'SECRET-plugh'

const T05: Record<string, unknown> = {
  team: 't05', tick: 640, rank: 2, score: 412.5, negotiating: 120.25, market: 80, level: 3, pages: 2, deals: 14, venue: 'v05',
  rank_change: 1, score_change: 18.5, trend_ticks: 30,
  trend: JSON.stringify([{ tick: 610, rank: 3, score: 394 }, { tick: 640, rank: 2, score: 412.5 }]),
  our_team: 't01', our_rank: 4, our_score: 380, our_negotiating: 100, our_market: 60.5, our_pages: 1,
  dealer_deals: 9, venue_trades: 3, top_set: 'LAV', set_interest: JSON.stringify({ LAV: 2.5, MAL: -1 }),
  strengths: ['negotiating', 'climbing'], weaknesses: ['no_venue_trades'],
  they_want: JSON.stringify([{ ref: 'LAV-09', price: 70, tick: 638 }]), they_have: JSON.stringify([{ ref: 'MAL-02', price: 12, tick: 636 }]),
  we_have_for_them: JSON.stringify([{ ref: 'LAV-09', spare: 1, their_price: 70, our_value: 42.5 }]),
  they_have_for_us: JSON.stringify([{ ref: 'MAL-02', their_price: 12, value_to_us: 17.5 }]), match_count: 2,
  guarded: true, guard_reason: 'near',
  move_kind: 'swap', move_give: 'LAV-09', move_get: 'MAL-02', move_price: null, our_gain: 17.5, their_gain: 8,
  suggested_move: 'Swap our spare LAV-09 for their MAL-02.', why_climbed: 'Sold LAV-09 to t07 for 70 on v05.', why_climbed_tick: 639,
  agent_note: SECRET,
}
const T03: Record<string, unknown> = {
  ...T05, team: 't03', rank: 1, score: 455, guard_reason: 'top5', move_kind: 'hold', move_give: null, move_get: null,
  suggested_move: 'Hold: t03 leads.', strengths: [], weaknesses: ['needs_cards'], they_want: '[]', they_have: '[]',
  we_have_for_them: '[]', they_have_for_us: '[]', match_count: 0,
}

const dbName = `rival_board_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

async function insert(db: pg.Client, row: Record<string, unknown>): Promise<void> {
  const values = BOARD_COLUMNS.map((c) => row[c] ?? null)
  await db.query(`insert into public.rival_board (${BOARD_COLUMNS.join(', ')}) values (${BOARD_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})`, values)
}

describe.skipIf(!ADMIN_URL)('db/rival_board.sql (local Postgres)', () => {
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
    await adminDb.query(SHOW_TABLES)
    await adminDb.query(BOARD)
    await insert(adminDb, T05)
    await insert(adminDb, T03)
    // The order the coordinator applies them in, then again: show.sql's re-run drops this grant, rival_board.sql's puts it back.
    await adminDb.query(SHOW_SQL)
    await adminDb.query(RIVALS_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(RIVALS_SQL)
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

  it('gives the reader exactly the contract columns, in order: the server selects the same, and nothing else of the board', async () => {
    const r = await reader.query('select * from show.rival_board')
    expect(r.fields.map((f) => f.name)).toEqual(NAMES)
    expect([...COLUMNS]).toEqual(NAMES)
    expect(r.rows).toHaveLength(2)
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
    await expect(reader.query('select agent_note from show.rival_board')).rejects.toMatchObject({ code: '42703' })
  })

  it('runs the server\'s own query as the reader, best rank first, and every row parses into the wire type', async () => {
    const { rows } = await reader.query(SQL.board, [CAPS.board])
    expect(rows.map((x) => x.team)).toEqual(['t03', 't05'])
    // pg's own types, which server/rivals/rows.ts reads: numeric as text, text[] as an array, jsonb parsed
    expect(rows[1]).toMatchObject({ score: '412.5', strengths: ['negotiating', 'climbing'], guarded: true, trend_ticks: 30 })
    expect(rows[1].trend).toEqual([{ tick: 610, rank: 3, score: 394 }, { tick: 640, rank: 2, score: 412.5 }])
    const parsed = boardRowsOf(rows)
    expect(parsed.map((x) => [x.team, x.rank, x.guardReason, x.moveKind])).toEqual([['t03', 1, 'top5', 'hold'], ['t05', 2, 'near', 'swap']])
    expect(parsed[1]).toMatchObject({
      score: 412.5, negotiating: 120.25, ourMarket: 60.5, scoreChange: 18.5, setInterest: { LAV: 2.5, MAL: -1 },
      strengths: ['negotiating', 'climbing'], weaknesses: ['no_venue_trades'],
      weHaveForThem: [{ ref: 'LAV-09', spare: 1, theirPrice: 70, ourValue: 42.5 }],
      theyHaveForUs: [{ ref: 'MAL-02', theirPrice: 12, valueToUs: 17.5 }],
      moveGive: 'LAV-09', moveGet: 'MAL-02', movePrice: null, ourGain: 17.5, theirGain: 8, whyClimbedTick: 639,
    })
  })

  it('cannot read the agents\' board directly', async () => {
    await expect(reader.query('select team from public.rival_board limit 1')).rejects.toMatchObject({ code: '42501' })
  })

  it('a re-run of show.sql alone drops the grant (the server reads "not applied"); re-applying rival_board.sql restores it', async () => {
    await adminDb.query(SHOW_SQL)
    await expect(reader.query(SQL.board, [CAPS.board])).rejects.toMatchObject({ code: '42501' })
    await adminDb.query(RIVALS_SQL)
    expect((await reader.query(SQL.board, [CAPS.board])).rows).toHaveLength(2)
  })

  it('refuses to run before show.sql, and without the agents\' rival_board, with a clear message', async () => {
    const fresh = `rivals_bare_${randomBytes(4).toString('hex')}`
    await admin.query(`create database ${fresh}`)
    const bare = new pg.Client({ connectionString: withDb(ADMIN_URL ?? '', fresh) })
    await bare.connect()
    try {
      await bare.query(SHOW_TABLES)
      await expect(bare.query(RIVALS_SQL)).rejects.toThrow(/apply db\/show\.sql first/)
      await bare.query('rollback')
      await bare.query(SHOW_SQL)
      await expect(bare.query(RIVALS_SQL)).rejects.toThrow(
        "the agents' schema has no rival_board yet: deploy bazaar #224 (init_schema creates it), then re-run this file",
      )
      await bare.query('rollback')
      expect((await bare.query(`select to_regclass('show.rival_board') as v`)).rows[0].v).toBeNull()
    } finally {
      await bare.end()
      await admin.query(`drop database if exists ${fresh} with (force)`)
    }
  })

  it('the agents can only drop their board with cascade, which takes this view with it until the file runs again', async () => {
    await expect(adminDb.query('drop table public.rival_board')).rejects.toMatchObject({ code: '2BP01' })
    await adminDb.query('drop table public.rival_board cascade')
    await expect(reader.query(SQL.board, [CAPS.board])).rejects.toMatchObject({ code: '42P01' })
  })
})
