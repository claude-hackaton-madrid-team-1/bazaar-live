-- Bazaar Live (LIVE-T1): what the show may read of our real conversations.
--
-- Applied by the coordinator with the ADMIN url (never by this repo, never by the show):
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql
-- then, once, outside this file (so no password is ever committed):
--     alter role bazaar_live_reader login password :'generated_password';   -- psql -v generated_password=...
-- and the service variable SHOW_DATABASE_URL on bazaar-live is that role's url.
--
-- Idempotent. Two views and one role:
--   * show.thread_lines  our dealer threads only (thread.opened / thread.message / settlement with t01)
--   * show.duel_lines    the conversation of CLOSED duels only; a live duel contributes nothing
-- The views run with their OWNER's rights, so the role holds no grant on feed_events or duels at all.
-- Private duel keys (your_limit, your_days_weight, limit_meaning, result, any reason/limit field) are
-- never selected: message rows copy only from/text/tick/price/days out of the payload.
-- Our team id is t01 (bazaar sql/schema.sql, traders.status = 'us').

begin;
set local lock_timeout = '15s';

create schema if not exists show;

-- A number out of jsonb, or null: one odd row must not break the view for every other row.
create or replace function show.as_int(j jsonb) returns int
language sql immutable parallel safe as
$$ select case when jsonb_typeof(j) = 'number' and (j #>> '{}') ~ '^-?[0-9]{1,9}$' then (j #>> '{}')::int end $$;

-- A short plain string out of jsonb, or null.
create or replace function show.as_text(j jsonb, max_len int default 1000) returns text
language sql immutable parallel safe as
$$ select case when jsonb_typeof(j) = 'string' then left(j #>> '{}', max_len) end $$;

-- The card ref in 'card:LAV-08' (first one in a types array), or null.
create or replace function show.card_in(types jsonb) returns text
language sql immutable parallel safe as
$$ select substring(t from '^card:([A-Z]{3}-[0-9]{1,3})$')
     from jsonb_array_elements_text(case when jsonb_typeof(types) = 'array' then types else '[]'::jsonb end) t
    where t ~ '^card:[A-Z]{3}-[0-9]{1,3}$' limit 1 $$;

-- Views check table rights as their owner but run functions as the CALLER: the role needs EXECUTE on
-- these three pure helpers (they read no table). Nobody else is granted them.
revoke all on function show.as_int(jsonb), show.as_text(jsonb, int), show.card_in(jsonb) from public;

create or replace view show.thread_lines with (security_barrier = true) as
with opened as (
  select distinct on (show.as_int(payload -> 'thread'))
         show.as_int(payload -> 'thread') as thread,
         coalesce(show.as_text(payload -> 'topic' -> 'buy' -> 'card', 16), show.as_text(payload -> 'topic' -> 'sell' -> 'card', 16),
                  show.as_text(payload -> 'topic' -> 'buy' -> 'pack', 24), show.as_text(payload -> 'topic' -> 'sell' -> 'pack', 24)) as item
    from public.feed_events
   where type = 'thread.opened' and payload ->> 'team' = 't01' and show.as_int(payload -> 'thread') is not null
   order by show.as_int(payload -> 'thread'), id
)
select e.id as event_id,
       e.tick,
       case e.type when 'thread.opened' then 'opened' when 'thread.message' then 'message' else 'settlement' end as kind,
       show.as_int(e.payload -> 'thread') as thread,
       case when e.type = 'settlement'
            then coalesce(show.as_text(e.payload -> 'persona', 24),
                          (select p from jsonb_array_elements_text(case when jsonb_typeof(e.payload -> 'parties') = 'array' then e.payload -> 'parties' else '[]'::jsonb end) p
                            where p <> 't01' limit 1))
            else show.as_text(e.payload -> 'with', 24) end as counterpart,
       case when e.type = 'thread.opened' then 'us'
            when e.type = 'thread.message' then (case when e.payload ->> 'sender' = 't01' then 'us' else 'them' end) end as speaker,
       coalesce(show.card_in(e.payload -> 'offer' -> 'give' -> 'types'), show.card_in(e.payload -> 'offer' -> 'want' -> 'types'),
                (select substring(i ->> 'ref' from '^[A-Z]{3}-[0-9]{1,3}$')
                   from jsonb_array_elements(case when jsonb_typeof(e.payload -> 'items') = 'array' then e.payload -> 'items' else '[]'::jsonb end) i limit 1),
                o.item) as item_ref,
       show.as_text(e.payload -> 'offer' -> 'maker', 24) as offer_maker,
       show.as_int(e.payload -> 'offer' -> 'give' -> 'cash') as give_cash,
       show.as_int(e.payload -> 'offer' -> 'want' -> 'cash') as want_cash,
       (e.payload -> 'offer' -> 'final') = 'true'::jsonb as final,
       show.as_text(e.payload -> 'offer' -> 'status', 16) as offer_status,
       show.as_int(e.payload -> 'price') as price,
       -- Our own words are not in the feed (null there); never pass any through.
       case when e.type = 'thread.message' and e.payload ->> 'sender' <> 't01' then show.as_text(e.payload -> 'text') end as text,
       e.received_at
  from public.feed_events e
  left join opened o on o.thread = show.as_int(e.payload -> 'thread') and e.type <> 'settlement'
 where (e.type in ('thread.opened', 'thread.message') and e.payload ->> 'team' = 't01')
    or (e.type = 'settlement' and jsonb_typeof(e.payload -> 'parties') = 'array' and e.payload -> 'parties' ? 't01');

-- The gate: when may a closed duel's conversation be public? (security audit P1)
-- Our duel prices are a fixed function of our private limit and every team plays the same scenarios, so a
-- finished transcript lets a rival still negotiating with us compute our walk-away price. So a closed duel
-- is shown only when ALL of these hold:
--   * no duel of its session is live, and no duel over the same item is live (the sibling case);
--   * its session is over: a later session exists, or show.gate.open_all was switched on by an admin
--     (after the last session: `update show.gate set open_all = true`).
-- The server also keeps duels off the page entirely unless SHOW_DUELS is set; this is the second wall.
create table if not exists show.gate (
  only_row boolean primary key default true check (only_row),
  open_all boolean not null default false
);
insert into show.gate (only_row, open_all) values (true, false) on conflict do nothing;
revoke all on show.gate from public;

create or replace view show.duel_lines with (security_barrier = true) as
with shown as (
  select d.* from public.duels d
   where d.status in ('deal', 'no_deal')
     and not exists (select 1 from public.duels l
                      where l.status = 'live' and (l.session is not distinct from d.session or l.item is not distinct from d.item))
     and (d.session < (select max(x.session) from public.duels x) or (select g.open_all from show.gate g))
)
-- The outcome.
select 'closed'::text as kind, d.duel, 0 as n, d.session, d.status, d.role, d.item, d.rival,
       null::text as speaker, null::int as tick, null::int as price, null::int as days, null::text as text,
       d.price as final_price, d.days as final_days, d.updated_at
  from shown d
union all
-- One row per message; only these five keys leave the payload.
select 'message', d.duel, m.n::int, d.session, d.status, d.role, d.item, d.rival,
       case when m.msg ->> 'from' = d.rival then 'them' else 'us' end,
       show.as_int(m.msg -> 'tick'), show.as_int(m.msg -> 'price'), show.as_int(m.msg -> 'days'), show.as_text(m.msg -> 'text'),
       d.price, d.days, d.updated_at
  from shown d
 cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload -> 'messages') = 'array' then d.payload -> 'messages' else '[]'::jsonb end)
                    with ordinality as m(msg, n)
 where jsonb_typeof(m.msg) = 'object';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

