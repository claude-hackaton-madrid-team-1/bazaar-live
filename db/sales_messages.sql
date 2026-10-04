-- Apply with the coordinator's admin connection after db/show.sql. Never grant base-table access.
-- Private team messages may be absent from the public game feed. Only an exact successful
-- real-game Sales send acknowledges these words; a planned decision or a guessed message ID does not.
begin;
set local lock_timeout = '15s';
create or replace view show.game_sales_messages with (security_barrier = true) as
select m.id, m.thread_id, m.tick, m.sender, m.text, t.counterpart, t.venue, t.status as thread_status, t.closed_tick
  from public.messages m
  join public.threads t on t.id = m.thread_id
 where m.ours and m.sender = 't01' and t.ours and t.kind = 'team'
   and t.counterpart ~ '^t[0-9]{1,3}$' and t.counterpart <> m.sender
   and m.tick >= 0 and m.id > 0 and m.thread_id > 0
   and m.text is not null and length(m.text) between 1 and 2000
   and exists (
     select 1 from public.decisions d join public.executions x on x.decision_id = d.id
      where d.agent = 'sales' and d.status = 'done' and d.dry_run is not true
        and d.candidates -> 'evidence_context' ->> 'world' = 'real'
        and d.thread_id = m.thread_id and d.tick = m.tick and x.tick = m.tick
        and x.sdk_method = 'say' and x.error_code is null
        and x.response -> 'message' = to_jsonb(m.id)
        and x.request -> 'thread_id' = to_jsonb(m.thread_id)
   );
grant select on show.game_sales_messages to bazaar_live_reader;
commit;
