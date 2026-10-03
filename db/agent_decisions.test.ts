/**
 * Privacy proof for db/agent_decisions.sql, on a LOCAL Postgres 17 with synthetic rows.
 *
 *   sh scripts/test-sql.sh        # starts a throwaway container, runs the db/ tests, removes it
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
const DECISIONS_SQL = readFileSync(new URL('./agent_decisions.sql', import.meta.url), 'utf8')

/** The tables, as bazaar's sql/schema.sql leaves them after its ALTERs (only the columns these views and show.sql read). */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
  create table decisions (id bigserial primary key, intent_id bigint, thread_id bigint, tick int, state_digest text, rag_context jsonb,
    candidates jsonb, jev jsonb, jev_digest text, policy_checks jsonb, chosen jsonb, status text, reason text,
    agent text, kind text, dry_run boolean);
  create table executions (id bigserial primary key, decision_id bigint, tick int, sdk_method text, request jsonb, response jsonb, error_code text);
  create table outcomes (decision_id bigint, realized_surplus numeric, ladder_share numeric, jev_right bool, recorded_tick int,
    target text, subject text, score numeric, label text, explanation text, details jsonb, day text, jev_question text,
    jev_verdict text, trace_id text, span_id text, annotated_at timestamptz, annotation_tries int, scored_at timestamptz);
  create unique index outcomes_subject on outcomes (target, subject);
  create table ledger (id bigserial primary key, kind text not null, tick int not null, t_hours double precision not null,
    price int not null default 0, item text not null default '', source text, created_at timestamptz default now(), slot int);
