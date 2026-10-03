-- Rivals screen (bazaar-live, /rivals), its private part: every other team as our agents' rival board sees it (rank,
-- score and their trend, where each team beats or trails us, the cards it wants and offers against our spares and our
-- missing page cards, and the move we would make with it). Unlike db/rival_albums.sql (public game facts only), these
-- rows carry our spare copies, the cards we miss, our values and our moves, which rivals must never see: read-only for
-- bazaar_live_reader, behind GAME_VIEW_TOKEN only. Never add them to the public show views (show.thread_lines,
-- show.duel_lines).
--
-- One view in schema `show`, like the other show files (no table grant, no new function):
--   show.rival_board   the agents' public.rival_board (bazaar sql/schema.sql, created by init_schema: one row per OTHER
--                      team), its contract columns only, by name and in order (shared/rivalBoard.ts is the wire type,
--                      server/rivals/boardRows.ts checks every field). No order: the reader sorts (best rank first).
--
-- Never selected: any column of the board outside the contract (a new one stays private until it is added here).
--
-- How it depends on the agents' view:
--   * public.rival_board runs with its owner's rights here, but any user-defined FUNCTION it called would run as the caller,
--     bazaar_live_reader, which holds no table grant: a function that reads a table there makes this view fail
--     (42501, the screen says "not applied"). Keep the board plain SQL (CTEs, lateral joins).
--   * The agents replace their view only with a newer version (its comment), with the same columns (new ones at the
--     end); a change this view blocks leaves theirs as it was (a warning in their log, never a failed start). A plain
--     `drop view rival_board` fails while this view exists; `drop ... cascade` drops this view too: re-run this file
--     after (the screen says "not applied" meanwhile).
--
-- db/show.sql revokes everything in schema show from the reader, so apply this file after it and the other show
-- files, every time:
--   psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/rival_board.sql

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader')
     or to_regprocedure('show.as_int(jsonb)') is null or to_regprocedure('show.as_text(jsonb, int)') is null then
    raise exception 'apply db/show.sql first: it creates schema show, its helpers and the role bazaar_live_reader';
  end if;
end $$;

do $$
begin
  if to_regclass('public.rival_board') is null then
    raise exception 'the agents'' schema has no rival_board yet: deploy bazaar #224 (init_schema creates it), then re-run this file';
  end if;
end $$;

-- Dropped and created again rather than replaced: `create or replace` cannot drop, rename or reorder a column when
-- the contract changes. Nothing depends on this view, and its grants follow in the same transaction.
drop view if exists show.rival_board;
create view show.rival_board with (security_barrier = true) as
select b.team, b.tick, b.rank, b.score, b.negotiating, b.market, b.level, b.pages, b.deals, b.venue,
       b.rank_change, b.score_change, b.trend_ticks, b.trend,
       b.our_team, b.our_rank, b.our_score, b.our_negotiating, b.our_market, b.our_pages,
       b.dealer_deals, b.venue_trades, b.top_set, b.set_interest, b.strengths, b.weaknesses,
       b.they_want, b.they_have, b.we_have_for_them, b.they_have_for_us, b.match_count,
       b.guarded, b.guard_reason,
       b.move_kind, b.move_give, b.move_get, b.move_price, b.our_gain, b.their_gain, b.suggested_move,
       b.why_climbed, b.why_climbed_tick
  from public.rival_board b;

-- Its own grants (show.sql's re-run revokes them): USAGE on show and SELECT on the view. It calls no function.
grant usage on schema show to bazaar_live_reader;
revoke all on show.rival_board from public;
grant select on show.rival_board to bazaar_live_reader;

commit;
