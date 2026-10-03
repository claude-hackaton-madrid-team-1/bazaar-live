-- Bazaar Live: the prompt-injection attempts our agents recorded (bazaar sql/schema.sql, `injection_attempts`), for
-- the "Injection attempts" panel on the show, /debug and /injections.
--
-- Applied by the coordinator with the ADMIN url, AFTER db/show.sql (and the other show files), each time:
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql \
--          -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/injections.sql
-- show.sql starts by revoking everything in schema show from bazaar_live_reader: a re-run of it drops this grant
-- too, so re-run this file after it, every time.
--
-- Idempotent. One security_barrier view, SELECT for bazaar_live_reader, no table grant. It feeds a PUBLIC route
-- (the show carries no token), so it publishes only:
--   * the REAL world's rows (never a simulator's);
--   * a duel's row (source 'duel', or any row naming a duel) only by show.duel_lines' own rule: once an admin opens
--     show.gate after the last session, for a CLOSED duel with no live sibling (same session or item) still within its
--     deadline. Our answer in a duel can carry a price, and a price reveals our limit while rivals still play. A row
--     whose duel is not in public.duels stays hidden;
--   * our_response as a verb from a closed list, then ": reason" only when the reason has no digit (a price or a limit
--     never leaves); anything else reads 'recorded'.
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
  execute $v$
    create or replace view show.injection_attempts with (security_barrier = true) as
    select a.id, a.tick, a.source, left(a.from_team, 40) as from_team, a.to_us, a.tags, a.severity,
           left(a.raw, 2000) as raw,
           case when r.verb is null then 'recorded'
                when r.reason ~ '^[A-Za-z][A-Za-z ,./()''_-]{0,100}$' then r.verb || ': ' || r.reason
                else r.verb end as our_response,
           left(a.proof, 200) as proof, a.seen_at
      from public.injection_attempts a
     cross join lateral (
       select case when lower(substring(a.our_response from '^\s*([A-Za-z_]+)')) in
                        ('ignored', 'refused', 'rejected', 'blocked', 'walked', 'held', 'declined', 'flagged', 'recorded',
                         'logged', 'countered', 'accepted', 'closed', 'kept')
                   then lower(substring(a.our_response from '^\s*([A-Za-z_]+)')) end as verb,
              btrim(substring(a.our_response from '^\s*[A-Za-z_]+\s*:\s*(.*)$')) as reason
     ) r
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
  grant usage on schema show to bazaar_live_reader;
  grant select on show.injection_attempts to bazaar_live_reader;
end $$;

commit;