`

const SECRET_LIMIT = 4747
const SECRET_REASON = 'SECRET-STRATEGY-REASON-xyzzy'
const SECRET_JEV = 'SECRET-JEV-REASON-plugh'
const SECRET_KEY = 'SECRET-KEY-sk-live-0000'
const SECRET_SOURCE = 'SECRET-HOST-laptop-omar'
const SECRET_EXPLANATION = 'SECRET-EXPLANATION-frob'
const SECRET_RIVAL = 'Rival Secreto'

type Row = { tick: number; agent: string; kind: string; status: string; guardrail: string; candidates?: object; chosen?: object | null; jev?: object | null; dry_run?: boolean }

const DECISIONS: Row[] = [
  // 1: an approved accept that went through and settled at a gain
  { tick: 100, agent: 'taker', kind: 'accept_ask', status: 'done', guardrail: 'allowed',
    candidates: { offer_id: 9, maker: 't05', ref: 'LAV-08', ask: 24, value: 31.5, owner: 'w1234567890' },
    chosen: { accept: 9, price: 24 }, jev: { verdict: 'yes', value: 0.81, reason: SECRET_JEV, digest: 'abc' } },
  // 2: blocked by the spend cap and the floor (two rules: the first one counts)
  { tick: 100, agent: 'taker', kind: 'dealer_bid', status: 'rejected',
    guardrail: 'denied: spend 140 + 20 > max_spend_per_game_hour 150; cash 60 - 20 < cash_floor 50',
    candidates: { dealer: 'abuela', item: 'sobre_barrio', ask: 20, value: 26 } },
  // 3: a final lifted above the rare cap
  { tick: 101, agent: 'taker', kind: 'dealer_accept', status: 'rejected',
    guardrail: 'denied: price 97 > dealer final cap 96 (max_price_rare 80 lifted)', candidates: { dealer: 'chato', item: 'MAL-09', ask: 97 } },
  // 4: the maker's ask refused below our value (the rule id is not in the text)
  { tick: 101, agent: 'maker', kind: 'post_ask', status: 'rejected', guardrail: 'denied: sell price 3 < 1.0 × your_value 5', candidates: { ref: 'SAL-02', price: 3, value: 5 } },
  // 5: paused
  { tick: 102, agent: 'maker', kind: 'post_ask', status: 'rejected', guardrail: 'denied: pause file .local/PAUSE exists', candidates: { ref: 'SAL-03', price: 9 } },
  // 6: a duel offer refused by duel_inside_limit: its text prints our limit and must never leave
  { tick: 102, agent: 'duels', kind: 'duel_offer', status: 'rejected',
    guardrail: `denied: duel seller price 40 is worth 38, not strictly above limit ${SECRET_LIMIT} (duel_inside_limit)`,
    candidates: { role: 'seller', our_limit: SECRET_LIMIT, rival_price: 41, rival: SECRET_RIVAL }, chosen: null,
    jev: { verdict: 'hold', value: SECRET_LIMIT / 100, reason: SECRET_JEV } },
  // 7: a duel accept that went out
  { tick: 103, agent: 'duels', kind: 'duel_accept', status: 'done', guardrail: 'allowed',
    candidates: { role: 'buyer', our_limit: SECRET_LIMIT }, chosen: { duel: 85, kind: 'accept', price: 52, days: 2 } },
  // 8: expired (the tick budget ran out), with a send that failed afterwards on another decision
  { tick: 103, agent: 'taker', kind: 'accept_ask', status: 'expired', guardrail: 'allowed', candidates: { maker: 't09', ref: 'LAT-04', ask: 11 } },
  // 9: a failed send
  { tick: 104, agent: 'taker', kind: 'accept_ask', status: 'failed', guardrail: 'allowed', candidates: { maker: 't03', ref: 'LAT-05', ask: 12 }, chosen: { accept: 77, price: 12 } },
  // 10: not ours to show: a dry run, another agent, an unknown tick, a strategy note ('-')
  { tick: 104, agent: 'taker', kind: 'accept_ask', status: 'approved', guardrail: 'allowed', dry_run: true, candidates: { ref: 'DRY-01' } },
  { tick: 104, agent: 'broker', kind: 'venue_match', status: 'approved', guardrail: 'allowed', candidates: { ref: 'BRK-01' } },
  { tick: -1, agent: 'taker', kind: 'accept_ask', status: 'approved', guardrail: 'allowed', candidates: { ref: 'NEG-01' } },
  { tick: 105, agent: 'taker', kind: 'dealer_skip', status: 'rejected', guardrail: '-', candidates: { dealer: 'abuela', item: 'LAV-01' } },
  // 14-18: dealer-sell selling the duplicate copy 501 of a card we hold twice (502 is the page copy, worth more).
  // Never shown as decisions; the sale's outcome takes the value of copy 501 logged last before the sale.
  { tick: 110, agent: 'dealer-sell', kind: 'dealer_ask', status: 'done', guardrail: 'allowed', candidates: { ref: 'SAL-05', asset: 501, floor: 9, dealer: 'pilar', your_value: 4.5 } },
  { tick: 112, agent: 'dealer-sell', kind: 'dealer_ask', status: 'done', guardrail: 'allowed', candidates: { ref: 'SAL-05', asset: 501, floor: 9, dealer: 'pilar', your_value: 5 } },
  { tick: 113, agent: 'dealer-sell', kind: 'dealer_ask', status: 'done', guardrail: 'allowed', candidates: { ref: 'SAL-05', asset: 501, floor: 9, dealer: 'chato', your_value: 6 } },
  { tick: 114, agent: 'dealer-sell', kind: 'dealer_ask', status: 'done', guardrail: 'allowed', candidates: { ref: 'SAL-05', asset: 502, floor: 9, dealer: 'pilar', your_value: 60 } },
  { tick: 125, agent: 'dealer-sell', kind: 'dealer_ask', status: 'done', guardrail: 'allowed', candidates: { ref: 'SAL-05', asset: 501, floor: 9, dealer: 'pilar', your_value: 70 } },
  // 19-21: our venue's broker: a bench match, a live match, and a dry run (never shown). Its bid and ask stay private.
  { tick: 130, agent: 'broker', kind: 'broker_match', status: 'done', guardrail: 'allowed',
    candidates: { ask: 3636, bid: 5151, buy: 'b69-3', sell: 'b69-19', item: 'bench:b69', bench: true, price: 43, surplus: 15, makers: ['b69-19', 'b69-3'] },
    chosen: { buy: 'b69-3', sell: 'b69-19', price: 43 } },
  // a live match as broker.py writes it: the card as `card:LAV-08`, the two offer ids, the makers sorted
  { tick: 131, agent: 'broker', kind: 'broker_match', status: 'done', guardrail: 'allowed',
    candidates: { ask: 2020, bid: 3030, item: 'card:LAV-08', bench: false, makers: ['t04', 't15'], fee: 0, price: 25, surplus: 10.25, sell: 13276, buy: 13280, reason_text: SECRET_REASON },
    chosen: { sell: 13276, buy: 13280, price: 25 } },
  { tick: 132, agent: 'broker', kind: 'broker_match', status: 'done', guardrail: 'allowed', dry_run: true, candidates: { item: 'DRY-02' }, chosen: { buy: 'x', sell: 'y', price: 1 } },
  // 22-24: matches the game never took: refused by a guardrail, past the tick window, refused by the game
  { tick: 133, agent: 'broker', kind: 'broker_match', status: 'rejected', guardrail: 'denied: pause file .local/PAUSE exists', candidates: { item: 'bench:b69', bench: true, surplus: 26 }, chosen: null },
  { tick: 133, agent: 'broker', kind: 'broker_match', status: 'expired', guardrail: 'allowed', candidates: { item: 'bench:b69', bench: true, surplus: 26 }, chosen: null },
  { tick: 133, agent: 'broker', kind: 'broker_match', status: 'failed', guardrail: 'allowed', candidates: { item: 'bench:b69', bench: true, surplus: 26 }, chosen: { buy: 'b69-1', sell: 'b69-2', price: 40 } },
]

const dbName = `decisions_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

