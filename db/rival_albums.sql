-- Rivals screen (bazaar-live, /rivals): what each rival holds, as far as the public feed shows it, where they rank, and
-- what they chase. Only public game facts: the feed every team reads, the public leaderboard and our profile of each
-- rival read from that feed. Nothing here reads our snapshots, our decisions, our ledger or our duels, so no value of
-- ours (your_value, limits, caps) can reach these rows; the page works out what we lack from its own game stream.
--
-- Four views in schema `show`, like the other show files (no table grant, no new function):
--   show.rival_holdings  per holder (a team, or a dealer) and card: the copies we last saw it hold, how we know
--                        (bought, pack, gift, crafted, listed), since which tick and when we last saw it
--   show.rival_teams     per team: its latest leaderboard read (rank, score, level, complete pages, deals) and the set
--                        interest our monitor reads off its public moves (numbers only)
--   show.rival_wants     per team and card: how often it bid for the card on a board or asked a dealer for it, the last
--                        tick and its best cash bid
--   show.rival_head      one row: the newest feed tick, the clock the page says "X min ago" by
--
-- How a holding is known. The feed never shows an album, only moves; the game's /api/cards/{id} hides other teams.
--  * A copy with an asset id is followed through every public event that names it, in feed order (ids, never ticks or
--    times: the first day's backfill shares one received_at): a settlement item moves it to `to`; a pack's `best`
--    (rare or better only) puts it with the team that opened the pack; a board listing (`give.assets`) shows it with
--    the maker at that moment. Its holder is the last one named; `how` and `since_tick` are the first event of that
--    holder's latest run, `seen_tick` the last one. `world` and `opened` hold nothing.
--  * A gift (`gift.given.cards`) and a craft (`taller.crafted.card`, a card name read through the catalog) name a card
--    but no copy: they count one copy until the same team lists that card or a settlement takes one from it (then the
--    asset-level trail already speaks for it). Approximate: a team that holds two and sells one loses the gift's too,
--    and the three commons a craft consumes are not named, so they stay where we last saw them.
--  * Starter cards and every pack card below rare never appear: a missing card is unknown, never "not held".
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it and the other show
-- files, every time:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/injections.sql

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader')
     or to_regprocedure('show.as_int(jsonb)') is null or to_regprocedure('show.as_text(jsonb, int)') is null
     or to_regprocedure('show.card_in(jsonb)') is null then
    raise exception 'apply db/show.sql first: it creates schema show, its helpers and the role bazaar_live_reader';
  end if;
end $$;

create or replace view show.rival_holdings with (security_barrier = true) as
with moves as (
  -- every public event that names a copy by its asset id, with who has it afterwards
  select f.id, f.tick, show.as_int(x -> 'id') as asset, show.as_text(x -> 'ref', 16) as card,
         show.as_text(x -> 'to', 24) as holder, show.as_text(x -> 'frm', 24) as frm, 'bought' as how
    from public.feed_events f
    cross join lateral jsonb_array_elements(case when jsonb_typeof(f.payload -> 'items') = 'array' then f.payload -> 'items' else '[]'::jsonb end) x
   where f.type = 'settlement'
  union all
  select f.id, f.tick, show.as_int(f.payload -> 'best' -> 'id'), show.as_text(f.payload -> 'best' -> 'ref', 16),
         show.as_text(f.payload -> 'team', 24), null, 'pack'
    from public.feed_events f
   where f.type = 'pack.opened' and jsonb_typeof(f.payload -> 'best') = 'object'
  union all
  select f.id, f.tick, show.as_int(a -> 'id'), show.as_text(a -> 'ref', 16),
         show.as_text(f.payload -> 'offer' -> 'maker', 24), null, 'listed'
    from public.feed_events f
    cross join lateral jsonb_array_elements(case when jsonb_typeof(f.payload -> 'offer' -> 'give' -> 'assets') = 'array'
                                                 then f.payload -> 'offer' -> 'give' -> 'assets' else '[]'::jsonb end) a
   where f.type = 'offer.listed'
), trail as (
  select m.*, sum(m.changed) over (partition by m.asset order by m.id) as run
    from (select m.*, case when m.holder is distinct from lag(m.holder) over (partition by m.asset order by m.id) then 1 else 0 end as changed
            from moves m
           where m.asset is not null and m.card ~ '^[A-Z]{3}-[0-9]{1,3}$') m
), copies as (
  -- each copy's latest run with one holder
  select distinct on (t.asset) t.asset, t.card, t.holder,
         first_value(t.how) over w as how, first_value(t.id) over w as since_id,
         min(t.tick) over w as since_tick, max(t.tick) over w as seen_tick
    from trail t
  window w as (partition by t.asset, t.run order by t.id rows between unbounded preceding and unbounded following)
   order by t.asset, t.run desc, t.id desc
), named as (
  -- a gift or a craft: a card, no copy
  select f.id, f.tick, show.as_text(f.payload -> 'team', 24) as holder, r as card, 'gift' as how
    from public.feed_events f
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(f.payload -> 'cards') = 'array' then f.payload -> 'cards' else '[]'::jsonb end) r
   where f.type = 'gift.given'
  union all
  select f.id, f.tick, show.as_text(f.payload -> 'team', 24), c.id, 'crafted'
    from public.feed_events f
    join public.cards c on c.name = f.payload ->> 'card'
   where f.type = 'taller.crafted'
), loose as (
  select n.* from named n
   where n.holder is not null and n.card ~ '^[A-Z]{3}-[0-9]{1,3}$'
     and not exists (select 1 from moves m
                      where m.id > n.id and m.card = n.card and ((m.how = 'listed' and m.holder = n.holder) or m.frm = n.holder))
), held as (
  select c.holder, c.card, c.how, c.since_id, c.since_tick, c.seen_tick from copies c
  union all
  select l.holder, l.card, l.how, l.id, l.tick, l.tick from loose l
)
select left(h.holder, 24) as holder,
       left(h.card, 16) as card,
       left(coalesce(k.set_code, split_part(h.card, '-', 1)), 8) as set_code,
       left(k.rarity, 16) as rarity,
       left(k.name, 64) as name,
       count(*)::int as copies,
       (array_agg(h.how order by h.since_id))[1] as how,
       min(h.since_tick) as since_tick,
       max(h.seen_tick) as seen_tick
  from held h
  left join public.cards k on k.id = h.card and k.hidden is not true
 where h.holder is not null and h.holder not in ('world', 'opened')
 group by h.holder, h.card, k.set_code, k.rarity, k.name;

