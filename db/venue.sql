-- Venue screen (bazaar-live, /venue): our market-making venue and the Market Test. Read-only for bazaar_live_reader,
-- behind GAME_VIEW_TOKEN only: these rows carry our broker's moves and our private score parts (bench efficiency,
-- bench and market-making points), which the public board hides. Never add them to the public show views
-- (show.thread_lines, show.duel_lines, show.injection_attempts).
--
-- Six views in schema `show`, like the other show files (no table grant, no new function). Our team is the one in
-- the real world's latest /me snapshot; a day is the Madrid date we received a row on (the tick starts again daily).
--   show.venue_ours      each venue of ours: name, mechanism, fee, status, when it opened, whether /me names it as
--                        our venue now and as the one the Market Test counts (bench_venue)
--   show.venue_sessions  each Market Test session the public feed announced (bench.started): session, start tick,
--                        how long its book lasts, how many venues got it, whether one of ours did
--   show.venue_books     each synthetic book our broker saw (bench_books, one run per session): the venue, its fee,
--                        the ticks seen and every bench trader once (its id, side, quote, first and last tick seen),
--                        put on its session by tick and time
--   show.venue_matches   our broker's matches (bench and public) and the bench probe: tick, status, the run, the
--                        quotes, price, fee, quoted surplus, the guardrail's denial and the game's error code
--   show.venue_trades    what other teams did on our venues, from the public feed: offers listed, settlements,
--                        failed settlements (card, price, fee, who)
--   show.venue_score     our Market Test numbers from /me at every tick one of them changed (and the latest)
--
-- bench.finished (the session's official efficiency and matches) reaches only our team stream, never the feed table,
-- so the per-session result is read from /me (show.venue_score) after each session.
--
-- Never selected: a decision's candidates / chosen / rag_context / state_digest / reason whole, executions.request /
-- response, the raw bench offer (bench_books.offer), venue_broker_keys (the broker key), the snapshot's me / score
-- objects whole (luck_private, collection_value), the writer token (`owner`).
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it and the other show
-- files, every time:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/teams_score.sql -f db/injections.sql -f db/venue.sql

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader')
     or to_regprocedure('show.as_int(jsonb)') is null or to_regprocedure('show.as_text(jsonb, int)') is null then
    raise exception 'apply db/show.sql first: it creates schema show, its helpers and the role bazaar_live_reader';
  end if;
end $$;

-- Our venues: every venue the feed says we opened (owner or actor), and the ones /me names (our venue, the venue the
-- Market Test counts). Each one's state is its latest venue.* event; the fee its latest change in force (a notice
-- announces, a change applies). A venue the feed never showed opening takes the keeper's last venue_open decision for
-- its mechanism and fee when it is the one /me names now; one with no event at all has no known status unless /me
-- names it as our venue now (a starter stall /me named once, replaced since, stays null).
create or replace view show.venue_ours with (security_barrier = true) as
with us as (
  select m.team, m.tick, m.read_at,
         show.as_text(m.score -> 'venue', 24) as venue,
         show.as_text(m.score -> 'bench_venue', 24) as bench_venue
    from public.me_snapshots m where m.world = 'real' and m.team is not null order by m.read_at desc limit 1
), ev as (
  select f.id, f.tick, f.received_at, f.type, f.actor, f.payload, show.as_text(f.payload -> 'venue', 24) as venue
    from public.feed_events f
   where f.type in ('venue.opened', 'venue.reopened', 'venue.fee_changed', 'venue.closing', 'venue.closed', 'venue.suspended')
), ids as (
  select e.venue from ev e cross join us
   where e.type = 'venue.opened' and (e.actor = us.team or e.payload ->> 'owner' = us.team) and e.venue is not null
  union
  select x.v from us cross join lateral (values (us.venue), (us.bench_venue)) x(v) where x.v is not null
  union
  select show.as_text(m.score -> 'venue', 24) from public.me_snapshots m cross join us
   where m.world = 'real' and m.team = us.team and jsonb_typeof(m.score -> 'venue') = 'string'
), keeper as (
  select left(show.as_text(d.candidates -> 'name'), 40) as name, left(show.as_text(d.candidates -> 'mechanism'), 16) as mechanism,
         show.as_int(d.candidates -> 'fee_bps') as fee_bps, d.tick
    from public.decisions d
   where d.agent = 'broker' and d.kind = 'venue_open' and d.status = 'done' and d.dry_run is not true
   order by d.id desc limit 1
)
select i.venue,
       coalesce(left(show.as_text(o.payload -> 'name'), 40), case when i.venue = us.venue then k.name end) as name,
       coalesce(left(coalesce(show.as_text(o.payload -> 'rules' -> 'mechanism'), show.as_text(o.payload -> 'mechanism')), 16),
                case when i.venue = us.venue then k.mechanism end) as mechanism,
       coalesce(show.as_int(fc.payload -> 'fee_bps'), show.as_int(o.payload -> 'fee_bps'), case when i.venue = us.venue then k.fee_bps end) as fee_bps,
       coalesce(show.as_int(fc.payload -> 'fee_per_card'), show.as_int(o.payload -> 'fee_per_card')) as fee_per_card,
       case when st.type is null then case when i.venue = us.venue then 'open' end
            when st.type = 'venue.closed' then 'closed' when st.type = 'venue.closing' then 'closing'
            when st.type = 'venue.suspended' then 'suspended' else 'open' end as status,
       o.tick as opened_tick, o.received_at as opened_at,
       i.venue = us.venue as current,
       i.venue = us.bench_venue as counted,
       us.tick as me_tick
  from ids i
  cross join us
  left join keeper k on true
  left join lateral (select e.* from ev e where e.venue = i.venue and e.type = 'venue.opened' order by e.id desc limit 1) o on true
  left join lateral (select e.* from ev e where e.venue = i.venue and e.type = 'venue.fee_changed' order by e.id desc limit 1) fc on true
  left join lateral (select e.* from ev e where e.venue = i.venue order by e.id desc limit 1) st on true;

