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
-- Idempotent. Six views, read by server/game/dbsource.ts behind GAME_VIEW_TOKEN (the same gate as the
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
                    'bench_points', s.me -> 'score' -> 'bench_points') end,
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

create or replace view show.game_tape with (security_barrier = true) as
select t.settlement_id::int as settlement_id, t.tick, t.venue, t.persona, t.buyer, t.seller, t.items, t.card_id, t.price, t.fee
  from public.tape t;

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

-- Its own grants (show.sql's re-run revokes them): USAGE on show, the helpers the views call, SELECT on six views.
grant usage on schema show to bazaar_live_reader;
grant execute on function show.as_int(jsonb), show.as_text(jsonb, int) to bazaar_live_reader;
grant select on show.game_feed, show.game_me, show.game_duels, show.game_threads, show.game_messages, show.game_tape to bazaar_live_reader;

commit;
