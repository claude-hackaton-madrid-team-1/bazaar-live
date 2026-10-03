/**
 * db/game.sql's show.game_our_offers and db/history.sql's show.our_orders, on a LOCAL Postgres 17 with synthetic rows:
 * what became of each board offer of ours, and a listing posted by hand read as its offer.
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
const GAME_SQL = readFileSync(new URL('./game.sql', import.meta.url), 'utf8')
const HISTORY_SQL = readFileSync(new URL('./history.sql', import.meta.url), 'utf8')

const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table me_snapshots (world text, team text, tick int, epoch bigint, digest text, read_at timestamptz default now(), read_by text,
    cash int, level int, cards jsonb, duplicates jsonb, packs jsonb, pages jsonb, affinity jsonb, score jsonb, me jsonb);
  create table threads (id bigint primary key, counterpart text, kind text, topic jsonb, venue text, status text, opened_tick int,
    closed_tick int, closed_reason text, ours boolean, updated_tick int, until_tick int);
  create table messages (id bigint primary key, thread_id bigint, sender text, tick int, text text, price int, offer jsonb, final boolean,
    embedding text, ours boolean, tactic text);
  create table decisions (id bigint primary key, intent_id bigint, thread_id bigint, tick int, state_digest text, rag_context jsonb,
    candidates jsonb, jev jsonb, jev_digest text, policy_checks jsonb, chosen jsonb, status text, reason text, agent text, kind text, dry_run boolean);
  create table tape (settlement_id bigint primary key, tick int, venue text, persona text, buyer text, seller text, items jsonb,
    card_id text, price int, fee int);
  create table ledger (id bigserial primary key, kind text, tick int, t_hours numeric, price int, item text, source text, created_at timestamptz default now());
`

/** An offer.listed row as the game sends it: an ask gives a copy for cash, a bid gives cash for any copy of a card. */
const ask = (id: number, venue: string, asset: number, ref: string, price: number, created: number, expires: number, maker = 't01') =>
  JSON.stringify({ venue, offer: { id, maker, venue, to: null, give: { cash: 0, types: [], assets: [{ id: asset, ref, kind: 'card' }] }, want: { cash: price, types: [], assets: [] }, created_tick: created, expires_tick: expires } })
const bid = (id: number, venue: string, ref: string, price: number, created: number, expires: number) =>
  JSON.stringify({ venue, offer: { id, maker: 't01', venue, to: null, give: { cash: price, types: [], assets: [] }, want: { cash: 0, types: [`card:${ref}`], assets: [] }, created_tick: created, expires_tick: expires } })
const fill = (venue: string, frm: string, to: string, asset: number, ref: string, price: number) =>
  JSON.stringify({ venue, price, fee: 1, parties: [frm, to], items: [{ id: asset, ref, frm, to, kind: 'card' }] })

