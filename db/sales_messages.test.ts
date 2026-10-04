import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.SHOW_TEST_ADMIN_URL
const ddl = readFileSync(new URL('./sales_messages.sql', import.meta.url), 'utf8')
const name = `sales_quotes_${randomBytes(4).toString('hex')}`

describe.skipIf(!url)('private Sales ACK view (isolated local Postgres)', () => {
  let admin: pg.Client, db: pg.Client
  let createdRole = false
  beforeAll(async () => {
    const target = new URL(url ?? '')
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)) throw new Error('local database required')
    admin = new pg.Client({ connectionString: url })
    await admin.connect()
    createdRole = (await admin.query("select 1 from pg_roles where rolname='bazaar_live_reader'")).rowCount === 0
    await admin.query(`create database ${name}`)
    target.pathname = `/${name}`
    db = new pg.Client({ connectionString: target.toString() })
    await db.connect()
    await db.query(`create schema show;
      do $$ begin if not exists(select 1 from pg_roles where rolname='bazaar_live_reader') then create role bazaar_live_reader nologin; end if; end $$;
      create table messages(id bigint primary key,thread_id bigint,tick int,sender text,text text,ours bool);
      create table threads(id bigint primary key,counterpart text,venue text,ours bool,kind text,status text,closed_tick int);
      create table decisions(id bigint primary key,agent text,status text,dry_run bool,candidates jsonb,thread_id bigint,tick int);
      create table executions(id bigint primary key,decision_id bigint,tick int,sdk_method text,error_code text,response jsonb,request jsonb);
      insert into threads values(3334,'t03','rastro',true,'team','closed',2247);
      insert into messages select i,3334,2244,'t01','Actual acknowledged words '||i,true from generate_series(1,9) i;
      insert into decisions select i,'sales','done',false,'{"evidence_context":{"world":"real"}}',3334,2244 from generate_series(1,9) i;
      insert into executions select i,i,2244,'say',null,jsonb_build_object('message',i),'{"thread_id":3334}' from generate_series(1,9) i;
      update decisions set status='approved' where id=2;
      update executions set response='{"id":3}' where id=3;
      update decisions set dry_run=true where id=4;
      update decisions set candidates='{"evidence_context":{"world":"sim"}}' where id=5;
      update messages set sender='t03',ours=false where id=6;
      update executions set error_code='network' where id=7;
      update executions set request='{"thread_id":555}' where id=8;
      update decisions set thread_id=555 where id=9;`)
    await db.query(ddl)
    await db.query(ddl)
  })
  afterAll(async () => {
    await db?.end().catch(() => undefined)
    await admin?.query(`drop database if exists ${name} with (force)`).catch(() => undefined)
    if (createdRole) await admin?.query('drop role if exists bazaar_live_reader').catch(() => undefined)
    await admin?.end().catch(() => undefined)
  })
  it('selects only real own words acknowledged by exact successful Sales send, without requiring public feed', async () => {
    const { rows } = await db.query('select * from show.game_sales_messages order by id')
    expect(rows).toEqual([{ id: '1', thread_id: '3334', tick: 2244, sender: 't01', text: 'Actual acknowledged words 1', counterpart: 't03', venue: 'rastro', thread_status: 'closed', closed_tick: 2247 }])
    expect(Object.keys(rows[0])).toEqual(['id', 'thread_id', 'tick', 'sender', 'text', 'counterpart', 'venue', 'thread_status', 'closed_tick'])
  })
  it('grants only the view, never underlying messages or execution records', async () => {
    const { rows } = await db.query(`select has_table_privilege('bazaar_live_reader','show.game_sales_messages','select') as view,
      has_table_privilege('bazaar_live_reader','public.messages','select') as messages,
      has_table_privilege('bazaar_live_reader','public.executions','select') as executions`)
    expect(rows).toEqual([{ view: true, messages: false, executions: false }])
  })
})
