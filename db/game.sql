-- Bazaar Live: what the game screens (/agent, /negotiations, /album, /market, /debug) read of our own
-- database, where the agents record the game as they play it, instead of the game's public API.
--
-- Applied by the coordinator with the ADMIN url, AFTER db/show.sql and db/learn.sql:
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/learn.sql
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/game.sql
-- show.sql starts by revoking everything in schema show from bazaar_live_reader: a later re-run of it
-- drops these grants too, so re-run this file after it, every time.
--
-- Idempotent. Seven views, read by server/game/dbsource.ts behind GAME_VIEW_TOKEN (the same gate as the
-- relay of the game's API, which carries the same data):
--   * show.game_feed      the game feed as the agents received it (public events; one world: the real game),
--                         plus, on our own thread.message rows, the words we sent and their tactic
--   * show.game_me        our team's /me snapshots in the real world, projected to what the screens read
--   * show.game_duels     our duels: the outcome, our limit, the rounds, the decay per round and our gain (the
--                         Duels screen asks whether their price is inside our limit), and per message only
--                         from/tick/price/days; never in show.duel_lines, which feeds the public show
--   * show.game_threads   our dealer threads
--   * show.game_messages  the messages of our threads, with the tactic of each of ours (no embedding)
--   * show.game_tape      the settlement tape (public)
--   * show.game_our_offers every board offer of ours with what became of it (open, settled, cancelled, expired) and
--                         whether it was posted by hand (a 'hands-off:<offer>' row in the ledger); db/history.sql reads it
-- The views run with their OWNER's rights, so the role holds no grant on the tables. Never selected:
-- collection_value, any key, an affinity that is not a number, badges, open threads; a duel's your_offer, limit_meaning,
-- your_days_weight and its words; of a decision, anything but its tactic's id (no tactic_why,
-- rag_context, jev, candidates or chosen).

begin;
set local lock_timeout = '15s';

-- Our /me, field by field: the allow-list of server/game/me.ts (which trims the result again, by the same names).
create or replace view show.game_me with (security_barrier = true) as
select s.tick,
       s.read_at,
       case when jsonb_typeof(s.me -> 'tick_seconds') = 'number' then (s.me ->> 'tick_seconds')::float8 end as tick_seconds,
       jsonb_build_object(
         'id', s.me -> 'id',
         'name', s.me -> 'name',
         'cash', s.me -> 'cash',
         -- set -> multiplier, numbers only: the album values cards of sets we hold nothing of (behind GAME_VIEW_TOKEN)
         'affinity', coalesce((
                    select jsonb_object_agg(k, v)
                      from jsonb_each(case when jsonb_typeof(s.me -> 'affinity') = 'object' then s.me -> 'affinity' else '{}'::jsonb end) as e(k, v)
                     where jsonb_typeof(v) = 'number'), '{}'::jsonb),
         'score', case when jsonb_typeof(s.me -> 'score') = 'object' then jsonb_build_object(
                    'score', s.me -> 'score' -> 'score', 'rank', s.me -> 'score' -> 'rank', 'deals', s.me -> 'score' -> 'deals',
                    'duel_points', s.me -> 'score' -> 'duel_points', 'ladder_points', s.me -> 'score' -> 'ladder_points',
                    'neg_points', s.me -> 'score' -> 'neg_points', 'mm_points', s.me -> 'score' -> 'mm_points',
                    'bench_points', s.me -> 'score' -> 'bench_points',
                    -- the Market Test panel (/history): the board's market part, and our bench run's efficiency and venue
                    'market', s.me -> 'score' -> 'market', 'bench_efficiency', s.me -> 'score' -> 'bench_efficiency',
                    'bench_venue', s.me -> 'score' -> 'bench_venue') end,
         'album', jsonb_build_object('pages', coalesce((
                    select jsonb_agg(jsonb_build_object('set', p -> 'set', 'name', p -> 'name', 'have', p -> 'have', 'of', p -> 'of',
                                                        'complete', p -> 'complete', 'master', p -> 'master') order by n)
                      from jsonb_array_elements(case when jsonb_typeof(s.me -> 'album' -> 'pages') = 'array' then s.me -> 'album' -> 'pages' else '[]'::jsonb end)
                           with ordinality as pp(p, n)
                     where jsonb_typeof(p) = 'object'), '[]'::jsonb)),
         'assets', coalesce((
                    select jsonb_agg(jsonb_build_object('id', a -> 'id', 'kind', a -> 'kind', 'ref', a -> 'ref', 'serial', a -> 'serial',
                                                        'your_value', a -> 'your_value') order by n)
                      from jsonb_array_elements(case when jsonb_typeof(s.me -> 'assets') = 'array' then s.me -> 'assets' else '[]'::jsonb end)
                           with ordinality as aa(a, n)
                     where jsonb_typeof(a) = 'object'), '[]'::jsonb)
       ) as me
  from public.me_snapshots s
 where s.world = 'real' and s.team = 't01';

