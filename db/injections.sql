-- Bazaar Live: the prompt-injection attempts our agents recorded (bazaar sql/schema.sql, `injection_attempts`), for
-- the "Injection attempts" panel on the show, /debug and /injections.
--
-- Applied by the coordinator with the ADMIN url, AFTER db/show.sql (and the other show files), each time:
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql \
--          -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/injections.sql
-- show.sql starts by revoking everything in schema show from bazaar_live_reader: a re-run of it drops this grant
-- too, so re-run this file after it, every time.
--
-- Idempotent. Two security_barrier views, SELECT for bazaar_live_reader, no table grant. They feed a PUBLIC route
-- (the show carries no token), so they publish only:
--   * the REAL world's rows (never a simulator's);
--   * a duel's row (source 'duel', or any row naming a duel) only by show.duel_lines' own rule: once an admin opens
--     show.gate after the last session, for a CLOSED duel with no live sibling (same session or item) still within its
--     deadline. Our answer in a duel can carry a price, and a price reveals our limit while rivals still play. A row
--     whose duel is not in public.duels stays hidden;
--   * our_response as a verb from a closed list, then ": reason" only when the reason has no digit (a price or a limit
--     never leaves); anything else reads 'recorded'.
--   * show.injection_attempts  the newest 100 rows of each severity (the panel's window, newest first by seen_at): each
--                              branch is an ORDER BY ... LIMIT on the table, so an index on injection_attempts
--                              (severity, seen_at desc, id desc) makes the read stop at 100 rows whatever the table's size
--   * show.injection_counts    how many rows of each severity pass the same rules
-- Both read show.injection_visible (the rules above, one copy), which is never granted to anyone.
-- Never selected: world, normalised (the recorder's own cleaning), the unique-key ids (event_id, thread_id, duel_id,
-- message_id: `proof` already names the one that verifies the row).
-- raw is a counterparty's exact text (the recorder caps it at 2000 characters): hostile, shown as plain text only.
--
-- bazaar creates the table; until it exists this file creates nothing, says so, and succeeds (re-run it after).

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_namespace where nspname = 'show') or to_regclass('show.gate') is null then
    raise exception 'apply db/show.sql first';
  end if;
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader') then
    create role bazaar_live_reader nologin;
  end if;
  if to_regclass('public.injection_attempts') is null then
    raise notice 'public.injection_attempts does not exist yet: show.injection_attempts not created (re-run after bazaar creates it)';
    return;
  end if;
  -- The rules, once. Not a security barrier and never granted: only the two views below read it, as their owner.
  execute $v$
    create or replace view show.injection_visible as
    select a.id, a.tick, a.source, a.from_team, a.to_us, a.tags, a.severity, a.raw, a.our_response, a.proof, a.seen_at
      from public.injection_attempts a
     where a.world = 'real'
       and ((a.source <> 'duel' and a.duel_id = 0)
            or (coalesce((select g.open_all from show.gate g), false)
                and exists (select 1 from public.duels d
                             where d.duel = a.duel_id and d.status in ('deal', 'no_deal')
                               and not exists (select 1 from public.duels l
                                                where l.status = 'live'
                                                  and (l.session is not distinct from d.session or l.item is not distinct from d.item)
                                                  and (l.deadline_tick is null
                                                       or l.deadline_tick >= (select coalesce(max(f.tick), 0) from public.feed_events f))))))
  $v$;
  execute $v$
    create or replace view show.injection_attempts with (security_barrier = true) as
    select n.id, n.tick, n.source, left(n.from_team, 40) as from_team, n.to_us, n.tags, n.severity,
           left(n.raw, 2000) as raw,
           case when r.verb is null then 'recorded'
                when r.reason ~ '^[A-Za-z][A-Za-z ,./()''_-]{0,100}$' then r.verb || ': ' || r.reason
                else r.verb end as our_response,
           left(n.proof, 200) as proof, n.seen_at
      from ((select * from show.injection_visible where severity = 'attempt' order by seen_at desc, id desc limit 100)
            union all
            (select * from show.injection_visible where severity = 'weak' order by seen_at desc, id desc limit 100)) n
     cross join lateral (
       select case when lower(substring(n.our_response from '^\s*([A-Za-z_]+)')) in
                        ('ignored', 'refused', 'rejected', 'blocked', 'walked', 'held', 'declined', 'flagged', 'recorded',
                         'logged', 'countered', 'accepted', 'closed', 'kept')
                   then lower(substring(n.our_response from '^\s*([A-Za-z_]+)')) end as verb,
              btrim(substring(n.our_response from '^\s*[A-Za-z_]+\s*:\s*(.*)$')) as reason
     ) r
  $v$;
  execute $v$
    create or replace view show.injection_counts with (security_barrier = true) as
    select v.severity, count(*)::int as n from show.injection_visible v group by v.severity
  $v$;
  revoke all on show.injection_visible from public;
  grant usage on schema show to bazaar_live_reader;
  grant select on show.injection_attempts, show.injection_counts to bazaar_live_reader;
end $$;

commit;
