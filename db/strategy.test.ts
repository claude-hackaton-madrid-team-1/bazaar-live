/**
 * Privacy proof for db/strategy.sql, on a LOCAL Postgres 17 with synthetic rows.
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
const STRATEGY_SQL = readFileSync(new URL('./strategy.sql', import.meta.url), 'utf8')

/** The tables the views read, as the agents' schema declares them today. */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create index on feed_events (tick);
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table me_snapshots (world text, team text, tick int, epoch bigint, digest text, read_at timestamptz default now(), read_by text,
    cash int, level int, cards jsonb, duplicates jsonb, packs jsonb, pages jsonb, affinity jsonb, score jsonb, me jsonb);
  create table ledger (id bigserial primary key, kind text, tick int, t_hours float8, price int, item text, source text, created_at timestamptz default now(), slot int);
  create table decisions (id bigserial primary key, intent_id bigint, thread_id bigint, tick int, state_digest text, rag_context jsonb,
    candidates jsonb, jev jsonb, jev_digest text, policy_checks jsonb, chosen jsonb, status text, reason text, agent text, kind text, dry_run boolean);
  create table cards (id text primary key, set_code text, name text, rarity text, book numeric, print_run int, minted int, released boolean,
    updated_tick int, set_name text, page boolean, hidden boolean, flavour text);
  create table tape (settlement_id bigint primary key, tick int, venue text, persona text, buyer text, seller text, items jsonb, card_id text, price int, fee int);
`

const SECRET = 'SECRET-plugh'

const dbName = `strategy_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

const offer = (id: number, maker: string, asset: number, ref: string, cash: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ venue: 'rastro', offer: { id, maker, to: null, venue: 'rastro', created_tick: 620, expires_tick: 640, final: false, status: 'open',
    give: { cash: 0, types: [], assets: [{ id: asset, ref, set: ref.slice(0, 3), kind: 'card', rarity: 'common', serial: 3, print_run: 300 }] },
    want: { cash, types: [], assets: [] }, ...extra } })