-- The Market Test sessions the public feed announced. `ours`: one of our venues is among the venues that got the book.
create or replace view show.venue_sessions with (security_barrier = true) as
select f.id, (f.received_at at time zone 'Europe/Madrid')::date as day, f.tick, f.received_at,
       show.as_int(f.payload -> 'session') as session,
       coalesce(show.as_int(f.payload -> 'start_tick'), f.tick) as start_tick,
       show.as_int(f.payload -> 'ticks') as ticks,
       case when jsonb_typeof(f.payload -> 'venues') = 'array' then jsonb_array_length(f.payload -> 'venues') end as venues,
       case when jsonb_typeof(f.payload -> 'venues') = 'array'
            then exists (select 1 from show.venue_ours o where f.payload -> 'venues' ? o.venue) end as ours
  from public.feed_events f
 where f.type = 'bench.started' and f.tick is not null;

-- Each synthetic book our broker read: one run per session (`b35`, the part of every bench offer id before the dash).
-- Every trader once, as first seen (side, quote) and when it was last seen (gone before the session's end: matched or
-- withdrawn). The session is the announced start the run's first tick falls in, on the same day.
create or replace view show.venue_books with (security_barrier = true) as
with offers as (
  select b.run, b.offer_id,
         (array_agg(b.side order by b.tick))[1] as side,
         (array_agg(b.quote order by b.tick))[1] as quote,
         min(b.tick) as first_tick, max(b.tick) as last_tick
    from public.bench_books b
   where b.world = 'real'
   group by b.run, b.offer_id
), runs as (
  select b.run, min(b.tick) as first_tick, max(b.tick) as last_tick, count(distinct b.tick)::int as ticks_seen,
         min(b.read_at) as first_at,
         (array_agg(b.venue order by b.tick desc))[1] as venue,
         (array_agg(b.fee_bps order by b.tick desc))[1] as fee_bps,
         (array_agg(b.fee_per_card order by b.tick desc))[1] as fee_per_card
    from public.bench_books b
   where b.world = 'real'
   group by b.run
)
select left(r.run, 16) as run, (r.first_at at time zone 'Europe/Madrid')::date as day, r.first_tick, r.last_tick, r.ticks_seen,
       left(r.venue, 24) as venue, r.fee_bps, r.fee_per_card, s.session, s.start_tick,
       coalesce((select jsonb_agg(jsonb_build_object('id', left(o.offer_id, 24), 'side', o.side, 'quote', o.quote,
                                                     'first', o.first_tick, 'last', o.last_tick) order by o.side, o.quote, o.offer_id)
                   from offers o where o.run = r.run), '[]'::jsonb) as offers
  from runs r
  left join lateral (select v.session, v.start_tick from show.venue_sessions v
                      where r.first_tick between v.start_tick and v.start_tick + coalesce(v.ticks, 16) + 2
                        and v.received_at between r.first_at - interval '1 hour' and r.first_at + interval '10 minutes'
                      order by v.received_at desc limit 1) s on true;