const dbName = `offers_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe.skipIf(!ADMIN_URL)('db/game.sql show.game_our_offers and db/history.sql show.our_orders (local Postgres)', () => {
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
    await adminDb.query(`insert into me_snapshots (world, team, tick, read_at) values ('real', 't01', 500, now())`)
    // The newest tick is 500. Feed ids grow with time; an offer's fate is whatever came first after its listing.
    await adminDb.query(
      `insert into feed_events (id, tick, type, actor, payload) values
        (90,  100, 'settlement', '', $10),
        (100, 300, 'offer.listed', 't01', $1),
        (110, 400, 'offer.listed', 't01', $2),
        (111, 401, 'offer.cancelled', '', '{"offer": 2, "venue": "v01"}'),
        (120, 410, 'offer.listed', 't01', $3),
        (121, 420, 'settlement', '', $11),
        (130, 420, 'offer.listed', 't01', $4),
        (131, 430, 'settlement', '', $12),
        (140, 430, 'offer.listed', 't01', $5),
        (150, 440, 'offer.listed', 't01', $6),
        (151, 445, 'venue.closing', '', '{"venue": "v09", "refund_at_tick": 455}'),
        (160, 450, 'offer.listed', 't04', $7),
        (170, 460, 'offer.listed', 't01', $8),
        (171, 465, 'settlement', '', $13),
        (180, 470, 'offer.listed', 't01', $9),
        (181, 480, 'offer.cancelled', '', '{"offer": 9, "venue": "v01"}'),
        (182, 481, 'settlement', '', $14),
        (200, 500, 'offer.cancelled', '', '{"offer": 999}')`,
      [
        bid(1, 'v02', 'RET-08', 16, 300, 600), // 1: a hand-placed bid, far behind the feed replay, still open
        ask(2, 'v01', 7, 'LAV-02', 9, 400, 520), // 2: cancelled
        ask(3, 'v01', 8, 'SAL-03', 8, 410, 520), // 3: its copy sold: settled
        bid(4, 'v05', 'RET-01', 12, 420, 520), // 4: a copy of its card bought on its venue at its price: settled
        bid(5, 'v02', 'MAL-02', 20, 430, 450), // 5: a hand-placed bid that expired at 450
        ask(6, 'v09', 9, 'LAT-02', 10, 440, 520), // 6: its venue closed
        ask(7, 'v01', 10, 'LAV-03', 5, 450, 520, 't04'), // 7: another team's
        bid(8, 'v05', 'RET-02', 10, 460, 520), // 8: a copy bought at another price: still open
        ask(9, 'v01', 11, 'LAV-04', 6, 470, 520), // 9: cancelled before its copy sold elsewhere
        // 90: a sale of offer 3's copy BEFORE it was listed does not count
        fill('v01', 't01', 't06', 8, 'SAL-03', 7),
        fill('v01', 't01', 't06', 8, 'SAL-03', 8),
        fill('v05', 't03', 't01', 55, 'RET-01', 12),
        fill('v05', 't03', 't01', 56, 'RET-02', 11),
        fill('v01', 't01', 't06', 11, 'LAV-04', 6),
      ],
    )
    // A hand bid writes two ledger rows: its spend, then the listing that keeps the maker off it.
    await adminDb.query(`insert into ledger (id, kind, tick, t_hours, price, item, source, created_at) values
      (1, 'spend', 300, 3.0, 16, 'RET-08', 'sell', '2026-10-03 12:00:00+02'),
      (2, 'listing', 300, 3.0, 16, 'hands-off:1', 'sell', '2026-10-03 12:00:00+02'),
      (3, 'listing', 410, 4.1, 8, 'SAL-03', 'maker', '2026-10-03 12:30:00+02'),
      (4, 'listing', 430, 4.3, 20, 'hands-off:5', 'sell', '2026-10-03 12:40:00+02'),
      (5, 'listing', 431, 4.3, 0, 'team:77', 'taker', '2026-10-03 12:41:00+02'),
      (6, 'listing', 432, 4.3, 3, 'hands-off:404', 'sell', '2026-10-03 12:42:00+02')`)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(GAME_SQL)
    await adminDb.query(HISTORY_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(GAME_SQL)
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

  it('says what became of every board offer of ours, and which were posted by hand', async () => {
    const r = await reader.query('select offer, side, card, venue, price, expires_tick, status, hand from show.game_our_offers order by offer')
    expect(r.rows).toEqual([
      { offer: 1, side: 'bid', card: 'RET-08', venue: 'v02', price: 16, expires_tick: 600, status: 'open', hand: true },
      { offer: 2, side: 'ask', card: 'LAV-02', venue: 'v01', price: 9, expires_tick: 520, status: 'cancelled', hand: false },
      { offer: 3, side: 'ask', card: 'SAL-03', venue: 'v01', price: 8, expires_tick: 520, status: 'settled', hand: false },
      { offer: 4, side: 'bid', card: 'RET-01', venue: 'v05', price: 12, expires_tick: 520, status: 'settled', hand: false },
      { offer: 5, side: 'bid', card: 'MAL-02', venue: 'v02', price: 20, expires_tick: 450, status: 'expired', hand: true },
      { offer: 6, side: 'ask', card: 'LAT-02', venue: 'v09', price: 10, expires_tick: 520, status: 'cancelled', hand: false },
      { offer: 8, side: 'bid', card: 'RET-02', venue: 'v05', price: 10, expires_tick: 520, status: 'open', hand: false },
      { offer: 9, side: 'ask', card: 'LAV-04', venue: 'v01', price: 6, expires_tick: 520, status: 'cancelled', hand: false },
    ])
  })

  it('hands over the listing row unchanged, so the screens rebuild the offer from it', async () => {
    const r = await reader.query("select id, tick, type, actor, payload from show.game_our_offers where status = 'open' order by id")
    expect(r.rows.map((x: { id: number }) => x.id)).toEqual([100, 170])
    expect(r.rows[0]).toEqual({ id: 100, tick: 300, type: 'offer.listed', actor: 't01', payload: JSON.parse(bid(1, 'v02', 'RET-08', 16, 300, 600)) })
  })

  it('reads a listing posted by hand as its offer, with what became of it', async () => {
    const r = await reader.query('select id::int, kind, item, agent, offer, offer_side, offer_card, offer_venue, offer_expires, offer_status from show.our_orders order by id')
    expect(r.rows).toEqual([
      { id: 1, kind: 'spend', item: 'RET-08', agent: 'sell', offer: null, offer_side: null, offer_card: null, offer_venue: null, offer_expires: null, offer_status: null },
      { id: 2, kind: 'listing', item: 'hands-off:1', agent: 'sell', offer: 1, offer_side: 'bid', offer_card: 'RET-08', offer_venue: 'v02', offer_expires: 600, offer_status: 'open' },
      { id: 3, kind: 'listing', item: 'SAL-03', agent: 'maker', offer: null, offer_side: null, offer_card: null, offer_venue: null, offer_expires: null, offer_status: null },
      { id: 4, kind: 'listing', item: 'hands-off:5', agent: 'sell', offer: 5, offer_side: 'bid', offer_card: 'MAL-02', offer_venue: 'v02', offer_expires: 450, offer_status: 'expired' },
      { id: 5, kind: 'listing', item: 'team:77', agent: 'taker', offer: null, offer_side: null, offer_card: null, offer_venue: null, offer_expires: null, offer_status: null },
      // an offer the feed never listed (another world, a failed post): the row stays, without its offer
      { id: 6, kind: 'listing', item: 'hands-off:404', agent: 'sell', offer: null, offer_side: null, offer_card: null, offer_venue: null, offer_expires: null, offer_status: null },
    ])
  })

  it.each(['public.ledger', 'public.feed_events'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })
})
