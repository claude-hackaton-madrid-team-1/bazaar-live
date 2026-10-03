/**
 * Privacy proof for db/show.sql, on a LOCAL Postgres 17 with synthetic rows.
 *
 *   sh scripts/test-sql.sh        # starts a throwaway container, runs this file, removes it
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

/** The two tables the views read, as bazaar's sql/schema.sql declares them. */
const TABLES = `
  create table feed_events (id bigint primary key, tick int, type text, actor text, payload jsonb, received_at timestamptz default now());
  create table duels (duel int primary key, session int, tick int, status text, role text, item text, your_limit int,
    rival text, deadline_tick int, rounds int, decay_per_round numeric, price int, days int, result numeric,
    payload jsonb, updated_at timestamptz default now());
`

const SECRET_LIMIT = 4242
const SECRET_RESULT = 0.8765
const SECRET_REASON = 'SECRET-REASON-xyzzy'
const SECRET_WEIGHT = 'SECRET-WEIGHT-plugh'

const feed = (id: number, tick: number, type: string, payload: Record<string, unknown>) => ({ id, tick, type, payload })

const FEED = [
  feed(1, 10, 'thread.opened', { kind: 'thread', team: 't01', with: 'chato', topic: { buy: { card: 'LAV-08' } }, thread: 187 }),
  feed(2, 11, 'thread.message', {
    kind: 'message', team: 't01', with: 'chato', sender: 't01', thread: 187, message: 5, text: null,
    offer: { id: 9, to: 'chato', maker: 't01', give: { cash: 24, types: [] }, want: { cash: 0, types: ['card:LAV-08'] }, final: false, status: 'open', thread: 187 },
  }),
  feed(3, 12, 'thread.message', {
    kind: 'message', team: 't01', with: 'chato', sender: 'chato', thread: 187, message: 6,
    text: "Your abuela would've moved more than one. 31 P. I match what you move, nothing extra.",
    offer: { id: 10, to: 't01', maker: 'chato', give: { cash: 0, types: ['card:LAV-08'] }, want: { cash: 31, types: [] }, final: true, status: 'open', thread: 187 },
  }),
  feed(4, 13, 'settlement', { kind: 'trade', tick: 13, price: 31, fee: 2, venue: 'rastro', parties: ['t01', 'abuela'], persona: 'abuela', items: [{ ref: 'LAV-08', name: 'x', rarity: 'common', frm: 'abuela', to: 't01', set: 'LAV' }] }),
  // Not ours: another team's dealer thread and a settlement between two other teams.
  feed(5, 14, 'thread.message', { kind: 'message', team: 't07', with: 'chato', sender: 'chato', thread: 300, text: 'not ours', offer: null }),
  feed(6, 15, 'settlement', { kind: 'trade', tick: 15, price: 9, fee: 1, venue: 'rastro', parties: ['t03', 't07'], items: [{ ref: 'SAL-01' }] }),
  // A malformed row must not break the view.
  feed(7, 16, 'thread.message', { kind: 'message', team: 't01', with: 'abuela', sender: 'abuela', thread: 'oops', text: 'odd', offer: { give: { cash: 'lots', types: 'nope' }, want: 7 } }),
  feed(8, 17, 'duel.closed', { duel: 61, item: 'MAL-02', status: 'deal', session: 2 }),
]

const MESSAGES = [
  { from: 'Rival Noche', text: 'Sesenta y no se hable más.', tick: 40, price: 60, days: 3, limit: 99, reason: SECRET_REASON },
  { from: 'us', text: 'I can do 50.', tick: 41, price: 50, days: 2, your_days_weight: SECRET_WEIGHT },
]

