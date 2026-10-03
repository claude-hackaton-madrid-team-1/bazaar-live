/**
 * Proof for db/rival_albums.sql, on a LOCAL Postgres 17 with synthetic rows: who holds what by the public feed, and
 * nothing of ours (no snapshot, decision or ledger row) in any view.
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
const RIVALS_SQL = readFileSync(new URL('./rival_albums.sql', import.meta.url), 'utf8')

/** The tables the views read (and three they must never read), as the agents' schema declares them today. */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table me_snapshots (world text, team text, tick int, epoch bigint, digest text, read_at timestamptz default now(), read_by text,
    cash int, level int, cards jsonb, duplicates jsonb, packs jsonb, pages jsonb, affinity jsonb, score jsonb, me jsonb);
  create table cards (id text primary key, set_code text, name text, rarity text, book numeric, print_run int, minted int, released boolean,
    updated_tick int, set_name text, page boolean, hidden boolean, flavour text);
  create table leaderboard_snapshots (world text, tick int, team text, rank int, score numeric, negotiating numeric, market numeric,
    level int, pages int, deals int, venue text, read_at timestamptz);
  create table competitor_profiles (team text primary key, updated_tick int, set_interest jsonb, avg_pack_price numeric, dealer_deal_rate numeric,
    concession_style jsonb, listings jsonb, fills jsonb, level int, venue text, notes jsonb);
`

const SECRET = 'SECRET-plugh'

const dbName = `rivals_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

const item = (id: number, ref: string, frm: string, to: string, extra: Record<string, unknown> = {}) =>
  ({ id, ref, frm, to, kind: 'card', serial: 3, name: 'x', ...extra })
const settlement = (...items: Record<string, unknown>[]) => JSON.stringify({ kind: 'trade', price: 9, fee: 0, items, parties: [] })
const listing = (offer: number, maker: string, give: { id: number; ref: string }[], want: Record<string, unknown> = { cash: 9, types: [], assets: [] }) =>
  JSON.stringify({ venue: 'rastro', offer: { id: offer, maker, to: null, venue: 'rastro', give: { cash: 0, types: [], assets: give.map((a) => ({ ...a, kind: 'card', rarity: 'rare' })) }, want } })
const bid = (offer: number, maker: string, ref: string, cash: number) =>
  JSON.stringify({ venue: 'rastro', offer: { id: offer, maker, to: null, venue: 'rastro', give: { cash, types: [], assets: [] }, want: { cash: 0, types: [`card:${ref}`], assets: [] } } })

