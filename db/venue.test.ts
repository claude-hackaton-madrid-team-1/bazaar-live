/**
 * Privacy proof for db/venue.sql, on a LOCAL Postgres 17 with synthetic rows.
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
const VENUE_SQL = readFileSync(new URL('./venue.sql', import.meta.url), 'utf8')

/** The tables the views read, as the agents' schema declares them today (bazaar sql/schema.sql). */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table me_snapshots (world text, team text, tick int, epoch bigint, digest text, read_at timestamptz default now(), read_by text,
    cash int, level int, cards jsonb, duplicates jsonb, packs jsonb, pages jsonb, affinity jsonb, score jsonb, me jsonb);
  create table decisions (id bigserial primary key, intent_id bigint, thread_id bigint, tick int, state_digest text, rag_context jsonb,
    candidates jsonb, jev jsonb, jev_digest text, policy_checks jsonb, chosen jsonb, status text, reason text, agent text, kind text, dry_run boolean);
  create table executions (id bigserial primary key, decision_id bigint, tick int, sdk_method text, request jsonb, response jsonb, error_code text);
  create table bench_books (world text not null, run text not null, tick int not null, offer_id text not null,
    side text not null check (side in ('sell','buy')), quote int, venue text, fee_bps int, fee_per_card int,
    offer jsonb not null, read_at timestamptz not null default now(), primary key (world, run, tick, offer_id));
  create table venue_broker_keys (target text not null, venue text not null, broker_key text not null, opened_tick int, created_at timestamptz default now());
`

const SECRET = 'SECRET-plugh'

const dbName = `venue_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

const listed = (id: number, maker: string, venue: string, ref: string, cash: number) =>
  JSON.stringify({ venue, offer: { id, maker, to: null, venue, created_tick: 1500, expires_tick: 1530, final: false, status: 'open',
    give: { cash: 0, types: [], assets: [{ id: id + 1, ref, kind: 'card', rarity: 'common', serial: 3 }] }, want: { cash, types: [], assets: [] } } })