-- Our duels, live ones included (the API relay shows them too, behind the same token). Our limit and the result
-- (what the deal kept for us: the surplus against our limit after the decay of its rounds) leave here, behind
-- GAME_VIEW_TOKEN only, for the Duels screen: is their price inside our limit, what did each deal make. Never add
-- them to show.duel_lines (the public show). Per message only these four keys, never the words; never your_offer,
-- limit_meaning or your_days_weight. New columns go last: `create or replace view` only appends.
create or replace view show.game_duels with (security_barrier = true) as
select d.duel, d.session, d.tick, d.status, d.role, d.item, d.rival, d.deadline_tick, d.price, d.days, d.updated_at,
       coalesce((select jsonb_agg(jsonb_build_object('from', show.as_text(m.msg -> 'from', 40), 'tick', show.as_int(m.msg -> 'tick'),
                                                     'price', show.as_int(m.msg -> 'price'), 'days', show.as_int(m.msg -> 'days')) order by m.n)
                   from jsonb_array_elements(case when jsonb_typeof(d.payload -> 'messages') = 'array' then d.payload -> 'messages' else '[]'::jsonb end)
                        with ordinality as m(msg, n)
                  where jsonb_typeof(m.msg) = 'object'), '[]'::jsonb) as messages,
       d.your_limit, d.rounds, d.decay_per_round::float8 as decay_per_round, d.result::float8 as result
  from public.duels d;

create or replace view show.game_threads with (security_barrier = true) as
select t.id::int as id, t.counterpart, t.kind, t.topic, t.venue, t.status, t.opened_tick, t.closed_tick, t.closed_reason, t.updated_tick, t.until_tick
  from public.threads t
 where t.ours;

-- Our messages, each with the tactic our agent picked for its words (the user's own strategy label, so it shows behind
-- GAME_VIEW_TOKEN): messages.tactic when the agents filled it, else the `tactic` of the decision that sent it (same
-- thread, tick and price). Only that one word, checked to be an id, leaves the decision: never its reasons
-- (tactic_why), rag_context, jev, the other candidates or the rest of `chosen`. 'none' (no tactic) is null; 'plain'
-- (the control arm: our usual words) stays.
create or replace view show.game_messages with (security_barrier = true) as
select m.id::int as id, m.thread_id::int as thread_id, m.sender, m.tick, m.text, m.price, m.offer, m.final, m.ours,
       case when m.ours then coalesce(
         case when m.tactic ~ '^[a-z_]{1,40}$' and m.tactic <> 'none' then m.tactic end,
         (select d.candidates ->> 'tactic'
            from public.decisions d
           where d.thread_id = m.thread_id and d.tick = m.tick and d.dry_run is not true
             and d.candidates ->> 'tactic' ~ '^[a-z_]{1,40}$' and d.candidates ->> 'tactic' <> 'none'
             and show.as_int(d.chosen -> 'price') = m.price
           order by d.id desc limit 1)) end as tactic
  from public.messages m
 where exists (select 1 from public.threads t where t.id = m.thread_id and t.ours);

-- The feed: ids are one sequence for the whole game (they do not reset by day), and the table holds one
-- world only (me_snapshots.world is always 'real'), so every row is kept. The id fits an int (the page
-- drops an event whose id is not a number, and pg hands a bigint over as text). The game's feed never
-- carries a team's words (`text` is null on every team's thread.message): on OUR thread.message rows the
-- view adds what we said and its tactic, from show.game_messages; every other row is the feed unchanged.
create or replace view show.game_feed with (security_barrier = true) as
select e.id::int as id, e.tick, e.type, e.actor,
       case when m.id is null then e.payload
            else e.payload || jsonb_strip_nulls(jsonb_build_object('text', coalesce(e.payload ->> 'text', m.text), 'tactic', m.tactic)) end as payload
  from public.feed_events e
  left join show.game_messages m
    on e.type = 'thread.message' and jsonb_typeof(e.payload) = 'object' and m.ours and m.id = show.as_int(e.payload -> 'message');

