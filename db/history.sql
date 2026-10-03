-- Movements screen (bazaar-live): our cash over the day and what moved it, read-only for bazaar_live_reader.
--
-- Six views in schema `show`, like db/show.sql and db/learn.sql: the reader gets these and nothing else
-- (no table grants). Our team is the one in the real world's latest /me snapshot.
--
--   show.cash_points  our cash at every tick it changed (and the latest tick), with score and rank
--   show.our_trades   our settlements (the feed's): buy or sell, counterparty, card, price, the fee
--   show.our_orders   what our agents committed in the ledger: listings, accepts, spends; a listing posted by hand
--                     with its offer (side, card, venue, expiry, status) from show.game_our_offers
--   show.our_events   feed events that move cash or stock other than a trade: a venue's bond, packs,
--                     gifts, a level unlocked (public facts, ours only)
--   show.score_points our score and its five parts (and cash) at every tick one of them changed (and the
--                     latest tick): never the whole score object (it carries luck_private)
--   show.score_marks  what may explain a change of score: an agent process starting (a deploy or a restart)
--                     and the game's own turns (a round, a Market Test, duels, a new day)
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it (and after the
-- other show files), every time. show.our_orders reads db/game.sql's show.game_our_offers: game.sql goes first.
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql

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

-- A listing posted by hand (`bazaar sell ... --live` books it as item 'hands-off:<offer id>') carries that offer as
-- show.game_our_offers (db/game.sql) has it: buy or sell, the card, the venue, when it expires and what became of it.
-- Other rows have nulls there. New columns go last: `create or replace view` only appends.
create or replace view show.our_orders with (security_barrier = true) as
select l.id, (l.created_at at time zone 'Europe/Madrid')::date as day, l.kind, l.tick, l.price, l.item, l.source as agent,
       o.offer, o.side as offer_side, o.card as offer_card, o.venue as offer_venue, o.expires_tick as offer_expires, o.status as offer_status
  from public.ledger l
  left join show.game_our_offers o
    on l.kind = 'listing' and o.offer = case when l.item ~ '^hands-off:[0-9]{1,9}$' then substring(l.item from 11)::int end;

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

-- One row per (day, tick), the latest read, kept only when the score, one of its parts or the cash moved
-- (the score drifts with the others' play, but most ticks nothing moves), and the latest tick. The parts are
-- in their own units: the score is not their sum.
create or replace view show.score_points with (security_barrier = true) as
with us as (
  select team from public.me_snapshots where world = 'real' and team is not null order by read_at desc limit 1
), per_tick as (
  select distinct on (day, m.tick)
         (m.read_at at time zone 'Europe/Madrid')::date as day,
         m.tick, m.read_at, m.cash,
         case when jsonb_typeof(m.score -> 'score') = 'number' then round((m.score ->> 'score')::numeric, 3) end as score,
         case when jsonb_typeof(m.score -> 'duel_points') = 'number' then round((m.score ->> 'duel_points')::numeric, 3) end as duel,
         case when jsonb_typeof(m.score -> 'ladder_points') = 'number' then round((m.score ->> 'ladder_points')::numeric, 3) end as ladder,
         case when jsonb_typeof(m.score -> 'neg_points') = 'number' then round((m.score ->> 'neg_points')::numeric, 3) end as neg,
         case when jsonb_typeof(m.score -> 'mm_points') = 'number' then round((m.score ->> 'mm_points')::numeric, 3) end as mm,
         case when jsonb_typeof(m.score -> 'bench_points') = 'number' then round((m.score ->> 'bench_points')::numeric, 3) end as bench
    from public.me_snapshots m
    cross join us
   where m.world = 'real' and m.team = us.team and m.tick is not null and jsonb_typeof(m.score) = 'object'
   order by day, m.tick, m.read_at desc
), marked as (
  select p.*,
         row(p.cash, p.score, p.duel, p.ladder, p.neg, p.mm, p.bench)::text as now_row,
         lag(row(p.cash, p.score, p.duel, p.ladder, p.neg, p.mm, p.bench)::text) over w as prev_row,
         lead(p.tick) over w as next_tick
    from per_tick p
  window w as (order by p.day, p.tick)
)
select day, tick, read_at, cash, score, duel, ladder, neg, mm, bench
  from marked
 where prev_row is null or prev_row <> now_row or next_tick is null;

-- A decision row has a tick and no time, and the game's tick may start again on a new day. So a start is put
-- on its day by order, not by tick alone: a decision whose tick is far (over 100) below the one written just
-- before it opens a new run of the clock (when the one after it is too: a single stale tick does not), and so does a day whose first tick is far below the last day's
-- last; the start goes to the latest day of its own run that had reached its tick. Only the agent and the
-- tick leave the row (in a decision `owner` is the process's writer token; its reason is never read).
-- The game's own turns are public feed events, with the time we received them.
create or replace view show.score_marks with (security_barrier = true) as
with days as (
  select d.day, d.min_tick,
         count(*) filter (where d.min_tick < d.prev_max - 100) over (order by d.day) as run
    from (select x.day, x.min_tick, lag(x.max_tick) over (order by x.day) as prev_max
            from (select (m.read_at at time zone 'Europe/Madrid')::date as day, min(m.tick) as min_tick, max(m.tick) as max_tick
                    from public.me_snapshots m
                   where m.world = 'real' and m.tick is not null
                   group by 1) x) d
), decided as (
  select r.id, r.tick, r.agent, r.kind,
         count(*) filter (where r.prev_tick - r.tick > 100 and coalesce(r.prev_tick - r.next_tick > 100, true)) over (order by r.id) as run
    from (select d.id, d.tick, d.agent, d.kind, lag(d.tick) over (order by d.id) as prev_tick, lead(d.tick) over (order by d.id) as next_tick
            from public.decisions d
           where d.tick >= 0 and d.dry_run is not true) r
)
select 'start'::text as kind, s.id, dy.day, s.tick, left(s.agent, 24) as agent,
       null::text as action, null::text as note, null::timestamptz as at
  from decided s
  cross join lateral (select y.day from days y
                       where y.run = s.run
                       order by (y.min_tick <= s.tick) desc, case when y.min_tick <= s.tick then y.day end desc, y.day
                       limit 1) dy
 where s.kind = 'process_started'
union all
select 'game', f.id, (f.received_at at time zone 'Europe/Madrid')::date, f.tick, null,
       case when f.type = 'day.opened' then 'day' else show.as_text(f.payload -> 'action', 16) end,
       case when f.type = 'day.opened' then show.as_text(f.payload -> 'name', 32) else show.as_text(f.payload -> 'note', 120) end,
       f.received_at
  from public.feed_events f
 where f.tick is not null
   and (f.type = 'day.opened' or (f.type = 'schedule.fired' and f.payload ->> 'action' in ('round', 'bench', 'duels')));

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

grant usage on schema show to bazaar_live_reader;
grant select on show.cash_points, show.our_trades, show.our_orders, show.our_events, show.score_points, show.score_marks to bazaar_live_reader;
