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
--   * show.game_feed      the game feed as the agents received it (public events; one world: the real game)
--   * show.game_me        our team's /me snapshots in the real world, projected to what the screens read
--   * show.game_duels     our duels: the outcome and, per message, only from/tick/price/days
--   * show.game_threads   our dealer threads
--   * show.game_messages  the messages of our threads (no embedding, no tactic)
--   * show.game_tape      the settlement tape (public)
-- The views run with their OWNER's rights, so the role holds no grant on the tables. Never selected:
-- collection_value, any key, an affinity that is not a number, badges, open threads; a duel's your_limit, your_offer, result
-- (our gain), limit_meaning, your_days_weight and its words.

begin;
set local lock_timeout = '15s';

-- The feed: ids are one sequence for the whole game (they do not reset by day), and the table holds one
-- world only (me_snapshots.world is always 'real'), so every row is kept. The id fits an int (the page
-- drops an event whose id is not a number, and pg hands a bigint over as text).
create or replace view show.game_feed with (security_barrier = true) as
select e.id::int as id, e.tick, e.type, e.actor, e.payload
  from public.feed_events e;

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

-- Our duels, live ones included (the API relay shows them too, behind the same token). Like show.duel_lines,
-- nothing private leaves the payload: per message only these four keys, never the words.
create or replace view show.game_duels with (security_barrier = true) as
select d.duel, d.session, d.tick, d.status, d.role, d.item, d.rival, d.deadline_tick, d.price, d.days, d.updated_at,
       coalesce((select jsonb_agg(jsonb_build_object('from', show.as_text(m.msg -> 'from', 40), 'tick', show.as_int(m.msg -> 'tick'),
                                                     'price', show.as_int(m.msg -> 'price'), 'days', show.as_int(m.msg -> 'days')) order by m.n)
                   from jsonb_array_elements(case when jsonb_typeof(d.payload -> 'messages') = 'array' then d.payload -> 'messages' else '[]'::jsonb end)
                        with ordinality as m(msg, n)
                  where jsonb_typeof(m.msg) = 'object'), '[]'::jsonb) as messages
  from public.duels d;

create or replace view show.game_threads with (security_barrier = true) as
select t.id::int as id, t.counterpart, t.kind, t.topic, t.venue, t.status, t.opened_tick, t.closed_tick, t.closed_reason, t.updated_tick, t.until_tick
  from public.threads t
 where t.ours;

create or replace view show.game_messages with (security_barrier = true) as
select m.id::int as id, m.thread_id::int as thread_id, m.sender, m.tick, m.text, m.price, m.offer, m.final, m.ours
  from public.messages m
 where exists (select 1 from public.threads t where t.id = m.thread_id and t.ours);

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
