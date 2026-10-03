-- Bazaar Live: what the Agent screen may read of our agents' decisions (taker, maker, duels).
--
-- Applied by the coordinator with the ADMIN url, AFTER db/show.sql (never by this repo, never by the show):
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql
--     psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/agent_decisions.sql
-- show.sql converges the role on exactly its own two views (it revokes everything else in schema show), so
-- re-running show.sql drops these grants: run this file again after it. Until then the server logs
-- `agent_decisions off` once and the game screens run as before.
--
-- Idempotent. Three views, granted to bazaar_live_reader (the role show.sql creates), no table grant:
--   * show.agent_decisions  one row per live decision of taker / maker / duels, with its last execution's
--                           method and error code and its trade outcome (bazaar sql/schema.sql: decisions,
--                           executions, outcomes, written by decisions.DecisionLog and evals.store)
--   * show.agent_outcomes   the scored outcomes (trade, dealer, duel), keyed by scored_at for polling
--   * show.agent_ledger     the guardrail ledger per tick: spend, accepts, listings (ledger_pg.PgLedger)
-- Never selected: decisions.candidates / reason / rag_context / state_digest / chosen whole, jev reason and
-- digest, executions.request / response, outcomes.explanation / details whole, ledger.item / source, and no
-- dry-run row. Duel rows keep only their id, kind, status, rule id, Jev verdict and error code: their prices,
-- values, rivals and denial texts carry our private limit (`duel_inside_limit` prints it), the same reason
-- show.sql gates duel transcripts. A duel outcome keeps its label, never its surplus or score.

begin;
set local lock_timeout = '15s';

do $$
begin
  if not exists (select from pg_roles where rolname = 'bazaar_live_reader')
     or to_regprocedure('show.as_int(jsonb)') is null or to_regprocedure('show.as_text(jsonb, int)') is null then
    raise exception 'apply db/show.sql first: it creates schema show, its helpers and the role bazaar_live_reader';
  end if;
end $$;

-- No new function here: show.sql's re-run revokes EXECUTE on every function of schema show but its own three.

create or replace view show.agent_decisions with (security_barrier = true) as
with live as (
  select d.id, d.tick, d.agent, d.kind, d.status, d.candidates, d.chosen, d.jev,
         coalesce(d.policy_checks ->> 'guardrail', '') as g,
         coalesce(d.kind, '') like 'duel%' or d.agent = 'duels' as duel
    from public.decisions d
   where d.agent in ('taker', 'maker', 'duels') and d.dry_run is not true and d.tick >= 0
),
-- The last request per decision (most have one). Plain joins: no index on decision_id, and these tables are small.
last_exec as (
  select distinct on (x.decision_id) x.decision_id, x.sdk_method, x.error_code
    from public.executions x
   where x.decision_id is not null
   order by x.decision_id, x.id desc
),
outcome as (
  select distinct on (o.decision_id) o.decision_id, o.label, o.realized_surplus, o.jev_right
    from public.outcomes o
   where o.decision_id is not null and o.target is distinct from 'duel'
   order by o.decision_id, o.scored_at desc nulls last
)
select l.id,
       l.tick,
       l.agent,
       left(l.kind, 32) as kind,
       case when l.duel then 'duel:' || coalesce(show.as_int(l.chosen -> 'duel'), show.as_int(l.candidates -> 'duel'))::text
            else left(coalesce(show.as_text(l.chosen -> 'ref'), show.as_text(l.candidates -> 'ref'), show.as_text(l.candidates -> 'item'),
                               show.as_text(l.candidates -> 'want_card'), show.as_text(l.candidates -> 'pack')), 32) end as item,
       -- Not `owner`: in a decision row that is the writer token of the process, not a counterparty.
       case when not l.duel then left(coalesce(show.as_text(l.candidates -> 'dealer'), show.as_text(l.candidates -> 'counterparty'),
                                               show.as_text(l.candidates -> 'maker'), show.as_text(l.chosen -> 'with')), 24) end as counterparty,
       case when not l.duel then coalesce(show.as_int(l.chosen -> 'price'), show.as_int(l.candidates -> 'price'), show.as_int(l.candidates -> 'total'),
                                          show.as_int(l.candidates -> 'ask'), show.as_int(l.candidates -> 'bid')) end as price,
       case when not l.duel and jsonb_typeof(l.candidates -> 'value') = 'number'
            then round((l.candidates ->> 'value')::numeric, 1) end as our_value,
       l.status,
       case when l.g = 'allowed' then 'allowed' when l.g like 'denied%' then 'denied' end as verdict,
       -- The rule id, as guardrails.check() names it in its denial (the first one when several broke).
       case when l.g like 'denied%' then coalesce(
              substring(l.g from '(max_price_[a-z]+|cash_floor|max_spend_per_game_hour|max_packs_per_game_hour|block_buying_held_cards|protect_page_sets|max_accepts_per_tick|max_counterparty_share|allow_flags|open_sealed_packs|duel_inside_limit|allow_venue_open|venue_open_after_game_hours|trading_enabled|inspect_accepts)'),
              case when l.g like '%pause file%' then 'pause_file' when l.g like '%your_value%' then 'sell_min_value_ratio' end,
              'other') end as rule,
       case when l.g like 'denied%' and not l.duel then left(regexp_replace(substr(l.g, 9), '\s+', ' ', 'g'), 140) end as rule_text,
       left(show.as_text(l.jev -> 'verdict'), 16) as jev_verdict,
       case when not l.duel and jsonb_typeof(l.jev -> 'value') = 'number' then round((l.jev ->> 'value')::numeric, 2) end as jev_value,
       left(x.sdk_method, 32) as exec_method,
       left(x.error_code, 48) as error_code,
       left(o.label, 8) as outcome_label,
       round(o.realized_surplus, 1) as realized_surplus,
       o.jev_right
  from live l
  left join last_exec x on x.decision_id = l.id
  left join outcome o on o.decision_id = l.id;