describe.skipIf(!ADMIN_URL)('db/strategy.sql (local Postgres)', () => {
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
    await adminDb.query(
      `insert into me_snapshots (world, team, tick, read_at, cash, level, cards, pages, affinity, score, me) values
        ('real', 't01', 628, '2026-10-03 13:24:00+02', 90, 3, '[]', '[]', '{}', '{}', '{}'),
        ('real', 't01', 629, '2026-10-03 13:24:25+02', 81, 3,
         $1, '[{"set": "LAV", "name": "Lavapiés", "have": 8, "of": 10, "complete": false}, "odd"]',
         $2, $3, $4),
        ('sim', 't01', 999, '2026-10-03 13:30:00+02', 1, 1, '[]', '[]', '{}', '{}', '{}')`,
      [
        JSON.stringify([{ ref: 'LAV-01', set: 'LAV', asset: 3, rarity: 'common', serial: 1, your_value: 16, secret: SECRET }, { ref: 'LAT-02', set: 'LAT', asset: 816, rarity: 'common', your_value: 1.2 }]),
        JSON.stringify({ LAV: 1.6, LAT: 0.5, note: SECRET }),
        JSON.stringify({ venue: 'v19', luck_private: -62.5, name: SECRET }),
        JSON.stringify({ tick_seconds: 15, collection_value: 999, open_threads: [SECRET] }),
      ],
    )
    await adminDb.query(
      `insert into ledger (kind, tick, t_hours, price, item, source) values
        ('spend', 500, 5.4, 70, 'SAL-09 ${SECRET}', 'taker'),
        ('spend', 610, 6.40, 30, 'LAV-06', 'taker'),
        ('spend', 612, 6.42, -10, 'LAV-06', 'taker'),
        ('listing', 625, 6.5, 12, 'LAT-03', 'maker')`,
    )
    await adminDb.query(
      `insert into decisions (id, tick, agent, kind, status, dry_run, policy_checks, candidates, chosen, jev, reason, rag_context, state_digest) values
        (1, 584, 'taker', 'accept_ask', 'rejected', false, '{"allowed": false, "guardrail": "denied: cash 81 - 79 < cash_floor 50"}',
         $1, null, null, 'worth 70×1.1 + bonus share 36.4 = 113.4; ask 74 + fee 5 on rastro = 79', $2, $3),
        (2, 629, 'taker', 'team_open', 'rejected', false, '{"allowed": true, "guardrail": "allowed"}',
         '{"fee": 2, "team": "t02", "give_card": "SAL-10", "want_card": "LAT-07", "venue": "rastro"}', null,
         '{"value": 0.29, "verdict": "undecided", "reason": "below_threshold", "digest": "${SECRET}", "probabilities": {"x": 1}}', 'jev undecided (0.29 < 0.75 or not yes, below_threshold)', null, null),
        (3, 630, 'duels', 'duel_hold', 'approved', false, '{"allowed": true, "guardrail": "allowed"}', '{"our_limit": 100, "item": "${SECRET}"}', null, null, 'nothing inside our limit yet: wait', null, null),
        (4, 630, 'taker', 'accept_ask', 'rejected', true, '{"allowed": false, "guardrail": "denied: cash 1 - 1 < cash_floor 50"}', '{"ref": "DRY-01"}', null, null, 'dry run', null, null),
        (5, 626, 'taker', 'process_started', 'done', false, '{"allowed": false, "guardrail": "-"}', '{"owner": "${SECRET}"}', null, null, 'start', null, null)`,
      [
        JSON.stringify({ ref: 'MAL-10', ask: 74, fee: 5, total: 79, value: 113.4, surplus: 34.4, venue: 'rastro', rarity: 'rare', maker: 'm8e00f1ce', offer_id: 8435, recalled: [SECRET] }),
        JSON.stringify({ hint: SECRET }),
        SECRET,
      ],
    )
    await adminDb.query(
      `insert into feed_events (id, tick, type, actor, payload, received_at) values
        (100, 620, 'offer.listed', 't17', $1, '2026-10-03 13:20:00+02'),
        (101, 620, 'offer.listed', 't01', $2, '2026-10-03 13:20:01+02'),
        (102, 621, 'offer.listed', 't18', $3, '2026-10-03 13:20:30+02'),
        (103, 621, 'offer.listed', 't19', $4, '2026-10-03 13:20:31+02'),
        (104, 622, 'offer.listed', 't20', $5, '2026-10-03 13:21:00+02'),
        (105, 623, 'offer.cancelled', '', '{"offer": 9003, "venue": "rastro"}', '2026-10-03 13:21:30+02'),
        (106, 624, 'settlement', '', '{"price": 9, "items": [{"id": 504, "to": "t05", "frm": "t19", "ref": "LAV-03"}]}', '2026-10-03 13:22:00+02'),
        (107, 630, 'clock.changed', '', '{}', '2026-10-03 13:30:00+02'),
        (50, 630, 'offer.listed', 't21', $6, '2026-10-02 18:00:00+02')`,
      [
        offer(9001, 't17', 501, 'LAV-01', 7),
        offer(9002, 't01', 816, 'LAT-02', 10),
        offer(9003, 't18', 503, 'LAV-02', 8),
        offer(9004, 't19', 504, 'LAV-03', 9),
        offer(9005, 't20', 505, 'MAL-01', 12, { to: 't01', expires_tick: 660 }),
        offer(8000, 't21', 506, 'MAL-02', 3, { expires_tick: 700 }),
      ],
    )
    await adminDb.query(
      `insert into cards (id, set_code, name, rarity, book, print_run, minted, released, set_name, page, hidden, flavour) values
        ('LAV-09', 'LAV', 'Cine Doré', 'rare', 70, 30, 7, true, 'Lavapiés', true, false, '${SECRET}'),
        ('LAV-11', 'LAV', 'La Casa Encendida', 'epic', 180, 9, 1, true, 'Lavapiés', false, false, null),
        ('CHA-01', 'CHA', 'Unreleased', 'common', 5, 300, 0, false, 'Chamberí', true, false, null)`,
    )
    await adminDb.query(
      `insert into tape (settlement_id, tick, venue, persona, buyer, seller, items, card_id, price, fee) values
        (1, 600, 'rastro', null, 't03', 't04', '[]', 'LAV-09', 82, 5),
        (2, 610, null, 'chato', 't05', 'chato', '[]', 'LAV-09', 90, 0),
        (3, 611, 'rastro', null, 't06', 't07', '[]', 'LAV-09', 0, 2)`,
    )
    // The order the coordinator applies them in, then again: show.sql's re-run drops these grants, strategy.sql's puts them back.
    await adminDb.query(SHOW_SQL)
    await adminDb.query(STRATEGY_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(STRATEGY_SQL)
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

  it('reads our latest real snapshot field by field: numbers only in the affinity, never the score or me objects', async () => {
    const r = await reader.query('select * from show.strategy_me')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ team: 't01', tick: 629, cash: 81, level: 3, venue: 'v19', tick_seconds: 15, affinity: { LAV: 1.6, LAT: 0.5 } })
    expect(r.rows[0].pages).toEqual([{ set: 'LAV', name: 'Lavapiés', have: 8, of: 10, complete: false }])
    expect(r.rows[0].cards).toEqual([
      { ref: 'LAV-01', set: 'LAV', rarity: 'common', asset: 3, value: 16 },
      { ref: 'LAT-02', set: 'LAT', rarity: 'common', asset: 816, value: 1.2 },
    ])
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
    expect(JSON.stringify(r.rows)).not.toContain('luck_private')
    expect(JSON.stringify(r.rows)).not.toContain('collection_value')
  })

  it('sums the last game hour of spend, refunds netted, from now (the ledger moved on by the ticks since)', async () => {
    // now = 6.5 + (629 - 625) × 15 s = 6.5167 h: the 5.4 h spend is out, 30 - 10 is in
    const r = await reader.query('select ledger_tick, t_hours::float8 as t_hours, spent, buys from show.strategy_spend')
    expect(r.rows).toEqual([{ ledger_tick: 625, t_hours: 6.5167, spent: 20, buys: 1 }])
  })

  it('gives the taker and the maker decisions with only their listed fields: no duel, dry run or start row', async () => {
    const r = await reader.query('select * from show.strategy_decisions order by id')
    expect(r.rows.map((x) => x.id)).toEqual(['1', '2'])
    expect(r.rows[0]).toMatchObject({
      tick: 584, agent: 'taker', kind: 'accept_ask', status: 'rejected', allowed: false, guardrail: 'denied: cash 81 - 79 < cash_floor 50',
      card: 'MAL-10', rarity: 'rare', venue: 'rastro', price: 74, fee: 5, total: 79, our_value: '113.4', surplus: '34.4',
    })
    expect(r.rows[1]).toMatchObject({ card: 'LAT-07', give_card: 'SAL-10', jev_value: '0.29', jev_verdict: 'undecided', jev_reason: 'below_threshold', guardrail: null })
    expect(Object.keys(r.rows[0])).toEqual(['id', 'tick', 'agent', 'kind', 'status', 'allowed', 'guardrail', 'card', 'give_card', 'rarity', 'venue', 'price', 'fee', 'total',
      'our_value', 'surplus', 'jev_value', 'jev_verdict', 'jev_reason', 'reason'])
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
    expect(JSON.stringify(r.rows)).not.toContain('our_limit')
  })

  it('lists the asks open now: not cancelled, not settled, not expired, not from an earlier day; ours flagged', async () => {
    const r = await reader.query('select offer, card, price, maker, to_team, ours from show.strategy_asks order by offer')
    expect(r.rows).toEqual([
      { offer: 9001, card: 'LAV-01', price: 7, maker: 't17', to_team: null, ours: false },
      { offer: 9002, card: 'LAT-02', price: 10, maker: 't01', to_team: null, ours: true },
      { offer: 9005, card: 'MAL-01', price: 12, maker: 't20', to_team: 't01', ours: false },
    ])
  })

  it('gives the released catalog with the last paid fill, never a swap\'s 0 or the flavour', async () => {
    const r = await reader.query('select * from show.strategy_cards order by card')
    expect(r.rows.map((x) => [x.card, x.page, x.last_fill, x.last_fill_tick])).toEqual([['LAV-09', true, 90, 610], ['LAV-11', false, null, null]])
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
  })

  it.each(['public.me_snapshots', 'public.decisions', 'public.feed_events', 'public.ledger', 'public.duels'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })
})