describe.skipIf(!ADMIN_URL)('db/venue.sql (local Postgres)', () => {
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
    const score = (venue: string | null, bench: string | null, eff: number | null, points: number | null, mm: number) =>
      JSON.stringify({ score: 30, venue, bench_venue: bench, bench_efficiency: eff, bench_points: points, mm_points: mm, market: 8.4, luck_private: -62.5, name: SECRET })
    await adminDb.query(
      `insert into me_snapshots (world, team, tick, read_at, cash, score, me) values
        ('real', 't01', 1390, '2026-10-04 12:00:00+02', 90, $1, '{}'),
        ('real', 't01', 1400, '2026-10-04 12:02:30+02', 90, $1, '{}'),
        ('real', 't01', 1420, '2026-10-04 12:07:30+02', 90, $2, '{}'),
        ('real', 't01', 1430, '2026-10-04 12:10:00+02', 91, $2, '{}'),
        ('sim', 't01', 1431, '2026-10-04 12:10:01+02', 1, $3, '{}')`,
      [score('v19', 'v19', 0.769, 0.5, 2.1), score('v19', 'v19', 0.912, 0.5, 2.3), score('v99', 'v99', 1, 1, 9)],
    )
    await adminDb.query(
      `insert into feed_events (id, tick, type, actor, payload, received_at) values
        (1, 900, 'venue.opened', 't01', '{"venue": "v19", "name": "Team 1 market", "owner": "t01", "fee_bps": 0, "fee_per_card": 0, "rules": {"mechanism": "board"}, "bond": 250}', '2026-10-03 18:00:00+02'),
        (2, 905, 'venue.opened', 't05', '{"venue": "v05", "name": "Other", "owner": "t05", "fee_bps": 100, "rules": {"mechanism": "auto"}}', '2026-10-03 18:01:00+02'),
        (3, 1161, 'bench.started', '', '{"name": "The Market Test", "ticks": 16, "venues": ["v01", "v19"], "session": 5, "start_tick": 1161}', '2026-10-04 11:00:00+02'),
        (4, 1401, 'bench.started', '', '{"name": "The Market Test", "ticks": 16, "venues": ["v01", "v05"], "session": 6, "start_tick": 1401}', '2026-10-04 12:03:00+02'),
        (5, 1500, 'offer.listed', 't07', $1, '2026-10-04 12:30:00+02'),
        (6, 1500, 'offer.listed', 't08', $2, '2026-10-04 12:30:01+02'),
        (7, 1503, 'settlement', '', '{"venue": "v19", "price": 12, "fee": 0, "parties": ["t07", "t09"], "items": [{"id": 9002, "ref": "LAV-03", "frm": "t07", "to": "t09"}]}', '2026-10-04 12:31:00+02'),
        (8, 1504, 'settlement', '', '{"venue": "rastro", "price": 30, "fee": 2, "items": [{"id": 1, "ref": "SAL-01", "frm": "t02", "to": "t03"}]}', '2026-10-04 12:31:30+02'),
        (9, 1505, 'settlement.failed', '', '{"offer": 9001, "reason": "${SECRET}"}', '2026-10-04 12:32:00+02')`,
      [listed(9001, 't07', 'v19', 'LAV-03', 12), listed(9101, 't08', 'rastro', 'MAL-01', 9)],
    )
    const raw = JSON.stringify({ limit: 77, secret: SECRET })
    await adminDb.query(
      `insert into bench_books (world, run, tick, offer_id, side, quote, venue, fee_bps, fee_per_card, offer, read_at) values
        ('real', 'b35', 1402, 'b35-1', 'sell', 40, 'v19', 0, 0, $1, '2026-10-04 12:03:30+02'),
        ('real', 'b35', 1402, 'b35-2', 'buy', 62, 'v19', 0, 0, $1, '2026-10-04 12:03:30+02'),
        ('real', 'b35', 1402, 'b35-3', 'buy', 30, 'v19', 0, 0, $1, '2026-10-04 12:03:30+02'),
        ('real', 'b35', 1404, 'b35-3', 'buy', 31, 'v19', 0, 0, $1, '2026-10-04 12:04:00+02'),
        ('real', 'b35', 1404, 'b35-4', 'sell', 50, 'v19', 0, 0, $1, '2026-10-04 12:04:00+02'),
        ('sim', 'b99', 1402, 'b99-1', 'sell', 1, 'v19', 0, 0, $1, '2026-10-04 12:03:30+02')`,
      [raw],
    )
    await adminDb.query(
      `insert into decisions (id, tick, agent, kind, status, dry_run, policy_checks, candidates, chosen, reason, state_digest, rag_context) values
        (1, 880, 'broker', 'venue_open', 'done', false, '{"allowed": true, "guardrail": "allowed"}', '{"name": "Team 1 market", "mechanism": "board", "fee_bps": 0, "t_hours": 3.6}', null, '${SECRET}', '${SECRET}', null),
        (2, 1403, 'broker', 'broker_match', 'done', false, '{"allowed": true, "guardrail": "allowed"}', $1, $2, 'maximum-surplus matching (exact), midpoint price ${SECRET}', '${SECRET}', '{"x": "${SECRET}"}'),
        (3, 1405, 'broker', 'broker_match', 'failed', false, '{"allowed": true, "guardrail": "allowed"}', '{"item": "bench:b35", "bench": true, "ask": 50, "bid": 31, "surplus": -19, "price": 40, "fee": 0}', null, 'x', null, null),
        (4, 1406, 'broker', 'broker_match', 'approved', true, '{"allowed": true}', '{"item": "bench:b35", "ask": 1, "bid": 99}', null, 'dry', null, null),
        (5, 1407, 'taker', 'accept_ask', 'done', false, '{"allowed": true}', '{"ref": "LAV-01"}', null, 'x', null, null),
        (6, 1502, 'broker', 'broker_match', 'rejected', false, '{"allowed": false, "guardrail": "denied: makers b-x b-y are ours"}', '{"item": "card:LAV-03", "bench": false, "ask": 10, "bid": 12, "price": 11, "fee": 0, "surplus": 2, "makers": ["${SECRET}"]}', null, 'x', null, null)`,
      [JSON.stringify({ item: 'bench:b35', bench: true, ask: 40, bid: 62, makers: ['b35-1', 'b35-2'], fee: 0, surplus: 22, sell: 'b35-1', buy: 'b35-2', price: 51, note: SECRET }), JSON.stringify({ sell: 'b35-1', buy: 'b35-2', price: 51 })],
    )
    await adminDb.query(
      `insert into executions (decision_id, tick, sdk_method, request, response, error_code) values
        (2, 1403, 'broker_match', '{"k": "${SECRET}"}', '{"queued": true, "settles_at_tick": 1404}', null),
        (3, 1405, 'broker_match', '{}', null, 'wait_for_tick')`,
    )
    await adminDb.query(`insert into venue_broker_keys (target, venue, broker_key) values ('real', 'v19', '${SECRET}')`)
    // The order the coordinator applies them in, then again: show.sql's re-run drops these grants, venue.sql's puts them back.
    await adminDb.query(SHOW_SQL)
    await adminDb.query(VENUE_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(VENUE_SQL)
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

  it('names our venue: board, 0 bps, open, the one /me counts for the Market Test; never a rival venue', async () => {
    const r = await reader.query('select * from show.venue_ours order by venue')
    expect(r.rows).toEqual([
      expect.objectContaining({ venue: 'v19', name: 'Team 1 market', mechanism: 'board', fee_bps: 0, fee_per_card: 0, status: 'open', opened_tick: 900, current: true, counted: true, me_tick: 1430 }),
    ])
  })

  it('lists every announced session, and whether our venue got its book', async () => {
    const r = await reader.query('select session, start_tick, ticks, venues, ours from show.venue_sessions order by id')
    expect(r.rows).toEqual([
      { session: 5, start_tick: 1161, ticks: 16, venues: 2, ours: true },
      { session: 6, start_tick: 1401, ticks: 16, venues: 2, ours: false },
    ])
  })

  it('reads each bench run once per trader, put on its session, never the raw offer or a simulator run', async () => {
    const r = await reader.query('select * from show.venue_books')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ run: 'b35', first_tick: 1402, last_tick: 1404, ticks_seen: 2, venue: 'v19', fee_bps: 0, session: 6, start_tick: 1401 })
    expect(r.rows[0].offers).toEqual([
      { id: 'b35-3', side: 'buy', quote: 30, first: 1402, last: 1404 },
      { id: 'b35-2', side: 'buy', quote: 62, first: 1402, last: 1402 },
      { id: 'b35-1', side: 'sell', quote: 40, first: 1402, last: 1402 },
      { id: 'b35-4', side: 'sell', quote: 50, first: 1404, last: 1404 },
    ])
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
    expect(JSON.stringify(r.rows)).not.toContain('limit')
  })

  it("gives our broker's matches with only their listed fields: no dry run, no other agent, the error code only", async () => {
    const r = await reader.query('select * from show.venue_matches order by id')
    expect(r.rows.map((x) => x.id)).toEqual(['2', '3', '6'])
    expect(r.rows[0]).toEqual({ id: '2', tick: 1403, kind: 'broker_match', status: 'done', bench: true, run: 'b35', card: null, ask: 40, bid: 62, price: 51, fee: 0, surplus: '22.0', allowed: true, guardrail: null, error_code: null })
    expect(r.rows[1]).toMatchObject({ status: 'failed', error_code: 'wait_for_tick' })
    expect(r.rows[2]).toMatchObject({ bench: false, card: 'LAV-03', status: 'rejected', guardrail: 'denied: makers b-x b-y are ours' })
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
  })

  it('shows what other teams did on our venue only', async () => {
    const r = await reader.query('select type, venue, card, price, fee, side, maker, buyer, seller, offer from show.venue_trades order by id')
    expect(r.rows).toEqual([
      { type: 'listed', venue: 'v19', card: 'LAV-03', price: 12, fee: null, side: 'sell', maker: 't07', buyer: null, seller: null, offer: 9001 },
      { type: 'settled', venue: 'v19', card: 'LAV-03', price: 12, fee: 0, side: null, maker: null, buyer: 't09', seller: 't07', offer: null },
      { type: 'failed', venue: 'v19', card: null, price: null, fee: null, side: null, maker: null, buyer: null, seller: null, offer: 9001 },
    ])
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
  })

  it('keeps our Market Test numbers where they changed, never the score object', async () => {
    const r = await reader.query('select tick, venue, bench_venue, bench_efficiency::float8 as eff, bench_points::float8 as points, mm_points::float8 as mm from show.venue_score order by day, tick')
    expect(r.rows).toEqual([
      { tick: 1390, venue: 'v19', bench_venue: 'v19', eff: 0.769, points: 0.5, mm: 2.1 },
      { tick: 1420, venue: 'v19', bench_venue: 'v19', eff: 0.912, points: 0.5, mm: 2.3 },
      { tick: 1430, venue: 'v19', bench_venue: 'v19', eff: 0.912, points: 0.5, mm: 2.3 },
    ])
    const all = await reader.query('select * from show.venue_score')
    expect(JSON.stringify(all.rows)).not.toContain('luck_private')
    expect(JSON.stringify(all.rows)).not.toContain(SECRET)
  })

  it.each(['public.me_snapshots', 'public.decisions', 'public.executions', 'public.feed_events', 'public.bench_books', 'public.venue_broker_keys'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })
})
