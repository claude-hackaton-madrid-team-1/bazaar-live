-- Strategy screen (bazaar-live, /strategy): what we aim for, why our agents hold the cards they hold and why they do
-- not buy the cards on sale. Read-only for bazaar_live_reader, behind GAME_VIEW_TOKEN only: these rows carry our
-- values, our guardrail caps and why our agents refused a buy, which rivals must never see. Never add them to the
-- public show views (show.thread_lines, show.duel_lines).
--
-- Five views in schema `show`, like the other show files (no table grant, no new function):
--   show.strategy_me         our latest real-world snapshot: cash, level, venue, affinity (numbers), album pages, and
--                            each card we hold (ref, set, rarity, our value, its asset id to match our own asks)
--   show.strategy_spend      the guardrail ledger now: what our buys spent in the last game hour (refunds netted)
--   show.strategy_decisions  the taker's and the maker's decisions (no duels, no dry runs): the card, its price, our
--                            value and surplus, the guardrail's text, Jev's value and verdict, and the reason cut short
--   show.strategy_asks       the single-card asks for cash open right now, on every venue (ours flagged), from the feed
--   show.strategy_cards      the catalog of released cards (public), with the last price the tape filled for each
--
-- Never selected: a decision's candidates / chosen / rag_context / state_digest whole, Jev's digest and probabilities,
-- any duel row (their limits stay on the Duels screen), the snapshot's me / score objects whole (luck_private,
-- collection_value), the writer token (`owner`), ledger.item / source.
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it and the other show
-- files, every time:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/injections.sql

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader')
     or to_regprocedure('show.as_int(jsonb)') is null or to_regprocedure('show.as_text(jsonb, int)') is null then
    raise exception 'apply db/show.sql first: it creates schema show, its helpers and the role bazaar_live_reader';
  end if;
end $$;

-- One row: the latest real-world /me snapshot (our team is the one it names). Each card is one copy: its asset id
-- only matches our own open asks (show.strategy_asks gives the asset of each ask), the page never prints it.
create or replace view show.strategy_me with (security_barrier = true) as
select s.team, s.tick, s.read_at, s.cash, s.level,
       show.as_text(s.score -> 'venue', 16) as venue,
       case when jsonb_typeof(s.me -> 'tick_seconds') = 'number' then (s.me ->> 'tick_seconds')::float8 end as tick_seconds,
       coalesce((select jsonb_object_agg(k, v)
                   from jsonb_each(case when jsonb_typeof(s.affinity) = 'object' then s.affinity else '{}'::jsonb end) as e(k, v)
                  where jsonb_typeof(v) = 'number' and k ~ '^[A-Z]{3}$'), '{}'::jsonb) as affinity,
       coalesce((select jsonb_agg(jsonb_build_object('set', show.as_text(p -> 'set', 8), 'name', show.as_text(p -> 'name', 40),
                                                     'have', show.as_int(p -> 'have'), 'of', show.as_int(p -> 'of'),
                                                     'complete', p -> 'complete' = 'true'::jsonb) order by n)
                   from jsonb_array_elements(case when jsonb_typeof(s.pages) = 'array' then s.pages else '[]'::jsonb end) with ordinality as pp(p, n)
                  where jsonb_typeof(p) = 'object'), '[]'::jsonb) as pages,
       coalesce((select jsonb_agg(jsonb_build_object('ref', show.as_text(c -> 'ref', 16), 'set', show.as_text(c -> 'set', 8),
                                                     'rarity', show.as_text(c -> 'rarity', 16), 'asset', show.as_int(c -> 'asset'),
                                                     'value', case when jsonb_typeof(c -> 'your_value') = 'number' then round((c ->> 'your_value')::numeric, 1) end) order by n)
                   from jsonb_array_elements(case when jsonb_typeof(s.cards) = 'array' then s.cards else '[]'::jsonb end) with ordinality as cc(c, n)
                  where jsonb_typeof(c) = 'object'), '[]'::jsonb) as cards
  from (select m.* from public.me_snapshots m where m.world = 'real' and m.team is not null order by m.read_at desc limit 1) s;