describe.skipIf(!ADMIN_URL)('db/agent_decisions.sql privacy (local Postgres)', () => {
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
    for (const d of DECISIONS) {
      await adminDb.query(
        `insert into decisions (tick, agent, kind, status, policy_checks, candidates, chosen, jev, dry_run, reason, rag_context, state_digest)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'digest')`,
        [d.tick, d.agent, d.kind, d.status, { guardrail: d.guardrail, allowed: d.guardrail === 'allowed' }, d.candidates ?? {}, d.chosen ?? null, d.jev ?? null, d.dry_run ?? false, SECRET_REASON, { key: SECRET_KEY }],
      )
    }
    // our venues: the starter stall (closed at 260), v19; another team's venue, and a stale close before v19 opened
    const feed = 'insert into feed_events (id, tick, type, actor, payload) values ($1, $2, $3, $4, $5)'
    await adminDb.query(feed, [9001, 201, 'venue.opened', '', { venue: 'v08', name: 'Puesto de Team 1', owner: 't01', bond: 0, rules: { mechanism: 'auto' }, fee_bps: 300, fee_per_card: 0, starter: true }])
    await adminDb.query(feed, [9002, 260, 'venue.closed', '', { venue: 'v08' }])
    await adminDb.query(feed, [9003, 262, 'venue.opened', '', { venue: 'v19', name: 'Team 1 market', owner: 't01', bond: 250, rules: { mechanism: 'board' }, fee_bps: 0, fee_per_card: 0 }])
    await adminDb.query(feed, [9004, 263, 'venue.opened', '', { venue: 'v02', name: 'Puesto 2', owner: 't02', bond: 250, rules: { mechanism: 'board' }, fee_bps: 200 }])
    await adminDb.query(feed, [9005, 100, 'venue.closed', '', { venue: 'v19' }])
    const exec = 'insert into executions (decision_id, tick, sdk_method, request, response, error_code) values ($1, $2, $3, $4, $5, $6)'
    await adminDb.query(exec, [1, 100, 'accept_offer', { key: SECRET_KEY }, { ok: true, token: SECRET_KEY }, null])
    await adminDb.query(exec, [7, 103, 'duel_accept', { duel: 85 }, { price: 52 }, null])
    await adminDb.query(exec, [9, 104, 'accept_offer', { offer: 77 }, null, 'offer_gone'])
    await adminDb.query(exec, [9, 104, 'accept_offer', { offer: 77 }, null, 'rate_limited']) // the last one counts
    const outcome = `insert into outcomes (target, subject, decision_id, score, label, explanation, details, recorded_tick, realized_surplus, jev_verdict, jev_right, scored_at)
                     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`
    await adminDb.query(outcome, ['trade', 'settlement:67', 1, 0.24, 'good', SECRET_EXPLANATION,
      { ref: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, card_value: 31.5, snapshots: [99, 101] }, 101, 7.5, 'yes', true, '2026-10-03T10:00:00.123456Z'])
    await adminDb.query(outcome, ['dealer', 'thread:187', null, 0.5, 'ok', SECRET_EXPLANATION,
      { dealer: 'chato', item: 'LAV-08', side: 'buy', fill_price: 31 }, 120, 3, null, null, '2026-10-03T10:00:01Z'])
    await adminDb.query(outcome, ['duel', 'duel:85', 7, 0.91, 'good', SECRET_EXPLANATION,
      { your_limit: SECRET_LIMIT, rival: SECRET_RIVAL, price: 52 }, 104, SECRET_LIMIT - 52, 'accept', true, '2026-10-03T10:00:02Z'])
    await adminDb.query(outcome, ['market_test', 'market_test:sat', null, 0.4, 'ok', SECRET_EXPLANATION, {}, 130, null, null, null, '2026-10-03T10:00:03Z'])
    await adminDb.query(outcome, ['dealer', 'thread:190', null, 0.6, 'good', SECRET_EXPLANATION,
      { dealer: 'pilar', item: 'assets:501', side: 'sell', fill_price: 20 }, 120, null, null, null, '2026-10-03T10:00:04Z'])
    await adminDb.query(outcome, ['dealer', 'thread:191', null, 0.1, 'bad', SECRET_EXPLANATION,
      { dealer: 'abuela', item: 'assets:503', side: 'sell', fill_price: 3 }, 121, null, null, null, '2026-10-03T10:00:05Z'])
    const ledger = 'insert into ledger (kind, tick, t_hours, price, item, source, slot) values ($1, $2, $3, $4, $5, $6, $7)'
    await adminDb.query(ledger, ['spend', 100, 1.6667, 24, 'LAV-08', SECRET_SOURCE, null])
    await adminDb.query(ledger, ['accept', 100, 1.6667, 24, 'LAV-08', SECRET_SOURCE, 1])
    await adminDb.query(ledger, ['spend', 101, 1.6833, 20, 'sobre_barrio', SECRET_SOURCE, null])
    await adminDb.query(ledger, ['spend', 101, 1.6833, -20, 'sobre_barrio', SECRET_SOURCE, null]) // a refund
    await adminDb.query(ledger, ['listing', 101, 1.6833, 0, 'SAL-02', SECRET_SOURCE, null])
    await adminDb.query(ledger, ['accept', -1, 0, 0, 'x', SECRET_SOURCE, null])

    await adminDb.query(SHOW_SQL)
    await adminDb.query(DECISIONS_SQL)
    await adminDb.query(DECISIONS_SQL) // idempotent
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

  it('refuses to run before show.sql (no role, no helpers)', async () => {
    const fresh = `decisions_bare_${randomBytes(4).toString('hex')}`
    await admin.query(`create database ${fresh}`)
    const bare = new pg.Client({ connectionString: withDb(ADMIN_URL ?? '', fresh) })
    await bare.connect()
    try {
      await bare.query(TABLES)
      await expect(bare.query(DECISIONS_SQL)).rejects.toThrow(/apply db\/show\.sql first/)
    } finally {
      await bare.end()
      await admin.query(`drop database if exists ${fresh} with (force)`)
    }
  })

  it('shows only live decisions of taker, maker and duels, oldest first', async () => {
    const { rows } = await reader.query('select id, agent, kind, status from show.agent_decisions order by id')
    expect(rows.map((r) => Number(r.id))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 13])
    expect(rows.map((r) => r.agent)).not.toContain('broker')
  })

  it('names the rule that blocked each one, and keeps a short reason', async () => {
    const { rows } = await reader.query('select id, verdict, rule, rule_text from show.agent_decisions order by id')
    const by = new Map(rows.map((r) => [Number(r.id), r]))
    expect(by.get(1)).toMatchObject({ verdict: 'allowed', rule: null, rule_text: null })
    expect(by.get(2)).toMatchObject({ verdict: 'denied', rule: 'max_spend_per_game_hour' })
    expect(by.get(2)?.rule_text).toBe('spend 140 + 20 > max_spend_per_game_hour 150; cash 60 - 20 < cash_floor 50')
    expect(by.get(3)).toMatchObject({ rule: 'max_price_rare' })
    expect(by.get(4)).toMatchObject({ rule: 'sell_min_value_ratio' })
    expect(by.get(5)).toMatchObject({ rule: 'pause_file' })
    expect(by.get(6)).toMatchObject({ verdict: 'denied', rule: 'duel_inside_limit', rule_text: null })
    expect(by.get(13)).toMatchObject({ verdict: null, rule: null })
  })

  it('reads item, counterparty, price, our value, Jev, the last execution and the outcome', async () => {
    const { rows } = await reader.query('select * from show.agent_decisions order by id')
    const by = new Map(rows.map((r) => [Number(r.id), r]))
    expect(by.get(1)).toMatchObject({ tick: 100, item: 'LAV-08', counterparty: 't05', price: 24, our_value: '31.5', jev_verdict: 'yes', jev_value: '0.81',
      exec_method: 'accept_offer', error_code: null, outcome_label: 'good', realized_surplus: '7.5', jev_right: true })
    expect(by.get(2)).toMatchObject({ item: 'sobre_barrio', counterparty: 'abuela', price: 20 })
    expect(by.get(8)).toMatchObject({ status: 'expired', exec_method: null })
    expect(by.get(9)).toMatchObject({ status: 'failed', error_code: 'rate_limited', price: 12 })
  })

  it('keeps a duel row to its id, status, rule id, Jev verdict and error code', async () => {
    const { rows } = await reader.query("select * from show.agent_decisions where agent = 'duels' order by id")
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(r).toMatchObject({ counterparty: null, price: null, our_value: null, jev_value: null, rule_text: null })
    expect(rows[0]).toMatchObject({ kind: 'duel_offer', item: null, jev_verdict: 'hold' })
    expect(rows[1]).toMatchObject({ kind: 'duel_accept', item: 'duel:85', status: 'done', exec_method: 'duel_accept', outcome_label: null })
  })

  it('shows trade, dealer and duel outcomes, a duel without its surplus or score', async () => {
    const { rows } = await reader.query('select * from show.agent_outcomes order by scored_at')
    expect(rows.map((r) => r.subject)).toEqual(['settlement:67', 'thread:187', 'duel:85', 'thread:190', 'thread:191'])
    expect(rows[0]).toMatchObject({ target: 'trade', agent: 'taker', item: 'LAV-08', counterparty: 't05', side: 'buy', price: 24, our_value: '31.5', label: 'good', realized_surplus: '7.5', jev_verdict: 'yes', jev_right: true })
    expect(rows[1]).toMatchObject({ target: 'dealer', agent: 'taker', item: 'LAV-08', counterparty: 'chato', price: 31, label: 'ok', our_value: null })
    expect(rows[2]).toMatchObject({ target: 'duel', agent: 'duels', label: 'good', score: null, realized_surplus: null, price: null, item: null, counterparty: null })
  })

  it('values a dealer sale by the copy sold, as dealer-sell logged it last before the sale', async () => {
    const { rows } = await reader.query(`select subject, side, price, our_value from show.agent_outcomes where target = 'dealer' and side = 'sell' order by subject`)
    // copy 501 with pilar up to tick 120: not the other dealer's row, not the page copy 502, not the row after the sale
    expect(rows).toEqual([
      { subject: 'thread:190', side: 'sell', price: 20, our_value: '5.0' },
      { subject: 'thread:191', side: 'sell', price: 3, our_value: null },
    ])
  })

  it('sums the ledger per tick: spend net of refunds, accepts, listings', async () => {
    const { rows } = await reader.query('select * from show.agent_ledger order by tick')
    expect(rows).toEqual([
      { tick: 100, t_hours: '1.6667', spent: 24, buys: 1, accepts: 1, listings: 0 },
      { tick: 101, t_hours: '1.6833', spent: 0, buys: 1, accepts: 0, listings: 1 },
    ])
  })

  it("shows our broker's matches: the pair, the price, the surplus and whether it was a bench; never its bid or ask", async () => {
    const { rows } = await reader.query('select * from show.agent_broker order by id')
    // only what the game took: not the rejected, expired or failed ones (22-24), nor the dry run
    expect(rows).toEqual([
      { id: '19', tick: 130, bench: true, item: 'bench:b69', buyer: 'b69-3', seller: 'b69-19', price: 43, surplus: '15.0', makers: 'b69-19 b69-3' },
      { id: '20', tick: 131, bench: false, item: 'LAV-08', buyer: '13280', seller: '13276', price: 25, surplus: '10.3', makers: 't04 t15' },
    ])
    const dump = JSON.stringify(rows)
    for (const secret of ['3636', '5151', '2020', '3030', SECRET_REASON, 'DRY-02']) expect(dump).not.toContain(secret)
  })

  it('lists the venues we opened, with bond, mechanism, fees and when each closed; never another team\'s', async () => {
    const { rows } = await reader.query('select * from show.our_venues order by id')
    expect(rows).toEqual([
      { id: '9001', tick: 201, venue: 'v08', name: 'Puesto de Team 1', bond: 0, mechanism: 'auto', fee_bps: 300, fee_per_card: 0, closed_tick: 260 },
      { id: '9003', tick: 262, venue: 'v19', name: 'Team 1 market', bond: 250, mechanism: 'board', fee_bps: 0, fee_per_card: 0, closed_tick: null },
    ])
  })

  it.each(['public.decisions', 'public.executions', 'public.outcomes', 'public.ledger'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })

  it('holds SELECT on exactly show.sql\'s two views and these five', async () => {
    const grants = await adminDb.query(
      `select table_schema, table_name, privilege_type from information_schema.role_table_grants where grantee = 'bazaar_live_reader' order by 1, 2, 3`,
    )
    expect(grants.rows.map((r) => `${r.table_schema}.${r.table_name}:${r.privilege_type}`)).toEqual([
      'show.agent_broker:SELECT', 'show.agent_decisions:SELECT', 'show.agent_ledger:SELECT', 'show.agent_outcomes:SELECT', 'show.duel_lines:SELECT', 'show.our_venues:SELECT', 'show.thread_lines:SELECT',
    ])
    const fns = await adminDb.query(`select routine_name from information_schema.role_routine_grants where grantee = 'bazaar_live_reader' order by 1`)
    expect(fns.rows.map((r) => r.routine_name)).toEqual(['as_int', 'as_text', 'card_in'])
  })

  it('answers through security_barrier views', async () => {
    const { rows } = await adminDb.query("select relname, reloptions from pg_class where (relname like 'agent\\_%' or relname = 'our_venues') and relkind = 'v' order by 1")
    expect(rows).toEqual([
      { relname: 'agent_broker', reloptions: ['security_barrier=true'] },
      { relname: 'agent_decisions', reloptions: ['security_barrier=true'] },
      { relname: 'agent_ledger', reloptions: ['security_barrier=true'] },
      { relname: 'agent_outcomes', reloptions: ['security_barrier=true'] },
      { relname: 'our_venues', reloptions: ['security_barrier=true'] },
    ])
  })

  it('never lets a private key, a free text or a duel limit into a row or a column', async () => {
    const d = await reader.query('select * from show.agent_decisions')
    const o = await reader.query('select * from show.agent_outcomes')
    const l = await reader.query('select * from show.agent_ledger')
    const b = await reader.query('select * from show.agent_broker')
    const all = [d, o, l, b]
    const dump = JSON.stringify([all.map((r) => r.rows), all.map((r) => r.fields.map((f) => f.name))])
    for (const secret of [String(SECRET_LIMIT), String(SECRET_LIMIT - 52), SECRET_REASON, SECRET_JEV, SECRET_KEY, SECRET_SOURCE, SECRET_EXPLANATION, SECRET_RIVAL, 'w1234567890', 'DRY-01', 'BRK-01', 'NEG-01']) {
      expect(dump).not.toContain(secret)
    }
    const columns = all.flatMap((r) => r.fields.map((f) => f.name))
    for (const banned of ['your_limit', 'our_limit', 'limit', 'reason', 'candidates', 'chosen', 'jev', 'payload', 'request', 'response', 'explanation', 'details', 'source', 'rag_context', 'state_digest', 'owner']) {
      expect(columns).not.toContain(banned)
    }
  })

  it('converges again after show.sql is re-run (which drops these grants) and this file after it', async () => {
    await adminDb.query(SHOW_SQL)
    await expect(reader.query('select 1 from show.agent_decisions limit 1')).rejects.toMatchObject({ code: '42501' })
    await adminDb.query(DECISIONS_SQL)
    expect((await reader.query('select count(*)::int as n from show.agent_decisions')).rows[0]?.n).toBe(10)
  })
})
