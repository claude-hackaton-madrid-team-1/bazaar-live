-- Every team's score over the day (bazaar-live, /history, "Score, every team"): the public leaderboard as our agents
-- stored it (public.leaderboard_snapshots, one row per team per board refresh, about every 10 ticks). Only public
-- game facts: nothing here reads our snapshots, decisions, ledger or duels; the page knows which team is ours.
--
-- One view in schema `show`, like the other show files (no table grant, no new function):
--   show.team_scores  per (day, tick, team): rank, score, negotiating, market, level, complete pages, deals, when
--                     the board was read and the team's venue (the Market Test panel says where its market comes from). Kept only when one of them moved for that team since its last read of the
--                     day, plus each team's first and latest read of the day: the page draws steps (a value holds
--                     until the next reading), so a dropped row loses nothing.
--
-- What the board's numbers are (vendor/bazaar-kit/RULES.md "Scoring", docs/api/openapi.json ScoreRow, bazaar repo):
--  * score = negotiating + market, in points, every team normalised the same way at the same tick (the judges' 40 are
--    not on the board). For our own team the board's three equal /me's `score`, `negotiating` and `market` at every
--    tick, so the board compares like with like.
--  * /me's `neg_points`, `mm_points`, `duel_points`, `ladder_points` and `bench_points` are another thing: our private
--    raw breakdown, in their own units (neg_points is the value we gained in trades, in P, at our private values). The
--    board hides them for every team, so they are never set beside a rival's number.
--  * pages (complete album pages), deals (settled deals) and level score nothing by themselves: context only.
--
-- A day is the Madrid date of the read (the game's tick may start again on a new day), as in db/history.sql.
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it and the other show
-- files, every time:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/teams_score.sql -f db/injections.sql

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    raise exception 'apply db/show.sql first: it creates schema show and the role bazaar_live_reader';
  end if;
end $$;

create or replace view show.team_scores with (security_barrier = true) as
with reads as (
  select (s.read_at at time zone 'Europe/Madrid')::date as day, s.tick, s.team, s.rank,
         round(s.score, 3) as score, round(s.negotiating, 3) as negotiating, round(s.market, 3) as market,
         s.level, s.pages, s.deals, s.read_at, left(s.venue, 24) as venue
    from public.leaderboard_snapshots s
   where s.world = 'real' and s.team ~ '^t[0-9]{1,3}$' and s.tick is not null and s.rank is not null and s.score is not null
), marked as (
  select r.*,
         row(r.rank, r.score, r.negotiating, r.market, r.level, r.pages, r.deals)::text as now_row,
         lag(row(r.rank, r.score, r.negotiating, r.market, r.level, r.pages, r.deals)::text) over w as prev_row,
         lead(r.tick) over w as next_tick
    from reads r
  window w as (partition by r.team, r.day order by r.tick)
)
-- venue is not compared: a read kept for a move carries the venue of that read. New columns go last (`create or
-- replace view` only appends).
select day, tick, team, rank, score, negotiating, market, level, pages, deals, read_at, venue
  from marked
 where prev_row is null or prev_row <> now_row or next_tick is null;

-- Its own grants (show.sql's re-run revokes them): USAGE on show, SELECT on the view.
grant usage on schema show to bazaar_live_reader;
revoke all on show.team_scores from public;
grant select on show.team_scores to bazaar_live_reader;

commit;