-- One row: the ledger now. guardrails.context_from() sums the spend rows (a refund is a negative spend) whose t_hours
-- is past now - 1.0; "now" is the last row's t_hours moved on by the ticks the snapshot has seen since, at its pace.
create or replace view show.strategy_spend with (security_barrier = true) as
with last as (
  select l.tick, l.t_hours from public.ledger l where l.t_hours is not null order by l.id desc limit 1
), me as (
  select s.tick, case when jsonb_typeof(s.me -> 'tick_seconds') = 'number' then (s.me ->> 'tick_seconds')::float8 end as tick_seconds
    from public.me_snapshots s where s.world = 'real' and s.team is not null order by s.read_at desc limit 1
), now_t as (
  select last.tick as ledger_tick,
         last.t_hours + greatest(0, coalesce(me.tick, last.tick) - last.tick) * coalesce(me.tick_seconds, 0) / 3600 as t_hours
    from last left join me on true
)
select n.ledger_tick,
       round(n.t_hours::numeric, 4) as t_hours,
       greatest(0, coalesce((select sum(l.price) from public.ledger l where l.kind = 'spend' and l.t_hours > n.t_hours - 1.0), 0))::int as spent,
       (select count(*) from public.ledger l where l.kind = 'spend' and l.price > 0 and l.t_hours > n.t_hours - 1.0)::int as buys
  from now_t n;

-- The taker's and the maker's live decisions. Only these fields of `candidates` leave the row; the guardrail's text
-- names each rule it broke with its value ("cash 81 - 79 < cash_floor 50"), which is how the page reads our caps live.
-- `reason` is the agent's own one-line why ("worth 70×1.1 + bonus share 36.4 = 113.4; ask 74 + fee 5 on rastro = 79").
create or replace view show.strategy_decisions with (security_barrier = true) as
select d.id,
       d.tick,
       d.agent,
       left(d.kind, 32) as kind,
       left(d.status, 16) as status,
       d.policy_checks -> 'allowed' = 'true'::jsonb as allowed,
       case when d.policy_checks ->> 'guardrail' like 'denied%' then left(regexp_replace(d.policy_checks ->> 'guardrail', '\s+', ' ', 'g'), 300) end as guardrail,
       left(coalesce(show.as_text(d.candidates -> 'ref'), show.as_text(d.candidates -> 'item'), show.as_text(d.candidates -> 'want_card'),
                     show.as_text(d.candidates -> 'pack')), 32) as card,
       left(show.as_text(d.candidates -> 'give_card'), 16) as give_card,
       left(show.as_text(d.candidates -> 'rarity'), 16) as rarity,
       left(coalesce(show.as_text(d.candidates -> 'venue'), show.as_text(d.candidates -> 'dealer')), 24) as venue,
       coalesce(show.as_int(d.candidates -> 'ask'), show.as_int(d.candidates -> 'price')) as price,
       show.as_int(d.candidates -> 'fee') as fee,
       show.as_int(d.candidates -> 'total') as total,
       case when jsonb_typeof(d.candidates -> 'value') = 'number' then round((d.candidates ->> 'value')::numeric, 1) end as our_value,
       case when jsonb_typeof(d.candidates -> 'surplus') = 'number' then round((d.candidates ->> 'surplus')::numeric, 1) end as surplus,
       case when jsonb_typeof(d.jev -> 'value') = 'number' then round((d.jev ->> 'value')::numeric, 2) end as jev_value,
       left(show.as_text(d.jev -> 'verdict'), 16) as jev_verdict,
       left(show.as_text(d.jev -> 'reason'), 32) as jev_reason,
       left(regexp_replace(d.reason, '\s+', ' ', 'g'), 240) as reason
  from public.decisions d
 where d.agent in ('taker', 'maker') and d.dry_run is not true and d.tick >= 0 and d.kind is distinct from 'process_started';