-- Whatever it held before is dropped, so a re-run converges on exactly: USAGE on show + SELECT on two views.
revoke all on all tables in schema show from bazaar_live_reader;
revoke all on all functions in schema show from bazaar_live_reader;
revoke all on schema show from bazaar_live_reader;
grant usage on schema show to bazaar_live_reader;
grant execute on function show.as_int(jsonb), show.as_text(jsonb, int), show.card_in(jsonb) to bazaar_live_reader;
grant select on show.thread_lines, show.duel_lines to bazaar_live_reader;

alter role bazaar_live_reader connection limit 4;
-- A superuser-only limit: the role cannot lift it. (statement_timeout and read-only below are only defaults.)
alter role bazaar_live_reader set temp_file_limit = '16MB';
alter role bazaar_live_reader set default_transaction_read_only = on;
alter role bazaar_live_reader set statement_timeout = '2s';
alter role bazaar_live_reader set idle_in_transaction_session_timeout = '5s';

-- Narrow what PUBLIC (and so this role) may do to the database. Our agents connect as the owner role, which
-- these revokes do not touch. TEMPORARY: no temp tables. CONNECT: the role reaches only its own database.
do $$
declare
  other text;
begin
  execute format('revoke temporary on database %I from public', current_database());
  foreach other in array array['postgres', 'bazaar_sim'] loop
    if other <> current_database() and exists (select from pg_database where datname = other) then
      execute format('revoke connect on database %I from public', other);
    end if;
  end loop;
end $$;

commit;
