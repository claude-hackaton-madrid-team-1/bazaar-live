/**
 * Privacy proof for db/game.sql, on a LOCAL Postgres 17 with synthetic rows.
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

/** The tables the views read, as the agents' schema declares them (embedding as text: no pgvector here). */
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
`

const SECRET = 'SECRET-xyzzy'
const SECRET_LIMIT = 4242

const ME = {
  id: 't01', name: 'Team 1', cash: 176, tick_seconds: 30.0, affinity: { LAV: SECRET, SAL: 1.6 }, collection_value: SECRET, starter_broker_key: SECRET,
  score: { score: 23.1, rank: 6, deals: 17, luck_private: SECRET }, open_threads: [SECRET], badges: [SECRET],
  album: { pages: [{ set: 'LAV', name: 'Lavapiés', have: 8, of: 10, complete: false, master: false, hint: SECRET }] },
  assets: [{ id: 1, kind: 'card', ref: 'SAL-03', serial: 1, your_value: 3.2, note: SECRET }],
}

const DUEL_PAYLOAD = {
  messages: [{ from: 'you', text: SECRET, tick: 151, price: 59, days: null, limit: SECRET_LIMIT }, { from: 'Rival Rojo', text: '154 P?', tick: 151, price: 154 }, 'odd'],
  your_limit: SECRET_LIMIT, your_offer: { price: 59, limit: SECRET_LIMIT }, limit_meaning: SECRET, your_days_weight: SECRET,
}

const dbName = `game_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe.skipIf(!ADMIN_URL)('db/game.sql privacy (local Postgres)', () => {
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
    await adminDb.query(`insert into feed_events (id, tick, type, actor, payload) values
      (10940, 160, 'round.started', '', '{"name": "Saturday · Gran Vía"}'), (21155, 401, 'offer.listed', 't04', '{"offer": {"id": 1}}'),
      (21156, 159, 'thread.message', 't01', '{"thread": 316, "message": 1, "sender": "t01", "team": "t01", "text": null, "offer": {"id": 7}}'),
      (21157, 160, 'thread.message', 'chato', '{"thread": 316, "message": 4, "sender": "chato", "team": "t01", "text": "97. Así funciona conmigo."}'),
      (21158, 160, 'thread.message', 't05', '{"thread": 317, "message": 2, "sender": "t05", "team": "t05", "text": null}'),
      (21159, 161, 'thread.message', 't01', '"not an object"')`)
    await adminDb.query(`insert into me_snapshots (world, team, tick, affinity, me) values ('real', 't01', 401, $1, $2), ('sim', 't01', 402, null, $2), ('real', 't07', 403, null, $2)`,
      [JSON.stringify({ LAV: SECRET }), JSON.stringify(ME)])
    await adminDb.query(`insert into duels (duel, session, tick, status, role, item, your_limit, rival, deadline_tick, price, days, result, payload)
      values (274, 1, 367, 'deal', 'buyer', 'Plaza', $1, 'Rival Rojo', 163, 103, 0, 29.2, $2), (275, 1, 367, 'live', 'seller', 'Taxi', $1, 'Rival Sol', 999, null, null, null, '"not an object"')`,
      [SECRET_LIMIT, JSON.stringify(DUEL_PAYLOAD)])
    await adminDb.query(`insert into threads (id, counterpart, kind, topic, status, opened_tick, ours) values (316, 'abuela', 'persona', '{"buy": {"card": "LAV-08"}}', 'deal', 159, true), (317, 'chato', 'persona', '{}', 'open', 160, false)`)
    await adminDb.query(`insert into messages (id, thread_id, sender, tick, text, price, final, embedding, ours, tactic) values
      (1, 316, 't01', 159, 'buenas', 17, false, '${SECRET}', true, '${SECRET}'), (2, 317, 'chato', 160, 'not our thread', 9, false, null, false, null),
      (3, 316, 't01', 161, '¿cómo voy a pagar eso?', 19, false, null, true, 'mirror'), (4, 316, 'chato', 160, '97. Así funciona conmigo.', 97, false, null, false, null),
      (5, 316, 't01', 162, 'gracias', 20, false, null, true, null)`)
    // the decisions that sent them: the tactic is the one word that leaves; a dry run, another price or 'none' never match
    const why = JSON.stringify({ tactic_why: SECRET, recalled: [SECRET], our_bids: [SECRET_LIMIT] })
    await adminDb.query(`insert into decisions (id, thread_id, tick, kind, agent, rag_context, candidates, jev, policy_checks, chosen, status, dry_run) values
      (1, 316, 159, 'dealer_bid', 'taker', $1, $2, $1, $1, '{"kind": "bid", "price": 17}', 'done', false),
      (2, 316, 159, 'dealer_bid', 'taker', null, '{"tactic": "walk_threat"}', null, null, '{"kind": "bid", "price": 17}', 'done', true),
      (3, 316, 159, 'dealer_bid', 'taker', null, '{"tactic": "fake_demand"}', null, null, '{"kind": "bid", "price": 18}', 'done', false),
      (4, 316, 161, 'dealer_bid', 'taker', null, '{"tactic": "scarcity"}', null, null, '{"kind": "bid", "price": 19}', 'done', false),
      (5, 316, 162, 'dealer_bid', 'taker', null, '{"tactic": "none"}', null, null, '{"kind": "bid", "price": 20}', 'done', false),
      (6, 317, 160, 'dealer_bid', 'taker', null, '{"tactic": "Bad Label!"}', null, null, '{"kind": "bid", "price": 9}', 'done', false)`,
      [JSON.stringify({ secret: SECRET }), JSON.stringify({ ...JSON.parse(why), tactic: 'scarcity', our_limit: SECRET_LIMIT })])
    await adminDb.query(`insert into tape (settlement_id, tick, persona, buyer, seller, items, card_id, price, fee) values (478, 400, 'abuela', 't09', 'abuela', '{"n": 1, "ref": "RET-07"}', 'RET-07', 21, 0)`)
    // The order the coordinator applies them in, then again: show.sql's re-run drops these grants, game.sql's puts them back.
    await adminDb.query(SHOW_SQL)
    await adminDb.query(GAME_SQL)
    await adminDb.query(SHOW_SQL)
    await adminDb.query(GAME_SQL)
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

  it('reads the feed with numeric ids', async () => {
    const r = await reader.query('select * from show.game_feed order by id')
    expect(r.rows.map((x) => x.id)).toEqual([10940, 21155, 21156, 21157, 21158, 21159])
    expect(Object.keys(r.rows[0])).toEqual(['id', 'tick', 'type', 'actor', 'payload'])
  })

  it('adds our words and their tactic to our thread.message rows only', async () => {
    const r = await reader.query('select id, payload from show.game_feed order by id')
    const by = new Map(r.rows.map((x) => [x.id, x.payload]))
    expect(by.get(21156)).toEqual({ thread: 316, message: 1, sender: 't01', team: 't01', text: 'buenas', tactic: 'scarcity', offer: { id: 7 } })
    // the dealer's words stay theirs; another team's thread is untouched; an odd payload is left as it is
    expect(by.get(21157)).toEqual({ thread: 316, message: 4, sender: 'chato', team: 't01', text: '97. Así funciona conmigo.' })
    expect(by.get(21158)).toEqual({ thread: 317, message: 2, sender: 't05', team: 't05', text: null })
    expect(by.get(21159)).toBe('not an object')
    expect(by.get(21155)).toEqual({ offer: { id: 1 } })
    const text = JSON.stringify(r.rows)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(String(SECRET_LIMIT))
  })

  it('reads only our team in the real world, and only the allow-listed fields of /me', async () => {
    const r = await reader.query('select * from show.game_me')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].tick_seconds).toBe(30)
    expect(r.rows[0].me).toMatchObject({ id: 't01', cash: 176, score: { score: 23.1, rank: 6 }, album: { pages: [{ set: 'LAV', have: 8 }] }, assets: [{ ref: 'SAL-03', your_value: 3.2 }], affinity: { SAL: 1.6 } })
    expect(Object.keys(r.rows[0])).toEqual(['tick', 'read_at', 'tick_seconds', 'me'])
    expect(JSON.stringify(r.rows)).not.toContain(SECRET)
  })

  it('reads our duels without the limit, the result or the words', async () => {
    const r = await reader.query('select * from show.game_duels order by duel')
    expect(r.rows.map((x) => x.duel)).toEqual([274, 275])
    expect(r.rows[0].messages).toEqual([{ from: 'you', tick: 151, price: 59, days: null }, { from: 'Rival Rojo', tick: 151, price: 154, days: null }])
    expect(r.rows[1].messages).toEqual([])
    const text = JSON.stringify(r.rows)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(String(SECRET_LIMIT))
    expect(text).not.toContain('154 P?')
    expect(text).not.toContain('29.2')
  })

  it('reads our threads and their messages, without embedding, with the tactic of ours', async () => {
    const t = await reader.query('select * from show.game_threads')
    const m = await reader.query('select * from show.game_messages order by id')
    expect(t.rows.map((x) => x.id)).toEqual([316])
    expect(Object.keys(m.rows[0])).toEqual(['id', 'thread_id', 'sender', 'tick', 'text', 'price', 'offer', 'final', 'ours', 'tactic'])
    // 1: the column holds no id, so the decision's (not the dry run's, not another price's); 3: the column's own;
    // 4: the dealer's words carry none; 5: 'none' is no tactic
    expect(m.rows.map((x) => [x.id, x.tactic])).toEqual([[1, 'scarcity'], [3, 'mirror'], [4, null], [5, null]])
    const text = JSON.stringify(m.rows)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(String(SECRET_LIMIT))
  })

  it('reads the tape', async () => {
    const r = await reader.query('select * from show.game_tape')
    expect(r.rows[0]).toMatchObject({ settlement_id: 478, card_id: 'RET-07', price: 21 })
  })

  it.each(['public.me_snapshots', 'public.duels', 'public.messages', 'public.threads', 'public.tape', 'public.feed_events', 'public.decisions'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })
})