const DUELS = [
  { duel: 61, session: 1, status: 'deal', role: 'seller', item: 'MAL-02', rival: 'Rival Noche', price: 55, days: 3, payload: { messages: MESSAGES, your_offer: { price: 50, limit: SECRET_LIMIT }, limit_meaning: SECRET_REASON, your_days_weight: SECRET_WEIGHT } },
  { duel: 62, session: 1, status: 'no_deal', role: 'buyer', item: 'SAL-01', rival: 'Rival Mar', price: null, days: null, payload: { messages: [{ from: 'Rival Mar', text: 'No.', tick: 50, price: null, days: null }] } },
  { duel: 63, session: 2, status: 'live', role: 'buyer', item: 'LAT-05', rival: 'Rival Sol', price: 70, days: 1, payload: { messages: [{ from: 'Rival Sol', text: 'LIVE-TEXT-MUST-NOT-LEAK', tick: 60, price: 71 }], your_offer: { price: 70 } } },
  { duel: 64, session: 1, status: 'deal', role: 'seller', item: 'RET-03', rival: 'Rival Luna', price: 20, days: 0, payload: 'not an object' },
  // Same item, two rivals: one closed, one still live. The closed one must stay hidden meanwhile.
  { duel: 71, session: 1, status: 'deal', role: 'seller', item: 'Taxi Blanco', rival: 'Rival Verde', price: 30, days: 1, payload: { messages: [{ from: 'Rival Verde', text: 'SIBLING-MUST-WAIT', tick: 70, price: 30 }] } },
  // The last session (2) has a live duel and no later session: its closed duel is hidden. A session with a live duel hides its closed ones.
  { duel: 81, session: 2, status: 'deal', role: 'buyer', item: 'LAST-ONE', rival: 'Rival Azul', price: 40, days: 2, payload: { messages: [{ from: 'Rival Azul', text: 'LAST-SESSION-HIDDEN', tick: 80, price: 40 }] } },
  { duel: 82, session: 0, status: 'deal', role: 'buyer', item: 'OLD-ONE', rival: 'Rival Gris', price: 10, days: 0, payload: { messages: [{ from: 'Rival Gris', text: 'SESSION-HAS-LIVE', tick: 5, price: 10 }] } },
  { duel: 83, session: 0, status: 'live', role: 'buyer', item: 'OTHER-ONE', rival: 'Rival Rosa', price: null, days: null, payload: { messages: [] } },
  // Live siblings that are NOT stale (deadline ahead of the feed's newest tick, or unknown) hide their session's closed duels.
  { duel: 91, session: 5, status: 'deal', role: 'buyer', item: 'ZZ-1', rival: 'Rival Uno', price: 9, days: 1, payload: { messages: [{ from: 'Rival Uno', text: 'FRESH-SIBLING-HIDES', tick: 90, price: 9 }] } },
  { duel: 92, session: 5, status: 'live', role: 'buyer', item: 'ZZ-2', rival: 'Rival Dos', price: null, days: null, payload: { messages: [] }, deadline: 9999 },
  { duel: 93, session: 6, status: 'deal', role: 'buyer', item: 'ZZ-3', rival: 'Rival Tres', price: 9, days: 1, payload: { messages: [{ from: 'Rival Tres', text: 'UNKNOWN-DEADLINE-HIDES', tick: 90, price: 9 }] } },
  { duel: 94, session: 6, status: 'live', role: 'buyer', item: 'ZZ-4', rival: 'Rival Cuatro', price: null, days: null, payload: { messages: [] }, deadline: null },
  { duel: 72, session: 2, status: 'live', role: 'seller', item: 'Taxi Blanco', rival: 'Rival Rojo', price: null, days: null, payload: { messages: [] } },
]

const dbName = `show_test_${randomBytes(4).toString('hex')}`
const readerPassword = randomBytes(12).toString('hex')

function withDb(url: string, db: string): string {
  const u = new URL(url)
  u.pathname = `/${db}`
  return u.toString()
}

/** Runs `sql` in a read-write transaction (the role's read-only default is only a default), rolled back. */
async function refusedWhenWritable(client: pg.Client, sql: string): Promise<unknown> {
  await client.query('begin')
  await client.query('set transaction read write')
  try {
    return await client.query(sql).then(() => null, (e: unknown) => e)
  } finally {
    await client.query('rollback')
  }
}