-- Our broker's matches: the bench's (item `bench:<run>`) and the public book's (item `card:<ref>`), and the one-time
-- bench probe. Only these fields of `candidates` leave the row; the game's answer only as its error code.
create or replace view show.venue_matches with (security_barrier = true) as
select d.id, d.tick, left(d.kind, 24) as kind, left(d.status, 16) as status,
       d.candidates -> 'bench' = 'true'::jsonb or coalesce(d.candidates ->> 'item', '') like 'bench:%' as bench,
       substring(d.candidates ->> 'item' from '^bench:([A-Za-z0-9]{1,16})$') as run,
       substring(d.candidates ->> 'item' from '^card:([A-Z]{3}-[0-9]{1,3})$') as card,
       show.as_int(d.candidates -> 'ask') as ask,
       show.as_int(d.candidates -> 'bid') as bid,
       show.as_int(d.candidates -> 'price') as price,
       show.as_int(d.candidates -> 'fee') as fee,
       case when jsonb_typeof(d.candidates -> 'surplus') = 'number' then round((d.candidates ->> 'surplus')::numeric, 1) end as surplus,
       d.policy_checks -> 'allowed' = 'true'::jsonb as allowed,
       case when d.policy_checks ->> 'guardrail' like 'denied%' then left(regexp_replace(d.policy_checks ->> 'guardrail', '\s+', ' ', 'g'), 140) end as guardrail,
       (select left(x.error_code, 32) from public.executions x where x.decision_id = d.id and x.error_code is not null order by x.id desc limit 1) as error_code
  from public.decisions d
 where d.agent = 'broker' and d.kind in ('broker_match', 'bench_probe') and d.dry_run is not true and d.tick >= 0;

-- Other teams on our venues, from the public feed: their offers listed there, the settlements there and the failed
-- ones. A settlement names its venue; a failed one only its offer (put on our venue when that offer was).
create or replace view show.venue_trades with (security_barrier = true) as
with mine as (select o.venue from show.venue_ours o), listed as (
  select f.id, f.tick, f.received_at, f.payload -> 'offer' as o,
         coalesce(show.as_text(f.payload -> 'offer' -> 'venue', 24), show.as_text(f.payload -> 'venue', 24)) as venue
    from public.feed_events f
   where f.type = 'offer.listed'
)
select l.id, (l.received_at at time zone 'Europe/Madrid')::date as day, l.tick, 'listed'::text as type, l.venue,
       left(coalesce(show.as_text(l.o -> 'give' -> 'assets' -> 0 -> 'ref'), show.card_in(l.o -> 'want' -> 'types'), show.card_in(l.o -> 'give' -> 'types'),
                     show.as_text(l.o -> 'want' -> 'assets' -> 0 -> 'ref')), 16) as card,
       coalesce(nullif(show.as_int(l.o -> 'want' -> 'cash'), 0), show.as_int(l.o -> 'give' -> 'cash')) as price,
       null::int as fee,
       case when coalesce(show.as_int(l.o -> 'give' -> 'cash'), 0) > 0 then 'buy' else 'sell' end as side,
       left(show.as_text(l.o -> 'maker'), 24) as maker, null::text as buyer, null::text as seller,
       show.as_int(l.o -> 'id') as offer
  from listed l
 where l.venue in (select venue from mine)
