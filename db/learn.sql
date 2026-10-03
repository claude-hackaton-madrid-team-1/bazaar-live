-- Bazaar Live: what the Learn screen (/learn) may read of our agents' memory.
--
-- Applied by the coordinator with the ADMIN url, AFTER db/show.sql (a re-run of show.sql revokes every grant in
-- schema show, so run both, in this order, every time):
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql
--
-- Idempotent. Four views over the tables bazaar's sql/schema.sql declares, granted to bazaar_live_reader:
--   * show.learnings      the facts and lessons still on the books (not superseded)
--   * show.trader_moves   every dealer move the behaviour reader stored (open, concede, hold, final, deal, ...)
--   * show.dealer_stats   per dealer, from the dealer curves: threads, deals, opening ask, fill, steps (all teams, and ours)
--   * show.rival_profiles per rival team: level, venue, pack price, what they buy and sell
-- The views run with their OWNER's rights: the role holds no grant on the tables. Never selected: embeddings,
-- dedupe keys, evidence ids (only their count), venue_broker_keys, decisions' reasons. `stats` (a learning's
-- detail: item, rarity, a learned ladder) is kept, capped at 2 kB: the page that shows it needs GAME_VIEW_TOKEN.

begin;
set local lock_timeout = '15s';

create schema if not exists show;

create or replace view show.learnings with (security_barrier = true) as
select l.id,
       l.scope,
       l.subject_kind,
       l.subject,
       l.kind,
       left(l.claim, 300) as claim,
       l.source,
       l.confidence::float8 as confidence,
       coalesce(l.support_n, cardinality(l.evidence), 0) as support,
       l.created_tick,
       l.until_tick,
       l.team,
       case when jsonb_typeof(l.stats) = 'object' and octet_length(l.stats::text) <= 2000 then l.stats end as stats,
       l.updated_at
  from public.learnings l
 where l.superseded_by is null;

create or replace view show.trader_moves with (security_barrier = true) as
select b.id,
       b.trader_id as trader,
       b.thread_id as thread,
       b.tick,
       b.event,
       b.our_price,
       b.their_price,
       b.step,
       b.final,
       b.source
  from public.trader_behaviors b;

create or replace view show.dealer_stats with (security_barrier = true) as
select c.dealer,
       count(*)::int as threads,
       count(*) filter (where c.fill_price is not null)::int as deals,
       count(*) filter (where c.ours)::int as our_threads,
       count(*) filter (where c.ours and c.fill_price is not null)::int as our_deals,
       round(avg(c.opening_ask), 1)::float8 as avg_open,
       round(avg(c.fill_price), 1)::float8 as avg_fill,
       -- what a deal cost against the dealer's opening ask: 1 = paid the opening, lower = she moved
       round(avg(c.fill_price::numeric / nullif(c.opening_ask, 0)) filter (where c.fill_price is not null), 3)::float8 as fill_ratio,
       round(avg(c.fill_price::numeric / nullif(c.opening_ask, 0)) filter (where c.fill_price is not null and c.ours), 3)::float8 as our_fill_ratio,
       round(avg(c.steps), 1)::float8 as avg_steps,
       round(avg(c.ticks), 1)::float8 as avg_ticks,
       max(c.thread_id) as last_thread
  from public.dealer_curves c
 where c.dealer is not null
 group by c.dealer;

create or replace view show.rival_profiles with (security_barrier = true) as
select p.team,
       p.updated_tick,
       p.level,
       p.venue,
       p.avg_pack_price::float8 as avg_pack_price,
       p.dealer_deal_rate::float8 as dealer_deal_rate,
       case when jsonb_typeof(p.set_interest) = 'object' and octet_length(p.set_interest::text) <= 1000 then p.set_interest end as set_interest,
       case when jsonb_typeof(p.fills) = 'object' and octet_length(p.fills::text) <= 1000 then p.fills end as fills,
       p.notes -> 'top_set' as top_set
  from public.competitor_profiles p;

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
end $$;

grant usage on schema show to bazaar_live_reader;
grant select on show.learnings, show.trader_moves, show.dealer_stats, show.rival_profiles to bazaar_live_reader;

commit;