-- Each team's latest real-world leaderboard read (reads differ by team: one may be older), and the set interest our
-- monitor counts off its public moves (+1 a buy, a bid or a dealer ask in a set, -1 a sale or a listing): numbers only.
create or replace view show.rival_teams with (security_barrier = true) as
select l.team, l.rank, round(l.score, 2) as score, l.level, l.pages, l.deals, l.tick, l.read_at,
       coalesce((select jsonb_object_agg(k, v)
                   from public.competitor_profiles p
                  cross join lateral jsonb_each(case when jsonb_typeof(p.set_interest) = 'object' then p.set_interest else '{}'::jsonb end) as e(k, v)
                  where p.team = l.team and jsonb_typeof(v) = 'number' and k ~ '^[A-Z]{3}$'), '{}'::jsonb) as set_interest
  from (select distinct on (s.team) s.* from public.leaderboard_snapshots s
         where s.world = 'real' and s.team ~ '^t[0-9]{1,3}$'
         order by s.team, s.read_at desc) l;

-- What each team chases: a board bid for a card (`want.types` card:X, with the cash it offers) and a dealer thread
-- opened to buy one.
create or replace view show.rival_wants with (security_barrier = true) as
with wants as (
  select f.tick, show.as_text(f.payload -> 'offer' -> 'maker', 24) as team, show.card_in(f.payload -> 'offer' -> 'want' -> 'types') as card,
         'bid' as via, nullif(show.as_int(f.payload -> 'offer' -> 'give' -> 'cash'), 0) as price
    from public.feed_events f
   where f.type = 'offer.listed'
  union all
  select f.tick, show.as_text(f.payload -> 'team', 24), show.as_text(f.payload -> 'topic' -> 'buy' -> 'card', 16), 'dealer', null
    from public.feed_events f
   where f.type = 'thread.opened'
)
select w.team, w.card, w.via, count(*)::int as times, max(w.tick) as last_tick, max(w.price) as top_bid
  from wants w
 where w.team ~ '^t[0-9]{1,3}$' and w.card ~ '^[A-Z]{3}-[0-9]{1,3}$'
 group by w.team, w.card, w.via;

-- One row: the newest feed tick.
create or replace view show.rival_head with (security_barrier = true) as
select f.tick, f.received_at from public.feed_events f where f.tick is not null order by f.id desc limit 1;

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

-- Its own grants (show.sql's re-run revokes them): USAGE on show, the three helpers the views call (functions run as
-- the caller), SELECT on the four views.
grant usage on schema show to bazaar_live_reader;
grant execute on function show.as_int(jsonb), show.as_text(jsonb, int), show.card_in(jsonb) to bazaar_live_reader;
revoke all on show.rival_holdings, show.rival_teams, show.rival_wants, show.rival_head from public;
grant select on show.rival_holdings, show.rival_teams, show.rival_wants, show.rival_head to bazaar_live_reader;

commit;