create or replace view show.agent_outcomes with (security_barrier = true) as
select o.target,
       left(o.subject, 32) as subject,
       o.decision_id,
       coalesce(d.agent, case o.target when 'duel' then 'duels' when 'dealer' then 'taker' end) as agent,
       o.recorded_tick as tick,
       case o.target when 'trade' then left(show.as_text(o.details -> 'ref'), 32) when 'dealer' then left(show.as_text(o.details -> 'item'), 32) end as item,
       case o.target when 'trade' then left(show.as_text(o.details -> 'counterparty'), 24) when 'dealer' then left(show.as_text(o.details -> 'dealer'), 24) end as counterparty,
       case when o.target <> 'duel' then left(show.as_text(o.details -> 'side'), 4) end as side,
       case o.target when 'trade' then show.as_int(o.details -> 'price') when 'dealer' then show.as_int(o.details -> 'fill_price') end as price,
       case when o.target = 'trade' and jsonb_typeof(o.details -> 'card_value') = 'number'
            then round((o.details ->> 'card_value')::numeric, 1) end as our_value,
       left(o.label, 8) as label,
       case when o.target <> 'duel' then round(o.score, 3) end as score,
       case when o.target <> 'duel' then round(o.realized_surplus, 1) end as realized_surplus,
       left(o.jev_verdict, 16) as jev_verdict,
       o.jev_right,
       o.scored_at
  from public.outcomes o
  left join public.decisions d on d.id = o.decision_id
 where o.target in ('trade', 'dealer', 'duel')
   and (o.decision_id is null or (d.agent in ('taker', 'maker', 'duels') and d.dry_run is not true));

-- What guardrails.context_from() sums: spend per game hour (t_hours, a refund is a negative spend) and accepts per tick.
create or replace view show.agent_ledger with (security_barrier = true) as
select l.tick,
       round(max(l.t_hours)::numeric, 4) as t_hours,
       coalesce(sum(l.price) filter (where l.kind = 'spend'), 0)::int as spent,
       count(*) filter (where l.kind = 'spend' and l.price > 0)::int as buys,
       count(*) filter (where l.kind = 'accept')::int as accepts,
       count(*) filter (where l.kind = 'listing')::int as listings
  from public.ledger l
 where l.tick >= 0
 group by l.tick;

revoke all on show.agent_decisions, show.agent_outcomes, show.agent_ledger from public;
revoke all on show.agent_decisions, show.agent_outcomes, show.agent_ledger from bazaar_live_reader;
grant select on show.agent_decisions, show.agent_outcomes, show.agent_ledger to bazaar_live_reader;

commit;
