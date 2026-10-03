/**
 * Privacy proof for db/learn.sql, on a LOCAL Postgres 17 with synthetic rows.
 *
 *   sh scripts/test-sql.sh        # starts a throwaway container, runs db/*.test.ts, removes it
 *
 * Runs only when SHOW_TEST_ADMIN_URL is set, and only against a loopback host: it creates and drops a
 * database and a role, so it must never meet a shared server.
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ADMIN_URL = process.env.SHOW_TEST_ADMIN_URL
const SHOW_SQL = readFileSync(new URL('./show.sql', import.meta.url), 'utf8')
const LEARN_SQL = readFileSync(new URL('./learn.sql', import.meta.url), 'utf8')

/** The tables the views read (and two they must not), as bazaar's sql/schema.sql declares them today. */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table learnings (id bigserial primary key, scope text, subject text, claim text, stats jsonb, support_n int,
    confidence numeric, created_tick int, superseded_by bigint references learnings(id), subject_kind text, kind text,
    until_tick int, team text, evidence bigint[], source text, dedupe_key text, updated_at timestamptz, embedded_hash text);
  create table trader_behaviors (id bigserial primary key, trader_id text, thread_id bigint, tick int, event text,
    our_price int, their_price int, step int, final bool, words_match_structure bool, source text, dedupe_key text);
  create table dealer_curves (thread_id bigint primary key, dealer text, team text, item text, opening_ask int,
    asks int[], bids int[], final_ask int, outcome text, fill_price int, steps int, ticks int, ours boolean);
  create table competitor_profiles (team text primary key, updated_tick int, set_interest jsonb, avg_pack_price numeric,
    dealer_deal_rate numeric, concession_style jsonb, listings jsonb, fills jsonb, level int, venue text, notes jsonb);
  create table venue_broker_keys (target text not null, venue text not null, broker_key text not null, opened_tick int, primary key (target, venue));
  create table decisions (id bigserial primary key, tick int, reason text);
`

const SECRET_KEY = 'SECRET-BROKER-KEY-quux'
const SECRET_DEDUPE = 'SECRET-DEDUPE-frob'

const dbName = `learn_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe.skipIf(!ADMIN_URL)('db/learn.sql privacy (local Postgres)', () => {
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
    await adminDb.query(`
      insert into learnings (id, scope, subject_kind, subject, kind, claim, source, confidence, support_n, created_tick, until_tick, team, evidence, stats, dedupe_key, updated_at) values
        (1, 'trader', 'dealer', 'abuela', 'cooloff', 'abuela sent t01 away until 352', 'rules', 0.9, null, 340, 352, 't01', '{11,12,13}', '{"thread": 518}', '${SECRET_DEDUPE}', now()),
        (2, 'trader', 'dealer', 'abuela', 'lesson', 'old lesson', 'outcome', 0.4, 2, 100, null, null, '{}', null, 'k2', now()),
        (3, 'trader', 'dealer', 'chato', 'policy', 'chato ladder', 'outcome', 0.6, 5, 200, null, null, '{}', jsonb_build_object('big', repeat('x', 3000)), 'k3', now());
      update learnings set superseded_by = 3 where id = 2;
      insert into trader_behaviors (trader_id, thread_id, tick, event, our_price, their_price, step, final, source, dedupe_key) values
        ('abuela', 518, 345, 'concede', 5, 12, 2, false, 'ours', '${SECRET_DEDUPE}');
      insert into dealer_curves (thread_id, dealer, team, opening_ask, fill_price, steps, ticks, ours) values
        (1, 'abuela', 't01', 20, 10, 3, 5, true), (2, 'abuela', 't03', 20, 16, 2, 4, false), (3, 'abuela', 't04', 30, null, 4, 9, false);
      insert into competitor_profiles (team, updated_tick, set_interest, avg_pack_price, fills, notes, level, venue) values
        ('t03', 340, '{"LAV": 4}', 22.5, '{"buys": 3, "sells": 1, "spent": 60, "earned": 12}', '{"top_set": "LAV", "bids": 9}', 2, 'rastro');
      insert into venue_broker_keys values ('real', 'rastro', '${SECRET_KEY}', 1);
      insert into decisions (tick, reason) values (1, 'SECRET-REASON');
    `)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(LEARN_SQL)
    await adminDb.query(LEARN_SQL) // idempotent
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

  it('shows the learnings still on the books, with an evidence count and a capped stats', async () => {
    const { rows } = await reader.query('select * from show.learnings order by id')
    expect(rows.map((r) => r.id)).toEqual(['1', '3'])
    expect(rows[0]).toMatchObject({ kind: 'cooloff', subject: 'abuela', until_tick: 352, support: 3, confidence: 0.9, stats: { thread: 518 } })
    expect(rows[1]?.stats).toBeNull()
    expect(Object.keys(rows[0] ?? {})).not.toContain('dedupe_key')
    expect(Object.keys(rows[0] ?? {})).not.toContain('evidence')
    expect(JSON.stringify(rows)).not.toContain(SECRET_DEDUPE)
  })

  it('shows the dealer moves without their dedupe key', async () => {
    const { rows } = await reader.query('select * from show.trader_moves')
    expect(rows).toEqual([{ id: '1', trader: 'abuela', thread: '518', tick: 345, event: 'concede', our_price: 5, their_price: 12, step: 2, final: false, source: 'ours' }])
  })

  it('aggregates the dealer curves, all teams and ours', async () => {
    const { rows } = await reader.query('select * from show.dealer_stats')
    expect(rows[0]).toMatchObject({ dealer: 'abuela', threads: 3, deals: 2, our_threads: 1, our_deals: 1, fill_ratio: 0.65, our_fill_ratio: 0.5 })
  })

  it('shows rival profiles', async () => {
    const { rows } = await reader.query('select * from show.rival_profiles')
    expect(rows[0]).toMatchObject({ team: 't03', level: 2, venue: 'rastro', avg_pack_price: 22.5, set_interest: { LAV: 4 }, top_set: 'LAV' })
  })

  it('reads no table directly, and never the broker keys or decisions', async () => {
    for (const table of ['learnings', 'trader_behaviors', 'dealer_curves', 'competitor_profiles', 'venue_broker_keys', 'decisions']) {
      const error = await reader.query(`select * from public.${table}`).then(() => null, (e: unknown) => e)
      expect((error as { code?: string } | null)?.code, table).toBe('42501')
    }
  })

  it('keeps show.sql\'s own two views readable', async () => {
    await expect(reader.query('select count(*) from show.thread_lines')).resolves.toBeTruthy()
  })
})