describe.skipIf(!ADMIN_URL)('db/show.sql privacy (local Postgres)', () => {
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
    for (const e of FEED) await adminDb.query('insert into feed_events (id, tick, type, actor, payload) values ($1,$2,$3,$4,$5)', [e.id, e.tick, e.type, 'x', e.payload])
    for (const d of DUELS) {
      await adminDb.query(
        'insert into duels (duel, session, tick, status, role, item, your_limit, rival, price, days, result, payload, deadline_tick) values ($1,$11,50,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12)',
        [d.duel, d.status, d.role, d.item, SECRET_LIMIT, d.rival, d.price, d.days, SECRET_RESULT, JSON.stringify(d.payload), d.session, 'deadline' in d ? d.deadline : 5],
      )
    }
    await adminDb.query(SHOW_SQL)
    await adminDb.query(SHOW_SQL) // idempotent: a second run changes nothing and does not fail
    await adminDb.query(`alter role bazaar_live_reader login password '${readerPassword}'`)
    reader = new pg.Client({ connectionString: withDb(ADMIN_URL ?? '', dbName).replace(/\/\/[^@]*@/, `//bazaar_live_reader:${readerPassword}@`) })
    await reader.connect()
  })

  afterAll(async () => {
    await reader?.end().catch(() => undefined)
    await adminDb?.end().catch(() => undefined)
    await admin?.query(`drop database if exists ${dbName} with (force)`).catch(() => undefined)
    await admin?.query('drop role if exists bazaar_live_reader').catch(() => undefined)
    // show.sql revoked CONNECT on these from PUBLIC: put it back, this cluster is not ours alone.
    await admin?.query('grant connect on database postgres to public').catch(() => undefined)
    await admin?.end().catch(() => undefined)
  })

  it('creates the role NOLOGIN in the file itself (the coordinator adds LOGIN)', () => {
    expect(SHOW_SQL).toMatch(/create role bazaar_live_reader nologin/i)
    expect(SHOW_SQL).not.toMatch(/password\s+'/i)
  })

  it('reads the two views', async () => {
    const t = await reader.query('select * from show.thread_lines order by event_id')
    const d = await reader.query('select * from show.duel_lines')
    expect(t.rowCount).toBeGreaterThan(0)
    expect(d.rowCount).toBe(0) // readable, and empty while the gate is closed
  })

  it.each(['public.feed_events', 'feed_events', 'public.duels', 'duels'])('cannot read %s directly', async (table) => {
    await expect(reader.query(`select 1 from ${table} limit 1`)).rejects.toMatchObject({ code: '42501' })
  })

  it('cannot write, create, or reach the base tables through the schema', async () => {
    // Read-only is only a default the role could switch off: the grants must refuse the write by themselves.
    await reader.query('begin')
    await reader.query('set transaction read write')
    await expect(reader.query('insert into feed_events (id) values (99)')).rejects.toMatchObject({ code: '42501' })
    await reader.query('rollback')
    await reader.query('begin')
    await reader.query('set transaction read write')
    await expect(reader.query('delete from duels')).rejects.toMatchObject({ code: '42501' })
    await reader.query('rollback')
    for (const ddl of ['create table show.x (a int)', 'create table public.x (a int)']) {
      await reader.query('begin')
      await reader.query('set transaction read write')
      await expect(reader.query(ddl)).rejects.toMatchObject({ code: '42501' })
      await reader.query('rollback')
    }
    await expect(reader.query('update show.thread_lines set text = null')).rejects.toBeTruthy()
  })

  it('holds SELECT on exactly the two views and nothing else', async () => {
    const grants = await adminDb.query(
      `select table_schema, table_name, privilege_type from information_schema.role_table_grants where grantee = 'bazaar_live_reader' order by 1, 2, 3`,
    )
    expect(grants.rows).toEqual([
      { table_schema: 'show', table_name: 'duel_lines', privilege_type: 'SELECT' },
      { table_schema: 'show', table_name: 'thread_lines', privilege_type: 'SELECT' },
    ])
  })

  it('may execute only the three pure helpers, which read no table', async () => {
    const fns = await adminDb.query(
      `select routine_schema, routine_name from information_schema.role_routine_grants where grantee = 'bazaar_live_reader' order by 2`,
    )
    expect(fns.rows).toEqual([
      { routine_schema: 'show', routine_name: 'as_int' },
      { routine_schema: 'show', routine_name: 'as_text' },
      { routine_schema: 'show', routine_name: 'card_in' },
    ])
  })

  it('is read-only with a short statement timeout', async () => {
    expect((await reader.query('show default_transaction_read_only')).rows[0]).toEqual({ default_transaction_read_only: 'on' })
    expect((await reader.query('show statement_timeout')).rows[0]).toEqual({ statement_timeout: '2s' })
  })

  it('shows only our dealer threads, with our own text null', async () => {
    const { rows } = await reader.query('select * from show.thread_lines order by event_id')
    expect(rows.map((r) => r.event_id)).toEqual(['1', '2', '3', '4', '7'])
    const ours = rows.find((r) => r.event_id === '2')
    expect(ours).toMatchObject({ kind: 'message', speaker: 'us', text: null, thread: 187, counterpart: 'chato', item_ref: 'LAV-08', give_cash: 24, want_cash: 0, final: false })
    const theirs = rows.find((r) => r.event_id === '3')
    expect(theirs).toMatchObject({ speaker: 'them', give_cash: 0, want_cash: 31, final: true, offer_maker: 'chato' })
    expect(theirs?.text).toContain('I match what you move')
    expect(rows.find((r) => r.event_id === '1')).toMatchObject({ kind: 'opened', item_ref: 'LAV-08', counterpart: 'chato' })
    expect(rows.find((r) => r.event_id === '4')).toMatchObject({ kind: 'settlement', counterpart: 'abuela', price: 31, item_ref: 'LAV-08' })
    // The malformed row survives with nulls instead of breaking the view.
    expect(rows.find((r) => r.event_id === '7')).toMatchObject({ thread: null, give_cash: null, want_cash: null })
  })

  it('shows NO duel while the gate is closed, whatever its session or state', async () => {
    const rows = (await reader.query('select * from show.duel_lines')).rows
    expect(rows).toEqual([])
    expect((await reader.query('select count(*)::int as n from show.thread_lines')).rows[0]?.n).toBeGreaterThan(0)
  })

  describe('with the gate open (an admin ran: update show.gate set open_all = true)', () => {
    beforeAll(async () => void (await adminDb.query('update show.gate set open_all = true')))
    afterAll(async () => void (await adminDb.query('update show.gate set open_all = false')))

    it('shows the conversation of CLOSED duels only, in every session, and nothing of a live one', async () => {
      const { rows } = await reader.query('select * from show.duel_lines order by duel, kind, n')
      const messages = rows.filter((r) => r.kind === 'message')
      expect(messages.map((r) => r.duel).sort((a, b) => a - b)).toEqual([61, 61, 62, 71, 81, 82]) // 91 and 93 sit beside a live duel that is not stale
      expect(messages.find((r) => r.duel === 61 && r.n === 1)).toMatchObject({ speaker: 'them', text: 'Sesenta y no se hable más.', price: 60, days: 3, tick: 40, role: 'seller' })
      expect(messages.find((r) => r.duel === 61 && r.n === 2)).toMatchObject({ speaker: 'us', price: 50 })
      expect(rows.filter((r) => [63, 72, 83, 92, 94].includes(r.duel))).toEqual([]) // the live ones: no row at all
      expect(rows.filter((r) => r.kind === 'live')).toEqual([])
      expect(rows.filter((r) => r.kind === 'closed').map((r) => r.duel).sort((a, b) => a - b)).toEqual([61, 62, 64, 71, 81, 82])
    })

    it('keeps a closed duel hidden beside a live sibling that is not stale, and shows it once that one is', async () => {
      expect((await reader.query('select 1 from show.duel_lines where duel in (91, 93)')).rowCount).toBe(0)
      await adminDb.query('update duels set deadline_tick = 5 where duel = 92') // its deadline is past the feed's newest tick (17)
      await adminDb.query('update duels set deadline_tick = 5 where duel = 94')
      const shown = await reader.query("select duel from show.duel_lines where kind = 'closed' and duel in (91, 93) order by duel")
      expect(shown.rows).toEqual([{ duel: 91 }, { duel: 93 }])
      await adminDb.query('update duels set deadline_tick = 9999 where duel = 92')
      await adminDb.query('update duels set deadline_tick = null where duel = 94')
    })

    it('still never leaks a private value or a live duel text', async () => {
      const d = await reader.query('select * from show.duel_lines')
      const dump = JSON.stringify([d.rows, d.fields.map((f) => f.name)])
      for (const secret of [String(SECRET_LIMIT), String(SECRET_RESULT), SECRET_REASON, SECRET_WEIGHT, 'LIVE-TEXT-MUST-NOT-LEAK', 'Rival Sol', 'Rival Rojo', 'Rival Rosa', 'Rival Dos', 'Rival Cuatro']) {
        expect(dump).not.toContain(secret)
      }
    })
  })

  it('the role cannot flip the gate or even read it', async () => {
    expect(await refusedWhenWritable(reader, 'update show.gate set open_all = true')).toMatchObject({ code: '42501' })
    await expect(reader.query('select * from show.gate')).rejects.toMatchObject({ code: '42501' })
  })

  it('cannot lift its limits or create temp objects, and reaches no other database', async () => {
    expect((await reader.query('show temp_file_limit')).rows[0]).toEqual({ temp_file_limit: '16MB' })
    await expect(reader.query('set temp_file_limit = -1')).rejects.toMatchObject({ code: '42501' })
    expect(await refusedWhenWritable(reader, 'create temp table big as select generate_series(1, 10) as n')).toMatchObject({ code: '42501' })
    expect((await adminDb.query("select has_database_privilege('bazaar_live_reader', 'postgres', 'CONNECT') as ok")).rows[0]).toEqual({ ok: false })
    expect((await adminDb.query(`select has_database_privilege('bazaar_live_reader', '${dbName}', 'CONNECT') as ok`)).rows[0]).toEqual({ ok: true })
  })

  it('answers through security_barrier views', async () => {
    const { rows } = await adminDb.query("select relname, reloptions from pg_class where relname in ('thread_lines', 'duel_lines') order by 1")
    expect(rows).toEqual([{ relname: 'duel_lines', reloptions: ['security_barrier=true'] }, { relname: 'thread_lines', reloptions: ['security_barrier=true'] }])
  })

  it('never lets a private key or value into a row, a column or a text', async () => {
    const t = await reader.query('select * from show.thread_lines')
    const d = await reader.query('select * from show.duel_lines')
    const dump = JSON.stringify([t.rows, d.rows, t.fields.map((f) => f.name), d.fields.map((f) => f.name)])
    for (const secret of [String(SECRET_LIMIT), String(SECRET_RESULT), SECRET_REASON, SECRET_WEIGHT, 'LIVE-TEXT-MUST-NOT-LEAK', 'Rival Sol']) {
      expect(dump).not.toContain(secret)
    }
    const columns = [...t.fields, ...d.fields].map((f) => f.name)
    for (const banned of ['your_limit', 'result', 'limit', 'reason', 'your_days_weight', 'limit_meaning', 'payload']) {
      expect(columns).not.toContain(banned)
    }
  })
})
