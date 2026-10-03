-- Movements screen (bazaar-live): our cash over the day and what moved it, read-only for bazaar_live_reader.
--
-- Four views in schema `show`, like db/show.sql and db/learn.sql: the reader gets these and nothing else
-- (no table grants). Our team is the one in the real world's latest /me snapshot.
--
--   show.cash_points  our cash at every tick it changed (and the latest tick), with score and rank
--   show.our_trades   our settlements (the feed's): buy or sell, counterparty, card, price, the fee
--   show.our_orders   what our agents committed in the ledger: listings, accepts, spends
--   show.our_events   feed events that move cash or stock other than a trade: a venue's bond, packs,
--                     gifts, a level unlocked (public facts, ours only)
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it (and after the
-- other show files), every time:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/history.sql

create schema if not exists show;

create or replace view show.cash_points with (security_barrier = true) as
with per_tick as (
  select distinct on (day, m.tick)
         (m.read_at at time zone 'Europe/Madrid')::date as day,
         m.tick, m.cash, m.team, m.read_at,
         case when jsonb_typeof(m.score -> 'score') = 'number' then (m.score ->> 'score')::numeric end as score,
         show.as_int(m.score -> 'rank') as rank
    from public.me_snapshots m
   where m.world = 'real' and m.tick is not null and m.cash is not null
   order by day, m.tick, m.read_at desc
), marked as (
  select p.*, lag(p.cash) over w as prev_cash, lead(p.tick) over w as next_tick
    from per_tick p
  window w as (order by p.day, p.tick)
)
select day, tick, cash, prev_cash, score, rank, team, read_at
  from marked
 where prev_cash is null or prev_cash <> cash or next_tick is null;

-- From the feed's settlements (not the tape): they carry when we received them, so a tick that starts
-- again on a new day still sorts. A buyer pays price + fee; a seller gets the price.
create or replace view show.our_trades with (security_barrier = true) as
with us as (
  select team from public.me_snapshots where world = 'real' and team is not null order by read_at desc limit 1
), ours as (
  select f.id, f.tick, f.received_at, f.payload, f.payload -> 'items' -> 0 as item, us.team
    from public.feed_events f
    cross join us
   where f.type = 'settlement'
     and jsonb_typeof(f.payload -> 'items') = 'array'
     and (f.payload -> 'items' -> 0 ->> 'to' = us.team or f.payload -> 'items' -> 0 ->> 'frm' = us.team)
)
select o.id, (o.received_at at time zone 'Europe/Madrid')::date as day, o.tick,
       show.as_text(o.payload -> 'venue', 32) as venue,
       case when o.item ->> 'to' = o.team then 'buy' else 'sell' end as side,
       show.as_text(case when o.item ->> 'to' = o.team then o.item -> 'frm' else o.item -> 'to' end, 32) as counterparty,
       show.as_text(o.item -> 'ref', 16) as card,
       show.as_text(o.item -> 'name', 64) as card_name,
       show.as_text(o.item -> 'rarity', 16) as rarity,
       jsonb_array_length(o.payload -> 'items') as items,
       show.as_int(o.payload -> 'price') as price,
       coalesce(show.as_int(o.payload -> 'fee'), 0) as fee
  from ours o;

create or replace view show.our_orders with (security_barrier = true) as
select l.id, (l.created_at at time zone 'Europe/Madrid')::date as day, l.kind, l.tick, l.price, l.item, l.source as agent
  from public.ledger l;

create or replace view show.our_events with (security_barrier = true) as
with us as (
  select team from public.me_snapshots where world = 'real' and team is not null order by read_at desc limit 1
)
select f.id, (f.received_at at time zone 'Europe/Madrid')::date as day, f.tick, f.type,
       show.as_text(f.payload -> 'venue', 32) as venue,
       show.as_text(f.payload -> 'name', 64) as name,
       show.as_int(f.payload -> 'bond') as bond,
       show.as_text(f.payload -> 'pack', 32) as pack,
       show.as_text(f.payload -> 'best' -> 'ref', 16) as best,
       show.as_int(f.payload -> 'cash') as cash,
       show.as_int(f.payload -> 'level') as level,
       show.as_text(f.payload -> 'why', 120) as why
  from public.feed_events f
  cross join us
 where f.type in ('venue.opened', 'venue.closed', 'pack.opened', 'gift.given', 'level.unlocked', 'settlement.failed')
   and (f.payload ->> 'team' = us.team or f.payload ->> 'owner' = us.team or f.actor = us.team);

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

grant usage on schema show to bazaar_live_reader;
grant select on show.cash_points, show.our_trades, show.our_orders, show.our_events to bazaar_live_reader;