-- Every board offer of ours (the feed's offer.listed with our team as the maker, whoever posted it: an agent or a
-- person with `bazaar sell ... --live`) and what became of it, so the screens rebuild our open offers however far back
-- they were listed (the feed replay of server/game/dbsource.ts is only the newest rows). The listing row leaves
-- unchanged (it is in show.game_feed already), with:
--   status  'settled' (a settlement after it moved the copy it gives, or, for a bid, brought us its card on its venue
--           at its price before it expired: settlements name no offer), 'cancelled' (offer.cancelled, or its venue
--           closing: that cancels every offer with no offer.cancelled each), 'expired' (its expires_tick is behind the
--           feed's newest tick) or 'open'; whichever came first
--   hand    a 'hands-off:<offer>' listing in the shared ledger: posted by hand, no agent manages it
-- Our team is the one in the real world's latest /me snapshot. New columns go last.
create or replace view show.game_our_offers with (security_barrier = true) as
with us as (
  select team from public.me_snapshots where world = 'real' and team is not null order by read_at desc limit 1
), listed as materialized (
  select e.id, e.tick, e.type, e.actor, e.payload, e.payload -> 'offer' as o, us.team,
         show.as_int(e.payload -> 'offer' -> 'id') as offer,
         coalesce(show.as_text(e.payload -> 'venue', 32), show.as_text(e.payload -> 'offer' -> 'venue', 32)) as venue,
         show.as_int(e.payload -> 'offer' -> 'expires_tick') as expires_tick,
         nullif(show.as_int(e.payload -> 'offer' -> 'want' -> 'cash'), 0) as wants,
         nullif(show.as_int(e.payload -> 'offer' -> 'give' -> 'cash'), 0) as gives
    from public.feed_events e
    cross join us
   where e.type = 'offer.listed' and jsonb_typeof(e.payload -> 'offer') = 'object' and e.payload -> 'offer' ->> 'maker' = us.team
), shaped as materialized (
  select l.id, l.tick, l.type, l.actor, l.payload, l.o, l.team, l.offer, l.venue, l.expires_tick,
         case when l.wants is not null then 'ask' when l.gives is not null then 'bid' else 'swap' end as side,
         coalesce(l.wants, l.gives) as price,
         case when l.wants is null and l.gives is not null
              then coalesce(show.card_in(l.o -> 'want' -> 'types'), show.as_text(l.o -> 'want' -> 'assets' -> 0 -> 'ref', 16))
              else coalesce(show.as_text(l.o -> 'give' -> 'assets' -> 0 -> 'ref', 16), show.card_in(l.o -> 'give' -> 'types')) end as card,
         array(select show.as_int(a -> 'id')
                 from jsonb_array_elements(case when jsonb_typeof(l.o -> 'give' -> 'assets') = 'array' then l.o -> 'give' -> 'assets' else '[]'::jsonb end) a) as gives_assets
    from listed l
   where l.offer is not null
), cancels as materialized (
  select show.as_int(c.payload -> 'offer') as offer, c.id
    from public.feed_events c
   where c.type = 'offer.cancelled'
), closings as materialized (
  select show.as_text(c.payload -> 'venue', 32) as venue, c.id
    from public.feed_events c
   where c.type in ('venue.closing', 'venue.closed')
), fills as materialized (
  select x.id, x.tick, show.as_text(x.payload -> 'venue', 32) as venue, show.as_int(x.payload -> 'price') as price,
         it ->> 'frm' as frm, it ->> 'to' as buyer, it ->> 'ref' as ref, show.as_int(it -> 'id') as asset
    from public.feed_events x
    cross join us
    cross join lateral jsonb_array_elements(case when jsonb_typeof(x.payload -> 'items') = 'array' then x.payload -> 'items' else '[]'::jsonb end) it
   where x.type = 'settlement' and jsonb_typeof(it) = 'object' and (it ->> 'frm' = us.team or it ->> 'to' = us.team)
), ended as materialized (
  select s.*,
         (select min(k.id) from cancels k where k.offer = s.offer and k.id > s.id) as cancel_id,
         (select min(v.id) from closings v where v.venue = s.venue and v.id > s.id) as close_id,
         (select min(f.id) from fills f
           where f.id > s.id and (s.expires_tick is null or f.tick is null or f.tick <= s.expires_tick)
             and ((s.side = 'bid' and f.buyer = s.team and f.venue = s.venue and f.ref = s.card and f.price = s.price)
               or (s.side <> 'bid' and f.frm = s.team and f.asset = any (s.gives_assets)))) as fill_id
    from shaped s
)
select d.id::int as id, d.tick, d.type, d.actor, d.payload, d.offer, d.side, d.card, d.venue, d.price, d.expires_tick,
       case when d.fill_id is not null and d.fill_id <= least(d.cancel_id, d.close_id) is not false then 'settled'
            when coalesce(d.cancel_id, d.close_id) is not null then 'cancelled'
            when d.expires_tick < (select max(f.tick) from public.feed_events f) then 'expired'
            else 'open' end as status,
       exists (select 1 from public.ledger l where l.kind = 'listing' and l.item = 'hands-off:' || d.offer) as hand
  from ended d;


create or replace view show.game_tape with (security_barrier = true) as
select t.settlement_id::int as settlement_id, t.tick, t.venue, t.persona, t.buyer, t.seller, t.items, t.card_id, t.price, t.fee
  from public.tape t;

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

-- Its own grants (show.sql's re-run revokes them): USAGE on show, the helpers the views call, SELECT on seven views.
grant usage on schema show to bazaar_live_reader;
grant execute on function show.as_int(jsonb), show.as_text(jsonb, int), show.card_in(jsonb) to bazaar_live_reader;
grant select on show.game_feed, show.game_me, show.game_duels, show.game_threads, show.game_messages, show.game_tape, show.game_our_offers to bazaar_live_reader;

commit;