union all
select f.id, (f.received_at at time zone 'Europe/Madrid')::date, f.tick, 'settled', show.as_text(f.payload -> 'venue', 24),
       left(show.as_text(f.payload -> 'items' -> 0 -> 'ref'), 16),
       show.as_int(f.payload -> 'price'), show.as_int(f.payload -> 'fee'), null, null,
       left(show.as_text(f.payload -> 'items' -> 0 -> 'to'), 24), left(show.as_text(f.payload -> 'items' -> 0 -> 'frm'), 24), null
  from public.feed_events f
 where f.type = 'settlement' and f.payload ->> 'venue' in (select venue from mine)
union all
select f.id, (f.received_at at time zone 'Europe/Madrid')::date, f.tick, 'failed', l.venue, null, null, null, null, null, null, null,
       show.as_int(f.payload -> 'offer')
  from public.feed_events f
  join listed l on show.as_int(l.o -> 'id') = show.as_int(f.payload -> 'offer') and l.venue in (select venue from mine)
 where f.type = 'settlement.failed';

-- Our Market Test numbers from /me, field by field, at every tick one of them changed (and the latest).
create or replace view show.venue_score with (security_barrier = true) as
with us as (
  select team from public.me_snapshots where world = 'real' and team is not null order by read_at desc limit 1
), per_tick as (
  select distinct on (day, m.tick)
         (m.read_at at time zone 'Europe/Madrid')::date as day, m.tick, m.read_at,
         show.as_text(m.score -> 'venue', 24) as venue,
         show.as_text(m.score -> 'bench_venue', 24) as bench_venue,
         case when jsonb_typeof(m.score -> 'bench_efficiency') = 'number' then round((m.score ->> 'bench_efficiency')::numeric, 4) end as bench_efficiency,
         case when jsonb_typeof(m.score -> 'bench_points') = 'number' then round((m.score ->> 'bench_points')::numeric, 3) end as bench_points,
         case when jsonb_typeof(m.score -> 'mm_points') = 'number' then round((m.score ->> 'mm_points')::numeric, 3) end as mm_points,
         case when jsonb_typeof(m.score -> 'market') = 'number' then round((m.score ->> 'market')::numeric, 3) end as market
    from public.me_snapshots m
    cross join us
   where m.world = 'real' and m.team = us.team and m.tick is not null and jsonb_typeof(m.score) = 'object'
   order by day, m.tick, m.read_at desc
), marked as (
  select p.*,
         lag(row(p.venue, p.bench_venue, p.bench_efficiency, p.bench_points, p.mm_points, p.market)::text) over w as prev_row,
         lead(p.tick) over w as next_tick
    from per_tick p
  window w as (order by p.day, p.tick)
)
select day, tick, read_at, venue, bench_venue, bench_efficiency, bench_points, mm_points, market
  from marked
 where prev_row is null or prev_row <> row(venue, bench_venue, bench_efficiency, bench_points, mm_points, market)::text or next_tick is null;

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

-- Its own grants (show.sql's re-run revokes them): USAGE on show, the three helpers the views call (functions run as
-- the caller), SELECT on the six views.
grant usage on schema show to bazaar_live_reader;
grant execute on function show.as_int(jsonb), show.as_text(jsonb, int), show.card_in(jsonb) to bazaar_live_reader;
revoke all on show.venue_ours, show.venue_sessions, show.venue_books, show.venue_matches, show.venue_trades, show.venue_score from public;
grant select on show.venue_ours, show.venue_sessions, show.venue_books, show.venue_matches, show.venue_trades, show.venue_score to bazaar_live_reader;

commit;