-- Asks open now: one card for cash, listed in the last game hour of the feed (by the tick of the newest event, and
-- received within an hour of it: the tick starts again on a new day), not expired, not cancelled, and their card not
-- settled since (a settlement does not name the offer it filled, only the asset). `ours`: our team listed it.
create or replace view show.strategy_asks with (security_barrier = true) as
with head as (
  select f.tick, f.received_at from public.feed_events f where f.tick is not null order by f.id desc limit 1
), us as (
  select m.team from public.me_snapshots m where m.world = 'real' and m.team is not null order by m.read_at desc limit 1
), listed as (
  select f.tick, f.payload -> 'offer' as o, f.payload -> 'offer' -> 'give' -> 'assets' -> 0 as a, h.tick as now_tick
    from public.feed_events f
    cross join head h
   where f.type = 'offer.listed' and f.tick between h.tick - 120 and h.tick and f.received_at > h.received_at - interval '1 hour'
), asks as (
  select show.as_int(l.o -> 'id') as offer, l.tick, show.as_int(l.o -> 'expires_tick') as expires_tick, l.now_tick,
         left(coalesce(show.as_text(l.o -> 'venue'), show.as_text(l.o -> 'maker')), 24) as venue,
         left(show.as_text(l.o -> 'maker'), 24) as maker,
         left(show.as_text(l.o -> 'to'), 24) as to_team,
         show.as_int(l.a -> 'id') as asset,
         left(show.as_text(l.a -> 'ref'), 16) as card,
         left(show.as_text(l.a -> 'rarity'), 16) as rarity,
         show.as_int(l.o -> 'want' -> 'cash') as price
    from listed l
   where jsonb_typeof(l.o -> 'give' -> 'assets') = 'array' and jsonb_array_length(l.o -> 'give' -> 'assets') = 1
     and coalesce(show.as_int(l.o -> 'give' -> 'cash'), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(l.o -> 'give' -> 'types') = 'array' then l.o -> 'give' -> 'types' end), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(l.o -> 'want' -> 'assets') = 'array' then l.o -> 'want' -> 'assets' end), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(l.o -> 'want' -> 'types') = 'array' then l.o -> 'want' -> 'types' end), 0) = 0
)
select a.offer, a.tick, a.expires_tick, a.venue, a.maker, a.to_team, a.asset, a.card, a.rarity, a.price,
       a.maker = us.team as ours
  from asks a
  left join us on true
 where a.offer is not null and a.card is not null and a.price > 0 and a.expires_tick >= a.now_tick
   and not exists (select 1 from public.feed_events c
                    where c.type = 'offer.cancelled' and c.tick >= a.tick and show.as_int(c.payload -> 'offer') = a.offer)
   and not exists (select 1 from public.feed_events s
                    where s.type = 'settlement' and s.tick >= a.tick and jsonb_typeof(s.payload -> 'items') = 'array'
                      and s.payload -> 'items' @> jsonb_build_array(jsonb_build_object('id', a.asset)));

-- The public catalog of released cards, with the last price the tape filled for each (a swap's 0 left out).
create or replace view show.strategy_cards with (security_barrier = true) as
select left(c.id, 16) as card, left(c.set_code, 8) as set_code, left(c.set_name, 40) as set_name, left(c.name, 64) as name,
       left(c.rarity, 16) as rarity, round(c.book, 1) as book, c.minted, c.print_run, c.page is true as page,
       t.price as last_fill, t.tick as last_fill_tick
  from public.cards c
  left join lateral (select x.price, x.tick from public.tape x where x.card_id = c.id and x.price > 0 order by x.settlement_id desc limit 1) t on true
 where c.released is true and c.hidden is not true;

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

-- Its own grants (show.sql's re-run revokes them): USAGE on show, the two helpers the views call (functions run as
-- the caller), SELECT on the five views.
grant usage on schema show to bazaar_live_reader;
grant execute on function show.as_int(jsonb), show.as_text(jsonb, int) to bazaar_live_reader;
revoke all on show.strategy_me, show.strategy_spend, show.strategy_decisions, show.strategy_asks, show.strategy_cards from public;
grant select on show.strategy_me, show.strategy_spend, show.strategy_decisions, show.strategy_asks, show.strategy_cards to bazaar_live_reader;

commit;