describe.skipIf(!ADMIN_URL)('db/rival_albums.sql (local Postgres)', () => {
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
    // our own rows: no view may read them
    await adminDb.query(
      `insert into me_snapshots (world, team, tick, cash, level, cards, pages, affinity, score, me) values
        ('real', 't01', 100, 81, 3, $1, '[]', '{"LAV": 1.6}', '{}', '{}')`,
      [JSON.stringify([{ ref: 'LAV-10', your_value: 999, note: SECRET }])],
    )
    await adminDb.query(
      `insert into cards (id, set_code, name, rarity, book, print_run, minted, released, set_name, page, hidden, flavour) values
        ('LAV-09', 'LAV', 'Cine Doré', 'rare', 70, 30, 7, true, 'Lavapiés', true, false, '${SECRET}'),
        ('LAV-10', 'LAV', 'Fiesta de San Cayetano', 'rare', 70, 30, 7, true, 'Lavapiés', true, false, null),
        ('MAL-06', 'MAL', 'Tienda de Discos', 'uncommon', 25, 90, 9, true, 'Malasaña', true, false, null),
        ('RET-01', 'RET', 'La Castañera', 'common', 10, 300, 20, true, 'El Retiro', true, false, null),
        ('SAL-02', 'SAL', 'El Portero', 'common', 10, 300, 20, true, 'Salamanca', true, false, null)`,
    )
    await adminDb.query(
      `insert into feed_events (id, tick, type, actor, payload) values
        -- asset 501 (LAV-09): bought by t05, then listed by t05 (same run), then sold to t07
        (10, 100, 'settlement', '', $1),
        (11, 110, 'offer.listed', 't05', $2),
        (12, 120, 'settlement', '', $3),
        -- asset 502 (LAV-10): a pack's best for t07, later seen listed by t07
        (13, 130, 'pack.opened', '', '{"team": "t07", "pack": "sobre_barrio", "best": {"id": 502, "ref": "LAV-10", "rarity": "rare"}}'),
        (14, 140, 'offer.listed', 't07', $4),
        -- a pack with no best names nothing
        (15, 141, 'pack.opened', '', '{"team": "t09", "pack": "sobre_barrio", "best": null}'),
        -- t03 is gifted RET-01 and later sells a RET-01: gone; t04 is gifted RET-01 and later lists it: counted once
        (16, 150, 'gift.given', 'abuela', '{"team": "t03", "cards": ["RET-01"], "packs": [], "cash": 0}'),
        (17, 151, 'gift.given', 'abuela', '{"team": "t04", "cards": ["RET-01", "not a card"], "packs": [], "cash": 0}'),
        (18, 160, 'settlement', '', $5),
        (19, 161, 'offer.listed', 't04', $6),
        -- t08 crafts a Tienda de Discos (MAL-06) and keeps it; t02 is gifted SAL-02 and keeps it
        (20, 170, 'taller.crafted', '', '{"team": "t08", "card": "Tienda de Discos", "from": "common", "to": "uncommon"}'),
        (21, 171, 'gift.given', 'abuela', '{"team": "t02", "cards": ["SAL-02"], "packs": [], "cash": 0}'),
        -- asset 506 (SAL-02) goes to El Chato, asset 507 (LAV-09, no set or rarity on the item) to world
        (22, 180, 'settlement', '', $7),
        -- asset 508 (MAL-06): t08 holds two copies now (the craft's and a bought one)
        (23, 190, 'settlement', '', $8),
        -- bids and dealer asks
        (30, 200, 'offer.listed', 't03', $9),
        (31, 205, 'offer.listed', 't03', $10),
        (32, 206, 'thread.opened', '', '{"kind": "persona", "team": "t10", "with": "chato", "topic": {"buy": {"card": "LAV-10"}}, "thread": 9}'),
        (33, 207, 'thread.opened', '', '{"kind": "persona", "team": "t10", "with": "chato", "topic": {"buy": {"pack": "sobre_barrio"}}, "thread": 10}'),
        (34, 208, 'thread.opened', '', '{"kind": "persona", "team": "abuela", "with": "chato", "topic": {"buy": {"card": "LAV-10"}}, "thread": 11}'),
        (35, 209, 'thread.message', '', '{"team": "t01", "text": "${SECRET}"}')`,
      [
        settlement(item(501, 'LAV-09', 'abuela', 't05', { set: 'LAV', rarity: 'rare' })),
        listing(9001, 't05', [{ id: 501, ref: 'LAV-09' }]),
        settlement(item(501, 'LAV-09', 't05', 't07')),
        listing(9002, 't07', [{ id: 502, ref: 'LAV-10' }]),
        settlement(item(503, 'RET-01', 't03', 'abuela')),
        listing(9003, 't04', [{ id: 504, ref: 'RET-01' }]),
        settlement(item(506, 'SAL-02', 't11', 'chato'), item(507, 'LAV-09', 't11', 'world')),
        settlement(item(508, 'MAL-06', 'pilar', 't08')),
        bid(9004, 't03', 'LAV-10', 60),
        bid(9005, 't03', 'LAV-10', 71),
      ],
    )
    await adminDb.query(
      `insert into leaderboard_snapshots (world, tick, team, rank, score, level, pages, deals, venue, read_at) values
        ('real', 800, 't05', 2, 29.731, 4, 2, 48, 'v10', '2026-10-03 15:00:00+00'),
        ('real', 830, 't05', 1, 30.1, 4, 3, 50, 'v10', '2026-10-03 15:10:00+00'),
        ('real', 820, 't07', 3, 25, 3, 1, 20, 'v11', '2026-10-03 15:05:00+00'),
        ('sim', 999, 't07', 1, 99, 9, 9, 99, 'v11', '2026-10-03 15:30:00+00'),
        ('real', 830, 'abuela', 1, 1, 1, 1, 1, null, '2026-10-03 15:10:00+00')`,
    )
    await adminDb.query(
      `insert into competitor_profiles (team, updated_tick, set_interest, notes) values
        ('t05', 843, $1, $2)`,
      [JSON.stringify({ RET: 25, LAV: -55, note: SECRET, lowercase: 3 }), JSON.stringify({ top_set: SECRET })],
    )
    // The order the coordinator applies them in, then again: show.sql's re-run drops these grants, rival_albums.sql's puts them back.
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

  it('follows each copy to its last holder, with how and since when we know it', async () => {
    const r = await reader.query('select holder, card, set_code, rarity, name, copies, how, since_tick, seen_tick from show.rival_holdings order by holder, card')
    expect(r.rows).toEqual([
      // a dealer holds cards too: the copy t03 sold
      { holder: 'abuela', card: 'RET-01', set_code: 'RET', rarity: 'common', name: 'La Castañera', copies: 1, how: 'bought', since_tick: 160, seen_tick: 160 },
      { holder: 'chato', card: 'SAL-02', set_code: 'SAL', rarity: 'common', name: 'El Portero', copies: 1, how: 'bought', since_tick: 180, seen_tick: 180 },
      // the gift is still theirs: nothing later takes a SAL-02 from t02
      { holder: 't02', card: 'SAL-02', set_code: 'SAL', rarity: 'common', name: 'El Portero', copies: 1, how: 'gift', since_tick: 171, seen_tick: 171 },
      // the gift, listed later: one copy, known by the listing
      { holder: 't04', card: 'RET-01', set_code: 'RET', rarity: 'common', name: 'La Castañera', copies: 1, how: 'listed', since_tick: 161, seen_tick: 161 },
      { holder: 't07', card: 'LAV-09', set_code: 'LAV', rarity: 'rare', name: 'Cine Doré', copies: 1, how: 'bought', since_tick: 120, seen_tick: 120 },
      { holder: 't07', card: 'LAV-10', set_code: 'LAV', rarity: 'rare', name: 'Fiesta de San Cayetano', copies: 1, how: 'pack', since_tick: 130, seen_tick: 140 },
      // the crafted copy came first, the bought one later
      { holder: 't08', card: 'MAL-06', set_code: 'MAL', rarity: 'uncommon', name: 'Tienda de Discos', copies: 2, how: 'crafted', since_tick: 170, seen_tick: 190 },
    ])
  })

  it('drops a copy that left: t05 sold its LAV-09, t03 sold its gifted RET-01, the world took LAV-09 #507', async () => {
    const r = await reader.query("select holder, card from show.rival_holdings where holder in ('t03', 't05', 't11', 'world', 'opened')")
    expect(r.rows).toEqual([])
  })

  it("gives each team's latest real leaderboard read and only the numbers of its set interest", async () => {
    const r = await reader.query('select team, rank, score::float8 as score, level, pages, deals, tick, set_interest, album_filled, album_slots from show.rival_teams order by rank')
    expect(r.rows).toEqual([
      // no album_filled column in the table yet: null, and the view still applies
      { team: 't05', rank: 1, score: 30.1, level: 4, pages: 3, deals: 50, tick: 830, set_interest: { RET: 25, LAV: -55 }, album_filled: null, album_slots: null },
      { team: 't07', rank: 3, score: 25, level: 3, pages: 1, deals: 20, tick: 820, set_interest: {}, album_filled: null, album_slots: null },
    ])
  })

  it('counts what each team chases: board bids with the best cash, dealer asks for a card (not a pack, not a dealer)', async () => {
    const r = await reader.query('select team, card, via, times, last_tick, top_bid from show.rival_wants order by team, via')
    expect(r.rows).toEqual([
      { team: 't03', card: 'LAV-10', via: 'bid', times: 2, last_tick: 205, top_bid: 71 },
      { team: 't10', card: 'LAV-10', via: 'dealer', times: 1, last_tick: 206, top_bid: null },
    ])
  })

  it('gives the newest feed tick', async () => {
    const r = await reader.query('select tick from show.rival_head')
    expect(r.rows).toEqual([{ tick: 209 }])
  })

  it('never carries anything of ours or a flavour text', async () => {
    for (const view of ['rival_holdings', 'rival_teams', 'rival_wants', 'rival_head']) {
      const r = await reader.query(`select * from show.${view}`)
      expect(JSON.stringify(r.rows)).not.toContain(SECRET)
      expect(JSON.stringify(r.rows)).not.toContain('999')
    }
  })

  it.each(['public.me_snapshots', 'public.feed_events', 'public.leaderboard_snapshots', 'public.competitor_profiles', 'public.cards', 'public.duels'])(
    'cannot read %s directly',
    async (table) => {
      await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
    },
  )

  // Last: it changes the table. The day the agents' writer stores album_filled / album_slots, the view reads them with
  // no re-apply.
  it('picks up album_filled and album_slots once the table has them', async () => {
    await adminDb.query('alter table leaderboard_snapshots add column album_filled int, add column album_slots int')
    await adminDb.query(
      `insert into leaderboard_snapshots (world, tick, team, rank, score, level, pages, deals, venue, read_at, album_filled, album_slots) values
        ('real', 840, 't05', 1, 31, 4, 3, 51, 'v10', '2026-10-03 15:20:00+00', 36, 50)`,
    )
    const r = await reader.query('select team, tick, pages, album_filled, album_slots from show.rival_teams order by rank')
    expect(r.rows).toEqual([
      { team: 't05', tick: 840, pages: 3, album_filled: 36, album_slots: 50 },
      // an older row, written before the writer stored them: still null
      { team: 't07', tick: 820, pages: 1, album_filled: null, album_slots: null },
    ])
  })
})
