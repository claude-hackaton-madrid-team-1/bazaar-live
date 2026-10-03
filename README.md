# Bazaar Live · the buyer and the seller, talking out loud

Team 1's real-time show for The Bazaar (Causa Prima hackathon, Madrid 2026). Our two trading agents,
the **BUYER** (taker) and the **SELLER** (maker), appear as two animated characters at a Rastro
stall, and every move they make is spoken as a short, funny line of dialogue.

Nice-to-have N10 of the main repo's plan
([`bazaar/.ai/specs/98-nice-to-haves.md`](https://github.com/claude-hackaton-madrid-team-1/bazaar/blob/main/.ai/specs/98-nice-to-haves.md)).
Stack: Vite + React + TypeScript + [Motion](https://motion.dev) (`motion` package, `motion/react`).

**Public URL:** pending the first deploy of the Railway service `bazaar-live` (project
`heartfelt-warmth`, declared in the bazaar repo's `.railway/railway.py`, bazaar PR #85). Its domain is
generated once by hand, so it is added here when it exists; add `?mock=1` to preview without the game.

## Run

Node 22.18 or newer (`.nvmrc` pins 22.23.3): the server runs TypeScript directly by stripping types.

```sh
npm ci
npm run dev            # http://localhost:5173 — the show (voice: ElevenLabs v4 when `npm start` has its key, else captions only)
npm run build          # static files in dist/
npm start              # http://localhost:8080 — dist/ + /health + the TTS proxy (/api/tts)
```

To try the paid voices locally, build, then start the server with a key in the environment (never
in a file in this repo): `ELEVENLABS_API_KEY=... npm start`. In dev, `npm start` on 8080 next to
`npm run dev` also works: Vite proxies `/api` to it (`BAZAAR_LIVE_API` overrides the target).

Checks (the same ones CI runs, `.github/workflows/ci.yml`):

```sh
npm run lint           # oxlint + eslint (typescript-eslint strict, react-hooks)
npm run typecheck      # tsc -b, strict
npm test               # vitest
npm run test:coverage  # with v8 coverage
```

## URL parameters

| Parameter | Effect |
|---|---|
| `?mock=1` | On the show, plays `src/mock/fixtures.json` on a loop instead of the live feeds (on the game screens, a made-up match: see below): a recorded-style afternoon (lists, a reprice with Jev, a guardrail denial, Abuela and El Chato, a deal, a refused accept, a late row). Use it when the doors are closed. |
| `?speed=2` | Mock playback speed, 0.25 to 8. |
| `?lang=es\|en` | The language of every line, spoken and written. Castellano with a Madrid flavour by default; `en` has its own native English lines (not translated ones). One language per line, never mixed. |
| `?doors=closed` | With `?mock=1`: the mock's `/health` says the doors are closed (no events, a countdown to the opening), to hear the idle talk. |
| `?idle=8` | Seconds of quiet before the characters talk about the situation (default 22 s with closed doors or a pause, 35 s otherwise; 2 to 600). |
| `?mode=dry` | The mock's agents report DRY RUN, so every move is acted out as practice. |
| `?token=…` | The game screens only: the server's `GAME_VIEW_TOKEN`, when it sets one. Without it a locked server keeps those screens empty. A token ending in `.` is safer written `%2E`: a pasted link often drops a trailing dot. |
| `?transport=sse` | The game screens read the stream over SSE instead of the WebSocket (the default). |
| `?theme=light\|dark` | Forces the light or dark appearance. Without it the page follows the system's setting. |
| `?tts=auto\|webspeech\|elevenlabs\|gemini\|off` | Voice provider. `auto` (default) is ElevenLabs v4 when the server has its key, else captions only: no browser-voice or Gemini stand-in. `webspeech` and `gemini` are for development, by name. The header's picker offers ElevenLabs v4 or no voice. |

Keyboard: **M** mutes and unmutes. Browsers only let a page speak after a click, so the show opens
with a "Start the show with sound / Watch muted" gate. The tab remembers the answer (sessionStorage),
and every later mute or unmute replaces it: a reload goes straight to the show with the same sound (with
sound, the voices wait for the first tap or key anywhere), a new tab asks again. Blocked storage (a private
window) only means the gate asks again after a reload.

## Data (public, read-only)

Contracts: [`bazaar/docs/services.md`](https://github.com/claude-hackaton-madrid-team-1/bazaar/blob/main/docs/services.md).

| Agent | HTTP | WebSocket |
|---|---|---|
| Buyer (taker) | https://bazaar-taker-production.up.railway.app (`/health`, `/state`) | `wss://bazaar-taker-production.up.railway.app/events` |
| Seller (maker) | https://bazaar-maker-production.up.railway.app (`/health`, `/state`) | `wss://bazaar-maker-production.up.railway.app/events` |

- **Two resilient feeds** (`src/net/feed.ts`): reconnect with exponential backoff and jitter
  (0.5 s doubling to 15 s, reset after 10 s of a stable connection, and at once when the browser comes
  back online); dedupe by `agent|id|type|tick|t` (both agents count ids from -1 and restart at -1
  after a deploy, so the id alone is not unique); the join replay (the last 200 events) goes to the
  transcript as history, live events go to the stage.
- **LIVE / DRY RUN** comes from each agent's `GET /health` (`mode`), polled every 20 s. The header also always shows **which game** they play in, from the same `/health` (`target.mode`): JUEGO REAL / REAL GAME, SIMULADOR / SIMULATOR, MEZCLA / MIXED when the two disagree, `GAME ?` while no agent has reported a target, and the recorded mock labelled as such. The last target each agent reported is kept through a failed poll (it is fixed per deploy). No extra fetch. The maker's
  `GET /state` seeds the board with our open offers.
- **Only public fields, on the show.** `src/model/sanitize.ts` mirrors the allow-list of bazaar PR #69
  (`public_decision`, `public_execution`): kind, card, venue, counterparty, the price on a row actually
  sent by a live agent, status, the guardrail as a label (`allowed` / `denied`) and Jev's verdict label.
  Values, limits, reasons, console lines, Jev probabilities and the game's answer bodies never reach
  the stage, even from an agent that still publishes them. That is why Jev's bubble shows a verdict
  meter (the option Jev picked among its siblings, e.g. quick sale · fair · aggressive) and not
  probabilities: the probabilities are private.
- **Read-only.** The page never sends anything to the agents or the game.
- **The exception: the game screens** (below) read the game with the team key, server-side, and show
  our private state (cash, assets with their values, the album). They are still read-only: nothing is
  ever posted to the game.

## Game screens (from bazaar's web view)

The Next.js `web/` view that lived on bazaar's `feat/web-live` branch now lives here, on the glass
design, and that branch is gone. A nav in the header moves between the show and the game screens, one per
question (the query, `?mock=1`, `?lang=`, `?token=`, is kept from one screen to the next):

| Route | Answers | Shows |
|---|---|---|
| `/agent` | What is our agent doing, and why? | The current phase and goal, then a timeline of our events by tick, each tick read as Observe → Decide → Act → Result (thoughts, actions, our offers, their replies, our settlements with their gain). Nothing from other teams. |
| `/strategy` | What are we aiming for, why do we hold these cards, why do we not buy what is on sale? | The plan: the incomplete album pages our affinity boosts with the cards they lack, the complete ones, how spares are sold, our venue; what we spent this game hour and the price cap per rarity. Then the ONE rule that stops buys now in big type (`Caja 81, suelo 50: solo 31 para comprar`), the refused card it hit last (price, our value, the surplus, how often, and the cash that would fit it), what is on sale now against what we lack, Jev's refusals in one line, and every refused buy by the surplus given up behind a toggle. Last, every card we hold: kept for a page (and why), spares on sale (our ask vs our value vs the cheapest elsewhere and the last fill), spares not on sale grouped by reason, duels on hold. Read from Postgres: see below. |
| `/negotiations` | How is each deal going? | Our threads, open first; the selected one (`?id=`) as a conversation: our messages and theirs, each offer with its ids, ask vs bid on a price rail, `final`, expiry, an injection flag on suspicious counterparty text. A link to Duels while any is live. Above, one plain sentence per open dealer thread, team swap and duel ("We're buying LAV-10 from Los Pícaros: we offered 56 P, they ask 63 P"), our caps and duel limits only with `?token=`; below, the teams negotiating with us (team swaps: what each side gives, their words as escaped plain text, never spoken; duels) and the Markets: each board's live offers (name, set, rarity, price), the ones that concern us first and marked, and its latest trades. Team threads reach the page only once the server reads our team-scoped events (today it reads the public feed). |
| `/duels` | Is their price inside our limit? | One card per live duel: rival, buying or selling, the card at stake, their price → ours, the gap, our limit and how far inside or outside it their price is, the rounds and what their decay costs, the ticks left, the duels agent's last call (offer, blocked by a rule, accept planned by the deadline − 2) and a pill (inside limit / haggling / outside limit / expiring). Then the record per rival and per session with `score.duel_points`, every finished duel in one line (deal at X vs our limit Y, what it kept, rounds), and whether the duels agent is silent or blocked. The live chat below the cards (`src/game/ui/DuelChat.tsx`, `views/duelChat.ts`) reads one duel as a conversation, the way the show's transcript reads: each side's price and delivery day tick by tick, the rival's offer inside or outside our limit (with the view token), each round and the share of the value its decay has taken, our agent's accept, refused move or wait (when the decision names the duel) with Jev's verdict, and the end. `?duel=` picks one; without it the chat follows the duel that moved last. The stream carries the offers, not the words. |
| `/album` | How close are we to completing pages? | One row per barrio page by rarity slot, owned and missing, completion; the score breakdown; score and cash over ticks. |
| `/rivals` | Who is ahead, and who has the cards we need? | The cards our target pages lack (incomplete pages our affinity boosts), each with the teams holding it (a spare first, then the freshest sighting; how we know: bought, from a pack, a gift, crafted, listed; since when) and the teams also after it lately (board bids with their best cash, dealer asks). Then the standings by the leaderboard's last read (score, complete pages, how many of our needs each holds, the set its public moves chase, flagged when it is one we aim for), and our album beside the album of the team picked there (`?team=`): neighbourhood by neighbourhood in our Album screen's order, our twelve cells next to theirs slot by slot, their cards seen in public moves filled and every other one drawn as unknown, never missing. Read from Postgres (db/rival_albums.sql): only public game facts, never a value of ours. |
| `/market` | What is everyone else trading? | Every settlement not ours (ours on demand), prices per card, the most active teams; our open offers on the boards, each posted by hand marked "a mano" (no agent manages it). Ours come from `db/game.sql`'s `show.game_our_offers`, however long ago they were listed (`server/game/dbsource.ts` sends them as the sticky `offers.ours`, replayed after the backlog). |
| `/prices` | Is this a good price? | The live price guide, one row per card the market or we care about: the standard price (the median of the last 8 fills, dealers too, else the book price), the trend (the newest 3 fills against the 3 before, ±5 % steady), the best bid and ask over every venue (an ask with its venue's fee), the spread, what the card is worth to us, and a good deal for us by the album's rules (buy ≤ min(worth − 2, standard), sell ≥ max(worth + 5, standard): a copy that completes a page is worth that page). "Buy now" / "Sell now" when the board has one; a row that moved this tick flashes. `src/game/views/prices.ts`, over the WebSocket. |
| `/history` | Where did our cash go? Where do the other teams beat us? | Our cash now, first, lowest and highest today, money in and out, fees; cash over the day tick by tick, each change marked; every movement explained by the trades and events between two readings (bought X from Y + fee, sold, a market's bond, a pack, a gift), the rest shown as "not from a trade we saw"; and what our agents committed in the ledger. Read from Postgres: see below. Every team's score from the public leaderboard: where they beat us and where we beat them (vs the leader, the team just above and the mean), every team's score and our place over the day, and what moved our place (db/teams_score.sql). |
| `/learn` | What have our agents learned? | What blocks a deal right now (cooloffs, quotas, sold-outs, level blocks, with the ticks until each lifts), the lessons and learned ladders our scored outcomes wrote, the facts read from the feed (price floors, behaviour, fees, notices), how each dealer behaves (threads, deals, opening ask vs fill, ours vs everyone, firmness, concession size), her latest moves, and the rivals' profiles. Read from Postgres: see below. |
| `/injections` | Who tried to prompt-inject our agents, and what did they do? | The judges' view: every recorded injection attempt, its exact text (plain text, hidden characters shown as markers), the proof to verify it and what our agent did. See [Injection attempts](#injection-attempts-the-show-debug-and-injections). |
| `/debug` | What exactly arrived? | The raw event stream, filtered by type family and ours / market, with an inspector showing the full JSON of the clicked row. |
| `/approvals` | Do we let our agents make this big trade? | Only when the server runs approvals (see [Approvals](#approvals-approvals)); otherwise there is no tab and the path is the show. Behind a password: every buy or sell our agents refused because its price is at or above `human_approval_above` (bazaar's GUARDRAILS.md), with why it asked, our value and the official value, the album impact (a red LAST COPY badge on a page's last copy), who asked and the ticks until it goes stale; Approve (with a confirm click) or Deny. Below, the live approvals with Revoke. |

`?mock=1` plays a TypeScript port of bazaar's mock game (`src/game/mock.ts`, seeded): our agent
haggling with Abuela and other teams, duels, and the rest of the market around it. No key needed.

**The relay.** The data comes from the server (`server/game/`), which reads the game with the team key
and never hands the key to the page:

| Env | Effect |
|---|---|
| `BAZAAR_KEY` | The real game (`https://bazaar.causaprima.ai`). Without it (and without `BAZAAR_SIM`) the relay is off and the screens say so. |
| `BAZAAR_SIM=1`, `BAZAAR_SIM_KEY` | The simulator instead, with a `sim-…` key (default `sim-team1`). With `sim-team1` the screens show team 1 of the simulator. |
| `GAME_VIEW_TOKEN` | Strongly recommended on a public deploy. When set, the stream needs `?token=` with this value. Without it, anyone with the URL reads our cash, our assets with their values, our album, our duel offers and our duel limits. |
| `GAME_POLL_MS` | Poll interval, default 5000 (2000 to 60000). |
| `SHOW_DATABASE_URL`, `GAME_SOURCE` | With the show's read-only url, the screens read our own database instead (`db/game.sql`'s views, every 3 s, `server/game/dbsource.ts`), no key needed; the header says `DB` or `GAME API`. `GAME_SOURCE=api` forces the relay; views not applied yet → the relay. |

Every poll reads `/api/clock` and `/api/feed`; `/api/me` is read on a new tick and after a settlement
of ours (a 429 there waits for the next tick, the loop does not slow down). It never opens the game's SSE
stream: its cap of 6 streams per key is shared with the agents. Events reach the page in the web view's
envelope (made-up `clock`, `agent.hello`, `agent.me` with negative ids, then the feed unchanged). `agent.me`
carries only what the screens read (`server/game/me.ts`: id, name, cash, the score and its parts (with `market`,
`bench_efficiency` and `bench_venue` for the Market Test panel), the album
pages, each asset's id, kind, ref, serial and our value); never the affinity, a key or the rest. Duel
messages and results are team-only, so the feed never has them: on each new tick (after `/me`, inside the same
budget, a 429 waiting for the next tick and its Retry-After) the relay reads `/api/duels?done=true` and turns
the newest 20 duels into `duel.started {duel, session, role, rival, item, deadline_tick, limit, decay}`,
`duel.message {duel, role, sender, price, days}` and `duel.result {duel, deal, price, points, gain, rounds, limit}`,
each once, with stable negative ids, scope `team` (`server/game/duels.ts`). Our limit and gain go to this
token-gated stream only, for the Duels screen; never the days weight, our share, our offer object or the words,
and never to the public show. The page counts a duel event as ours only when it is `team` or names a duel of ours,
so the feed's public `duel.closed` of other teams stays in the market:

- `GET /api/game` → `{enabled, target, tokenRequired}` (never the key or the URL).
- `GET /api/dealers` → `{names: {id: name}}`: every dealer's display name, read keyless from the game's
  public `/api/dealers` at most every 5 minutes (`server/dealers.ts`), for the captions of a dealer that speaks
  with a guest voice (docs/voices.md).
- `GET /api/game/stream` → server-sent events: one `events` message with the replay (the latest hello,
  /me, clock first, then the last 5000 events), then one `events` message per poll, and `hb`.
- `GET /api/game/ws` (WebSocket upgrade) → the same stream, one text frame per message: `events\n<json array>`,
  `hb\n1`. The game screens use it by default (`src/game/wsSource.ts`); `?transport=sse` forces the SSE stream,
  and two sockets in a row that never open (a proxy that cannot upgrade) fall back to it for the visit. Same
  token, same per-address and total caps (SSE and WebSocket counted together), a page of another origin is
  refused (403), and a frame from the page closes the socket (1003): it is server to page only.

### What our agents learned (`/learn`)

Our agents keep their memory in the team's Postgres (bazaar `sql/schema.sql`: `learnings`, `trader_behaviors`,
`dealer_curves`, `competitor_profiles`). `db/learn.sql` adds four read-only views to schema `show` for the same
role as the transcript (`bazaar_live_reader`, `SHOW_DATABASE_URL`):

- `show.learnings`: the learnings not superseded, with an evidence count (not the ids), no embedding, no dedupe
  key; `stats` (a learning's detail, a learned ladder) only when it is an object under 2 kB.
- `show.trader_moves`: every dealer move the behaviour reader stored (open, concede, hold, final, deal, ...),
  ours or read from the public feed.
- `show.dealer_stats`: per dealer, from the curves of every team: threads, deals, mean opening ask and fill, fill /
  opening (all teams and ours), steps, ticks.
- `show.rival_profiles`: per rival team: level, venue, pack price, what they bought and sold, the sets they chase.

Apply it with the admin url, after `show.sql` (a re-run of `show.sql` revokes every grant in the schema, so run
both, in this order, each time): `psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql`.
`sh scripts/test-sql.sh` proves both files on a throwaway local Postgres.

The server reads the four views every 10 s, and as soon as our agents' sockets say a negotiation moved (see
[Live refresh](#live-refresh-history-learn-and-strategy)), and serves the last read at `GET /api/learn`, behind the same
`GAME_VIEW_TOKEN` as the game stream (the page carries `?token=`). Without `SHOW_DATABASE_URL` it answers `{enabled: false}`; a view not applied yet only blanks its panel. `?mock=1` shows a
made-up memory around the mock game.

### Our agents' decisions (`/agent`)

The taker, the maker and the duels write every decision to the team's Postgres (`decisions`, `executions`,
`outcomes`, `ledger`: bazaar `sql/schema.sql`). `/agent` reads them through the show's read-only role and answers:
did each agent act this tick (and if not, which guardrail stopped it), which rule blocks most in the last game
hour, where the money stands against GUARDRAILS.md, and whether each settled deal beat our value (and Jev was right).

- `db/agent_decisions.sql` (applied by whoever holds the admin url, AFTER `db/show.sql`, never by this repo):
  ```sh
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/agent_decisions.sql
  ```
  It refuses to run before `show.sql`. `show.sql` converges the role on its own two views, so **re-running
  `show.sql` drops these grants: run `agent_decisions.sql` again after it**. Three `security_barrier` views,
  SELECT for `bazaar_live_reader`, no table grant, no new function:
  - `show.agent_decisions`: one row per live decision of taker / maker / duels (dry runs and other writers left out):
    `id, tick, agent, kind, item, counterparty, price, our_value, status, verdict, rule, rule_text, jev_verdict,
    jev_value, exec_method, error_code, outcome_label, realized_surplus, jev_right`. `rule` is the guardrail id
    `guardrails.check()` names in its denial (the first when several broke; `pause_file`, `sell_min_value_ratio`
    are read from their text, anything else is `other`), `rule_text` the denial cut to 140 characters.
  - `show.agent_outcomes`: scored trades, dealer threads and duels (`target, subject, decision_id, agent, tick,
    item, counterparty, side, price, our_value, label, score, realized_surplus, jev_verdict, jev_right, scored_at`).
  - `show.agent_ledger`: per tick `t_hours, spent` (net of refunds), `buys, accepts, listings`.
  - Never selected: `candidates`, `chosen`, `reason`, `rag_context`, `state_digest` whole, Jev's reason and digest,
    `executions.request/response`, `outcomes.explanation/details` whole, `ledger.item/source`, the writer token
    (`owner`). A duel row keeps only its id, kind, status, rule id, Jev verdict and error code: its price, value,
    rival and denial text carry our private limit (`duel_inside_limit` prints it). A duel outcome keeps its label,
    never its surplus or score.
- The server (`server/game/decisions.ts`) shares the transcript's pool (`SHOW_DATABASE_URL`) and needs the game
  relay (`BAZAAR_KEY` or `BAZAAR_SIM=1`); without either it is off. Every 3 s it reads the decisions after the
  last id (and re-reads the last 300 ids, whose status and request answer land later), the outcomes after the
  last `scored_at`, and the ledger of the last two game hours, and publishes `agent.decision`, `agent.outcome`,
  `agent.ledger` (`shared/decisions.ts`) into the game stream, behind `GAME_VIEW_TOKEN` like the rest. A missing
  view (or a grant `show.sql` dropped) is logged once (`agent_decisions off view_missing`) and re-checked every
  minute; the relay never notices.
- The caps are in no live source (the agents' `/health` and `/events` leave limits out, the database only keeps a
  denial's text), so the newest evidence wins (`src/game/limits.ts`): a denial text newer than the docs
  (`cash 73 - 67 < cash_floor 20`, the newest per rule by tick), else `GUARDRAIL_SPEND_PER_HOUR`,
  `GUARDRAIL_CASH_FLOOR`, `GUARDRAIL_ACCEPTS_PER_TICK`, else `shared/guardrails.ts` (bazaar#219: floor 5; #216: 250
  an hour). A `GUARDRAIL_*` variable left behind after the docs move on overrides them: remove it once the docs agree. A denial is newer when its tick is at or past the docs' `since` tick in the same run (or in a run whose clock
  started again below it). The floor holds `venue_bond_reserve` (270) only while `allow_venue_open` is on and our venue
  is not open yet; `agent.ledger` carries `venue` (from the Strategy poller's `show.strategy_me`) to tell.
- How the page reads them (`src/game/views/decisions.ts`, `agent.ts`): the feed keeps only its last window, so
  "Now" falls back to the latest decision (goal, guardrail and Jev) and the latest one whose request went out,
  and the counters (open threads, our trades, value gained) come from the same outcomes as the deals tile. A
  dealer thread that ended with no fill is not a deal; a dealer fill is scored against the value our decisions
  logged for that card and dealer, else "no value". The same refusal repeated (agent, kind, item, rule) is one
  row with `×N, ticks A–B`; "no decision this tick" is one line, on the current tick only. A restart
  (`process_started`) reads "restart (deploy)", and rows that write nothing carry no guardrail badge. Ids shown
  are real ones (decision, settlement, thread): the server's own event ids count down from -1 and are never printed.
- `?mock=1` plays decisions too: approved ones, blocks by several rules, an expired accept, the maker posting in
  bursts (quiet in between), the duels every other tick, scored deals and a ledger.
- Privacy proof on a throwaway local Postgres: `sh scripts/test-sql.sh` runs `db/agent_decisions.test.ts` after `db/show.test.ts`.

### Words (`src/game/humanize.ts`)

Every game screen names things the same way: the agents as Comprador / Vendedor / Duelos (Buyer / Seller / Duels),
guardrail rules and decision kinds in words (`suelo de caja`, `abrir trato con un equipo`), a denial as one sentence
from its numbers (`cash 81 - 79 < cash_floor 20` → "nos dejaría con 2 P, por debajo del suelo de 20 P"; an older floor
reads "del suelo de entonces (50 P)"; the raw text
stays under Detalles), cards by name with the code as a small token, dealers, rivals and teams by name (Abuela Carmen,
Rival Sol, Equipo 6), and times as game time from the newest tick ("hace 3 min", "caduca en ~8 min", the tick on hover).
The parsers live in `src/game/humanize.ts` (tested), the words in `strings.ts` (`hum`, es and en). An id with no word
yet reads with spaces instead of underscores.

### Our agents' health (header)

Every game screen's header has one chip per agent (taker, maker, duels): green, amber or red with the one
reason that matters (`dry run`, `ledger down`, `tick 14.2/15 s`, `429 ×3`, `Jev slow 9 s`, `no tick for 2 min`,
`silent 12 ticks`, `quiet 5 ticks`, `closed · opens 09:00`); a click opens the details. On `/agent`, a silent or
quiet agent carries the same reason: `Buyer silent for 12 ticks: ledger down since 11:40`.

- The server (`server/game/health.ts`) asks the taker's and the maker's public `/health` every 10 s (4 s
  timeout, one round at a time) and relays an allow-listed report (`shared/health.ts`) as `agent.health` on the
  game stream: a sticky status, the latest first in every replay, never in the backlog. The page never calls the
  agents. Never relayed: the target url or any field not listed. It remembers since when each reason holds.
  `RAILWAY_SERVICE_BAZAAR_TAKER_URL` / `_MAKER_URL` (bare domains) override shared/endpoints.ts; `AGENT_HEALTH=off`
  turns it off. It runs whenever the game stream does.
- `/health` today says mode, target, ledger, tick, last tick, doors, paused and the game's tick. The tick's
  duration (`tick_ms`, `tick_budget_s`), 429s (`rate_limited`) and Jev (`jev_ms`, `jev_undecided` 0–1) are read
  as soon as bazaar's `status.py` reports them; until then only the mock shows them.
- The duels have no HTTP: their chip reads their decisions. Silence thresholds are per agent
  (`SILENCE` in `src/game/views/decisions.ts`): the taker is silent after 3 ticks; the maker, which posts in
  bursts, is quiet (amber) after 3 and silent after 24; the duels after 3 and 12. Closed doors or a paused game
  explain a silence; a report older than 45 s greys the chip.
- `?mock=1`: the taker's ledger is down (red), the maker's ticks run at 14.2 of 15 s (amber), the duels are fine.

### Our cash and its movements (`/history`)

Cash is in the header of every game screen, larger than the other figures, with its last change (▲ +68 P); once
the header scrolls away it stays in a pill in the corner. Both open `/history`. The header's figure is the game's
own `/me`, live; the screen reads Postgres through `db/history.sql`, six more read-only views for the same role:

- `show.cash_points`: our cash (real world, our team) at each tick it changed, and the latest, with score and rank.
- `show.our_trades`: our settlements from the feed (it carries when we received them, so a tick that starts again
  on a new day still sorts): buy or sell, counterparty, card, price, fee. A buyer pays price + fee.
- `show.our_orders`: the ledger (listings, accepts, spends) per agent. A listing posted by hand (`bazaar sell ... --live`
  books it as `hands-off:<offer>`) carries its offer from `db/game.sql`'s `show.game_our_offers`: buy or sell, the card,
  the venue, the expiry and what became of it. The screen reads each row as a sentence ("Compramos Palacio de
  Velázquez RET-08 en v02 · caduca en ~4 min · abierta"), the source as who (an agent, or "a mano" for every command
  run by hand), a spend folded into the order it pays for; the raw rows only behind "detalles".
- `show.our_events`: our feed events that move cash or stock besides a trade: a market's bond, a pack opened, a
  gift, a level, a failed settlement.
- `show.score_points`: our score and its five parts (duels, ladder, negotiation, market-making, bench) and cash at
  each tick one of them moved, and the latest. Never the whole score object (it carries `luck_private`).
- `show.score_marks`: what may explain a change of score: an agent's `process_started` decision (a deploy or a
  restart; only the agent and the tick leave the row) and the game's own turns (a round, a Market Test, duels, a
  new day). A decision has a tick and no time, so a start is put on its day by order: a tick far below the one
  before it starts a new run of the clock, as does a day that starts far below the last day's last tick.

The top of `/history` is **Score today**: the score tick by tick with a mark at each start (an agent's starts
within 10 ticks of each other fold into one, `Buyer restart ×8`) and each game turn. Tap a mark to
compare from it, until now or until the next mark: each part's change since the mark against the same number of
ticks before it (▲ moving faster, ▼ slower), which is the answer to "did the change help?". Tap a part to put it
on the big chart. Changes to the agents' GUARDRAILS.md, STRATEGY.md or flags are not marked: that repository is
private, and the server holds no GitHub token. Until `show.score_points` is applied the panel is the cash chart.

Under it, **every team's score** (`db/teams_score.sql`, `show.team_scores`: the public leaderboard as our agents stored
it, one read per team about every 10 ticks, kept when something moved for that team). It answers "where do they beat
us, and where do we beat them?" first: one sentence ("Nos ganan sobre todo en creación de mercado (−0.97 vs la media)
… El líder, Equipo 10, nos saca 5.07 en negociación"), then per part our value, our place, and the gap against the
leader, the team just above us and the mean of the others (green where we lead, red where we trail). Then every team's
score over the day as steps (ours highlighted, up to five followed teams in colour, the rest muted; hover, drag or the
arrow keys list every team at that moment, highest first, with its gap to us), our place and the followed teams' over
the day, and what moved our place (who passed us and with which part, or our own move, and our agents' restarts and
the game's turns between the two reads). Only the board's numbers are compared, ours included: the board's `score` is
`negotiating + market`, in points, normalised the same way for every team, and for us it equals `/me`'s `score`,
`negotiating` and `market` at every tick. `/me`'s `neg_points`, `mm_points`, `duel_points`, `ladder_points` and
`bench_points` (the strips above) are our private raw parts in their own units, which the board hides for every team,
so they are never set beside a rival's number. Pages, deals and level score nothing by themselves: shown as context.

Under it, the **Market Test** panel: every team's `market` part at the board's latest read, teams level on one row
(ours highlighted), our place and the leader's lead; then our own bench run from `/me` (`bench_points`,
`bench_efficiency`, `bench_venue`, `mm_points`: private, in their own units, never ranked) and a note that bench
matches never show up as venue trades, so our venue's 0 trades does not mean the test did not run. The board's half
comes from `show.team_scores`; ours from `show.game_me` (`db/game.sql`).

Days are the Madrid date: a moment is (day, tick). Apply after `show.sql` and the other show files, each time:
`psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/teams_score.sql -f db/injections.sql`. The server reads
the views every 5 s on the server's one shared pool (no connection of its own: the role is limited to 4), and as soon as our
agents' sockets say something moved (below), and serves `GET /api/history`, behind `GAME_VIEW_TOKEN`. `?mock=1` shows a
made-up day of money.

### Live refresh (`/history`, `/learn` and `/strategy`)

These three screens read their own API rather than the game stream, so the server keeps them close to real time itself
(`server/game/pages.ts`). Our agents' `/events` sockets (`server/game/agentsws.ts`, `onEvent`) only say "read now":
history reads 250 ms and 2.5 s after any execution and 250 ms and 5 s after the taker's tick (our orders land right
after the execution; our cash before the tick; trades and learnings at the end of the taker's tick), learn 1.5 s and
5 s after a thread's execution and 5 s after the taker's tick, strategy 250 ms, 2.5 s and 5 s after the taker's tick
(its refusals are decided early in the tick and never reach a socket) and 250 ms and 2.5 s after any decision or
execution. Postgres stays the only source of rows. When a read
finds new rows the server sends one sticky `pages.changed` on the game stream (when each screen last changed, times
only), and the page refetches; its own timer drops to 30 s (history, strategy) and 60 s (learn) while those notices
come, and back to 5 s / 10 s without them. Each screen says `live`, or in amber when it was last updated. `PAGES_WAKE=off`
keeps the notices but never reads early.

### What we aim for, and why we hold and do not buy (`/strategy`)

`db/strategy.sql` adds five read-only views for the same role, behind `GAME_VIEW_TOKEN` (they carry our values, our caps
and why our agents refused a buy: never in the public show views):

- `show.strategy_me`: our latest real-world snapshot, field by field: cash, level, venue, the affinity (numbers only), the
  album pages and each card we hold (ref, set, rarity, `your_value`, its asset id to match our own asks). Never the `me`
  or `score` objects whole (`luck_private`, `collection_value`).
- `show.strategy_spend`: what our buys spent in the last game hour (refunds netted), as `guardrails.context_from()` sums it.
- `show.strategy_decisions`: the taker's and the maker's live decisions (no duels, no dry runs, no starts) with only the
  card, price, fee, total, our value and surplus, the guardrail's text, Jev's value, verdict and reason, and the agent's
  own `reason` cut to 240 characters. Never `candidates`, `chosen`, `rag_context` or Jev's digest and probabilities.
- `show.strategy_asks`: the single-card asks for cash open now on every venue, from the feed (listed in the last game hour,
  not expired, cancelled or settled since), ours flagged.
- `show.strategy_cards`: the released catalog with the last price the tape filled for each card.

The caps are read live from the guardrail texts (`cash 73 - 67 < cash_floor 20` names the floor and its value) when they
are newer than the docs; else from the server's `GUARDRAIL_*` variables (`/api/strategy` carries them as `limits`); a
cap no fresh denial has named (the rare's, the pack's) comes from `shared/guardrails.ts`, a typed copy of bazaar's
GUARDRAILS.md and STRATEGY.md. When those files change a value, change it there and move its `since` to the first tick
that runs it: an older denial never overrides it. The window is the last 300 ticks of the current run. Apply after the other show files, each time:
`psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/teams_score.sql -f db/injections.sql`.
The server reads them every 5 s on the shared pool, and as soon as our agents' sockets ring ([Live refresh](#live-refresh-history-learn-and-strategy)), and serves `GET /api/strategy`; a view not applied yet blanks its part
and the page says which. `?mock=1` shows a made-up afternoon. Privacy proof: `sh scripts/test-sql.sh` runs `db/strategy.test.ts`.

### What the rivals hold (`/rivals`)

`db/rival_albums.sql` adds four read-only views for the same role. They read only public game facts (the feed, the
leaderboard, our monitor's profile of each rival), never our snapshots, decisions, ledger or duels, so no value of ours
can reach them; the page works out what we lack from its own game stream. The game has no public album: its
`/api/cards/{id}` hides other teams, so a holding is known by public moves only.

- `show.rival_holdings`: per holder (a team or a dealer) and card, the copies we last saw it hold. A copy is followed by
  its asset id in feed order: a settlement moves it, a pack's `best` (rare or better) shows it, a board listing shows it
  with its maker. A gift or a craft names a card without a copy and counts until that team lists or sells the card.
  `how` (bought, pack, gift, crafted, listed) and `since_tick` belong to the copy held longest; `seen_tick` is the last sighting.
- `show.rival_teams`: each team's latest real leaderboard read (rank, score, level, complete pages, deals) and its set
  interest (numbers only); `album_filled` / `album_slots` (the board's filled album slots) stay null until the agents'
  writer stores them in `leaderboard_snapshots`. The view reads them off the whole row, so they fill in from then on
  with no change or re-apply here.

The album of the picked team says `36 held · 27 known` (filled slots by the leaderboard, page cards public moves show;
only `27 known` until `album_filled` is stored). When the leaderboard counts more complete pages than we see complete,
the likeliest of the others are flagged *probably complete*: the most cards known first, as many as we miss; a page
with no card known is never flagged.
- `show.rival_wants`: per team and card, its board bids (with the best cash) and its dealer asks.
- `show.rival_head`: the newest feed tick.

Apply after the other show files, each time:
`psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/teams_score.sql -f db/injections.sql`.
The server reads them every 15 s on the shared pool, and 5 s after the taker's tick, and serves `GET /api/rivals` (the
same token). `?mock=1` shows a made-up market. Proof: `sh scripts/test-sql.sh` runs `db/rival_albums.test.ts`.

### Injection attempts (the show, `/debug` and `/injections`)

Prompt injection is allowed in this game. Our agents only RECORD it (bazaar's `injection_attempts` table) and never
report a team. The panel shows each attempt with its proof:

- full page on `/injections`, the judges' view;
- under the stream on `/debug`;
- on the show, under the stage: the newest five, with a link to the rest. The show is projected, so it shows rows or
  nothing: no setup note, no loading line, no error.

Each row says when (time and tick), who (team, dealer or venue) and through which channel (feed, team thread, duel,
dealer thread, offer text). It then shows the tags, their exact text, the proof to check it
(`GET /api/threads/412 message 2210`) and what our agent did. `weak` rows sit behind a toggle with their count: code,
a url or money words only, often a venue's own format notice.

- **The views.** `db/injections.sql` adds `show.injection_attempts` (the newest 100 of each severity) and
  `show.injection_counts` for the same read-only role. They feed a public route, so they publish only:
  - rows of the real world;
  - a duel's row (any row that names a duel) by `show.duel_lines`' own rule: once an admin opens `show.gate`, and only
    for a closed duel with no live sibling;
  - `our_response` as a verb from a closed list (`ignored`, `refused`, `walked`…), plus `: reason` only when the reason
    has no digit, so a price or a limit never leaves. Anything else reads `recorded`.

  They never select the recorder's `normalised` text or its unique-key ids. The rules live once, in
  `show.injection_visible`, which is never granted. The window is an `ORDER BY ... LIMIT` inside the view: at 100,000
  rows of 2,000 characters a read takes about 50 ms, and 5 ms with an index on `injection_attempts (severity, seen_at
  desc, id desc)`. The shared pool runs with JIT off (`server/transcript/pg.ts`): with a production-sized `feed_events`
  the planner's estimates cross `jit_above_cost`, and JIT compiling cost about 240 ms per read. Until bazaar creates
  the table, the file creates nothing and succeeds: re-run it after. Apply it after the other show files, each time:
  `psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/show.sql -f db/learn.sql -f db/agent_decisions.sql -f db/game.sql -f db/history.sql -f db/strategy.sql -f db/rival_albums.sql -f db/teams_score.sql -f db/injections.sql`.
- **The server.** `server/injections/` reads both views every 10 s on the shared pool. A `proof` keeps only the
  characters of an endpoint and its ids.
  - It serves `GET /api/injections`, which is **public** like `/api/transcript` (the show has no token).
  - The body is serialised once per change and carries an ETag, so an unchanged list costs a 304.
  - A view not applied yet shows as "not set up yet", not as "nothing recorded".
- **Their text is hostile.** It is rendered only as React text nodes: no `dangerouslySetInnerHTML`, no markdown, never
  in an attribute.
  - It is cut after 280 characters, with "Show all".
  - Every hidden character is shown as a marker such as `⟨U+200B⟩`, so the trick is visible and cannot reorder the
    line. That covers zero-width, bidi, tags, fillers and every default-ignorable code point; an emoji's own joiners
    are left alone.
  - A stack of combining marks becomes one marker (`⟨+238 marks⟩`), and the boxes clip their content, so nothing
    paints over the page.
- **No voice ever reads it.**
  - `shared/injections.ts` ports the recorder's own `injection_flags`, checked against its Python output. Python and
    Node ship different Unicode versions, so the port reads a text both ways: with every mark dropped (words joined)
    and with every other non-ASCII character as a break (words split). It also refuses a text that reads differently
    than it looks: a mark other than a plain accent (U+0300–036F, or an emoji's variation selector), a compatibility
    character beyond `… º ª µ ½ ¼ ¾` and the no-break space, or a character that decomposes into several letters.
  - It flags whatever the recorder flags, on every code point: `server/injections/unicode-parity.test.ts` checks it
    against `server/injections/recorder-unicode.json`, which `scripts/recorder-unicode.py` writes from bazaar's Python.
    That covers what the recorder drops, what it calls odd, its look-alike letters, its case folds, and any character
    between two words of a keyword phrase; and no character the port lets through may read longer (a stretched gap) or
    as nothing (two words joined) than it does to the recorder. The test's title names the runtime's Unicode version:
    the pinned Node (`.nvmrc`, 22.23.3) ships Unicode 17, the recorder's Python 3.12 Unicode 15. Re-run the script after
    a change to `chooser.py` or a Python upgrade.
  - The transcript mutes a dealer's quote when its RAW words have any of those shapes, or reach the view's
    1,000-character cap (`server/transcript/rows.ts`, `muted`). The server then never vouches it to the TTS proxy, and
    the page keeps it a caption, even with `?quotes=speak`. An item without the flag counts as muted.
  - The proxy also refuses a quote with that shape, or one equal to a recorded attempt after the same cleaning (or, for a
    quote the cleaning cut, its beginning).
  - The panel and the voice pipeline never import each other (`server/injections/isolation.test.ts`).
- `?mock=1` shows made-up attempts, hostile on purpose. Proof on a throwaway local Postgres: `sh scripts/test-sql.sh`
  runs `db/injections.test.ts`.

### Approvals (`/approvals`)

HA2: our agents refuse any card buy or sell priced at or above `human_approval_above` (bazaar's GUARDRAILS.md) unless
a human approved that card, side and price first. This screen is that human's veto. It calls bazaar-mcp's three
human-only tools (`approvals`, `approve`, `revoke`) **from the server** (`server/approvals/`); the browser never sees a
token. It never touches Postgres: this repo's database role stays read-only.

| Env | Effect |
|---|---|
| `APPROVER_PASSWORD` | The screen's own login, at least 20 characters with at least 12 different ones (a shorter or low-variety one counts as unset, logged as `password_too_short` / `password_too_weak`). Not `GAME_VIEW_TOKEN`. Use a generated value, not a phrase (e.g. `openssl rand -base64 24`, piped straight into `railway variable set ... --stdin`): the lockout bounds guessing, it does not make a weak password safe. |
| `BAZAAR_MCP_URL` | bazaar-mcp's base URL, without `/mcp` (e.g. `https://bazaar-mcp-production.up.railway.app`). https, or http only to localhost or `*.railway.internal`. |
| `BAZAAR_MCP_TOKEN` | The bearer bazaar-mcp asks for. |
| `BAZAAR_APPROVER_TOKEN` | The human tools' own token (`x-approver-token`). |

All four, or the feature is off: every `/api/approver/*` path then answers exactly like an unknown `/api` path
(`404 {"error":"not_found"}`), and the nav shows no tab. The server logs once at start whether it is on, and which
names are missing, never a value.

- `GET /api/approver/session` → `{authenticated, csrf?}`.
- `POST /api/approver/login` `{password}` → `{csrf}` and the cookie `bz_approver` (`HttpOnly; Secure; SameSite=Strict;
  Path=/api/approver; Max-Age=7200`), plus a device cookie `bz_device` (same flags, 30 days; an HMAC keyed from
  `APPROVER_PASSWORD` and the server-only `BAZAAR_APPROVER_TOKEN`, so a new password voids every device and a stolen
  cookie is no offline password test). Wrong: `401 {"error":"unauthorized"}`. A login without a
  valid device cookie is charged to a per-address request bucket, then 5 failures from one address in 15 minutes lock
  it for 15 minutes, and 20 from all addresses together lock every such login. A login that carries a valid device
  cookie (OWASP "device cookies") is counted only against that device's own 5 failures: strangers behind the venue's
  shared NAT cannot lock the approver's browser out of the veto. The lock is checked again once the body has arrived,
  so parallel logins cannot race past it, and a locked caller is logged at most once a minute.
- `POST /api/approver/logout`.
- `GET /api/approver/approvals` → the `approvals` tool's answer, checked field by field (`shared/approvals.ts`).
- `POST /api/approver/approve` `{card, side, price, ttl_ticks, reason?}` and `POST /api/approver/revoke` `{card, side,
  reason?}` → the tool's answer (`approved` / `refused` with its reasons, `revoked` / `denied`). Deny is a `revoke` with
  the reason "denied from Bazaar Live".

Security: writes need the cookie, the `x-csrf-token` header (the token from the login, kept in the page's memory only)
and a same-origin request (`/session` is limited per address unless it carries a live session, the page's `/approvals`
polls per session; a known device's `/session` reads go to its own bucket, never its address; one `approvals` answer serves every session for 10 s, one call in flight at a time, and any write
drops it, so the page stays inside bazaar-mcp's 30 calls a minute per bearer); every field is checked against the contract's ranges before bazaar-mcp is called (card
`^[A-Z]{3}-\d{2}$`, side buy/sell, integer price 1-1000, integer `ttl_ticks` 1-480, reason up to 300 characters with
control characters stripped), and writes are limited to 10 a minute per session and 10 a minute for the whole server.
Passwords and CSRF tokens are compared in constant time (both sides hashed, then `timingSafeEqual`). bazaar-mcp is
called with an 8 s timeout and never retried; any failure answers `502 {"error":"approvals unavailable"}` and its own
words never reach the page. Logs carry only `{event, ok, status, tool}`. Sessions live in memory (at most 50, 2 hours):
a redeploy logs the approver out.

## Real conversations (LIVE-T1)

The show can narrate our real dealer threads and closed duels, read from Postgres through a read-only role.
Spec: [`docs/specs/LIVE-T1.md`](docs/specs/LIVE-T1.md).

- `db/show.sql` (applied by whoever holds the admin url, never by this repo): schema `show`, views
  `show.thread_lines` and `show.duel_lines`, role `bazaar_live_reader` (NOLOGIN in the file; add LOGIN and a
  password outside it). The role has no grant on `feed_events` or `duels`. A duel's words are exposed only
  after it closes, and ONLY once an admin opens the gate after the last session
  (`update show.gate set open_all = true`; until then `show.duel_lines` is empty, in every session; even then a closed
  duel stays hidden beside a live sibling whose deadline has not passed). A live
  duel shows nothing. The server keeps duels off the page entirely unless `SHOW_DUELS=on` (our duel prices
  reveal our limits while rivals still play). The role also gets `temp_file_limit`, no TEMP and no CONNECT
  to the other databases (on Railway the only login role is the `postgres` superuser, so the revokes touch no
  one else). Lines read while catching up (a restart, SHOW_DUELS or the gate just opening) are captions, not scenes.
- `SHOW_DATABASE_URL` (a Railway service variable, that role's url on the private network,
  `postgres.railway.internal`, which carries no TLS; any other host, a public proxy included, is refused and
  the feature stays off; query parameters like `host=` or `port=` are refused too): absent → the feature is off and the show is unchanged. `TRANSCRIPT_STREAMS_PER_ADDRESS` (default 12; 200 in all) caps open streams per address; a stream lasts 30 min and the page reconnects. Pool of 2, 2 s statement timeout, a poll every 3 s with backoff; `GET /api/transcript` and the
  SSE stream `/api/transcript/stream`.
- One language (`?lang=es|en`) for every generated line and voice. A dealer's or rival's real words are
  captions only; the line built from the structured offer is what is spoken. `?quotes=speak` with
  `TRANSCRIPT_SPEAK_QUOTES=1` voices a hosted dealer's quote (bound to that dealer, never a rival's), and only when its
  detected language is the selected one. A
  line that names its language is never read by a voice of another one. The TTS proxy voices only show
  templates and generated real lines (plus those quotes when enabled).
- `?mock=1` plays a synthetic transcript with no database.
- Privacy proof on a throwaway local Postgres: `sh scripts/test-sql.sh` (needs docker).

## What it shows

- **Stage** (`src/stage/`): an original fantasy-RPG bazaar for Madrid's Rastro at dusk, drawn in SVG and
  CSS (no game assets, names, fonts or likenesses; the only font is Cinzel from Google Fonts, bundled).
  Layers: a sky from indigo to ember with a moon and twinkling stars, two rows of rooftops with lit
  windows, stalls down the street, pennant strings and swaying lanterns, two heraldic banners, torches
  with flickering flames, cobbles in perspective, drifting fog, light shafts and a vignette. The layers
  drift slowly and shift with the pointer (parallax). The SELLER, the BUYER and the two dealers (Abuela
  Carmen with her lantern, El Chato in his flat cap) are SVG merchants animated with Motion: they
  breathe when idle, nod and gesture when they talk, haggle (rocking, hands working), reach for a card,
  triumph (arms up, a shower of gold coins and a "¡TRATO HECHO!" ribbon on an accepted execution),
  and grumble (head shake, arms crossed) when a request is refused or a dealer walks away. A guardrail
  denial raises a glowing **rune shield**; Jev's verdict is a **glowing orb** whose colour is the
  verdict, with the meter of its sibling options; offer cards fly to a notice board, price tags roll
  and flash on a reprice. `prefers-reduced-motion` is respected: every CSS and Motion animation stops
  (0 running animations, measured) and the figures hold their pose. Captions sit on parchment scrolls
  in at least 15 px (13 px on a phone) and the transcript repeats every line.
- **Dialogue** (`src/show/`, `shared/`): each decision or execution becomes a one-to-three-line
  BUYER ↔ SELLER exchange in ONE language per line (`shared/lines.es.ts`, `shared/lines.en.ts`: the same
  banks, written separately for each language), with delivery tags (`[laughs]`, `[sarcastic]`,
  `[whispers]`...) that are never read aloud. It is **context-aware and non-repeating**:
  - *Situations.* When nothing is happening the characters read the agents' public `/health` (`doors`,
    `paused`, `next_opens`, `tick_seconds`, `mode`, `target`) and the tick (`src/show/situation.ts`):
    closed doors with the countdown and the opening hour in Madrid time, a pause, a quiet market, a new
    tick, a dry run, the simulator, no signal. They also notice, from live events, a new neighbourhood
    page (El Retiro on Saturday, Chamberí on Sunday: the first live card of that set) and a Market Test
    session (every two game hours, from the events' `t`).
  - *Mood.* A small deterministic mood (calm, eager, sarcastic or triumphant, `src/show/mood.ts`) comes
    from the topic (a deal is triumphant, a refusal sarcastic), a busy or long-quiet stage, a practice
    row, and the moods of the last lines. Every variant in the banks carries its mood.
  - *Memory.* A recent-lines memory (`src/show/memory.ts`, six minutes) means no line repeats within the
    window while a fresh one exists; when a bank is used up the one said longest ago comes back first.
    Replayed history passes no memory, so a replay of the same event reads the same.
  A director plays beats in order and, on a busy tick, drops the least interesting ones (holds before
  deals), merges runs of holds, and skips stale small talk.
- **Transcript** = captions: every spoken line, in order (`role="log"`, `aria-live="polite"`), with
  replayed and skipped lines dimmed.

## Voices

One queue (`src/tts/queue.ts`): one line at a time, never overlapping, and **gap-free**: the whole beat is
fetched ahead (`prefetch`) when it starts, so each voice starts a few milliseconds after the last one ends,
the captions follow the voice, and `say()` reports whether a line was really heard (a refused, failed, timed-out
or muted line keeps its caption for its reading time); mute
stops the current line and drops the rest; a watchdog ends a line whose provider never reports its end; a failing or refused line (a spent budget, a 5xx)
is skipped: its caption keeps its reading time and the show goes on (no browser voice stands in).

| Provider | Where | Model | Tags | Env (server only) |
|---|---|---|---|---|
| `webspeech` | browser `speechSynthesis`, keyless | a NATIVE voice of the line's language per role (es-ES first, then other Spanish; en-GB, en-US), different voices per character when the browser has them, a woman for Abuela, rate and pitch per character | never read: mapped to a little speed, pitch or volume (`[whispers]` is quieter, `[excited]` brighter), then stripped | none |
| `elevenlabs` (**the show's voice**) | `POST /api/tts` → `api.elevenlabs.io/v1/text-to-speech/{voice}` | `eleven_v4` (default) | `[laughs]`, `[whispers]`, `[sarcastic]`... passed as they are | `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_VOICE_BUYER` / `_SELLER` / `_ABUELA` / `_CHATO` / `_PILAR` / `_NARRATOR`, and `ELEVENLABS_VOICE_POOL` (comma-separated ids for dealers that arrive later; `_GUEST1`..`_GUEST3` override one) |
| `gemini` | `POST /api/tts` → `generativelanguage.googleapis.com/v1beta/interactions` | `gemini-3.8-flash-tts` (default) | sustained tags (`[sarcastic]`, `[whispers]`) go to `speech_metadata.style` with each character's persona; momentary ones become inline `<laugh>`, `<gasp>`, `<sigh>` | `GEMINI_API_KEY`, `GEMINI_TTS_MODEL`, `GEMINI_VOICE_BUYER` / `_SELLER` / `_ABUELA` / `_CHATO` / `_PILAR` / `_NARRATOR`, and `GEMINI_VOICE_POOL` (or `_GUEST1`..`_GUEST3`) |

Model names, checked against the official docs on 2026-10-03:

- **ElevenLabs:** the models page lists `eleven_v4` and `eleven_v4_turbo`; there is no "v4 flash"
  (Flash is `eleven_flash_v2_5`, which has no audio tags). `eleven_v4` is the default; set
  `ELEVENLABS_MODEL_ID` to change it. The docs say v4 Turbo is served through the Text to Dialogue
  WebSocket, so it may not work on this REST endpoint.
- **Gemini:** "Gemini 3.8 TTS" is `gemini-3.8-flash-tts` (expressive) or `gemini-3.8-flash-lite-tts`
  (faster, cheaper); set `GEMINI_TTS_MODEL` to switch.
- **Voices:** Gemini's defaults (Puck, Fenrir, Sulafat, Algenib, Charon) are from its prebuilt list.
  The ElevenLabs defaults are premade voice ids we could not check without a key. The settings sent
  per role (`stability`, `similarity_boost`, `language_code`), the reasoning, how to get a Castilian
  accent and the switch-on steps for the pitch are in [`docs/voices.md`](docs/voices.md); none of it was
  run (no paid call is made by the tests or by this repo's work).

**No key in the browser.** Keys are read from the server's environment and never sent to the page,
logged or committed. The proxy is public, so it guards what it speaks and what it spends:

- **Only the show's own lines, in one language.** The dialogue templates live in `shared/lines.es.ts` and
  `shared/lines.en.ts` (matched by `shared/lines.ts`); the page fills their `{slots}` from public event
  fields and `/health`, and the proxy accepts a line only when it matches one of those templates for that
  speaker in the request's `lang` (or, for an older page that sends none, in the language it matches),
  with every slot restricted to the words the show can produce in that language (`shared/vocab.ts`):
  card names, primas, dealer names, a countdown ("45 minutos") and an opening hour ("hoy a las 9:00"), a
  neighbourhood, and closed lists for the game's error codes, the documented decision kinds and Jev's
  verdicts. Anything else is a `400`, and so is a line that is half of each language; a test checks that
  every line the show can produce passes in its own language and is refused in the other, and that
  arbitrary text (or a phrase smuggled into a slot) is refused.
- **Only this page.** A request must carry an `Origin` naming this host (browsers always send it on a
  `POST`); others get `403`. Text is capped at 300 characters.
- **Limits.** Per address (Railway's `X-Real-IP`; `X-Forwarded-For` is never trusted) a burst of 40
  then 24 lines a minute; all callers together a burst of 160 then 72 a minute. The address is checked
  before the shared bucket, so one caller over its limit cannot drain it for everyone. A daily budget of
  9,000 characters sent to a provider (UTC day; the ElevenLabs account has 10,000 credits and a character costs about one) caps the cost; a share per address is opt-in
  (`TTS_DAILY_CHARS_PER_ADDRESS`, off by default because the pitch screen is one address too), and a
  call the provider refused gives its characters back. IPv6 callers are counted by their /64. Env: `TTS_PER_ADDRESS_BURST`, `TTS_PER_ADDRESS_PER_MINUTE`,
  `TTS_GLOBAL_BURST`, `TTS_GLOBAL_PER_MINUTE`, `TTS_DAILY_CHARS`, `TTS_DAILY_CHARS_PER_ADDRESS`,
  `TTS_CLIENT_IP_HEADER` (each must be declared in bazaar's `.railway/railway.py` before it is set, or
  the next apply deletes it). For the pitch, size `TTS_DAILY_CHARS` to the window (the mock scene talks
  about 850 characters a minute) and set a credit limit on the provider key itself.
- **Cache.** Every viewer hears the same line for the same event: a 24 MB cache and shared in-flight
  requests make a repeated line free.

A refused or failed line is shown as a caption only, for its reading time.

## Deploy (Railway)

One Node service, `bazaar-live`, serves `dist/` and the TTS proxy (`npm run build`, then
`node server/index.ts`; healthcheck `GET /health`). It is declared in the bazaar repo's
`.railway/railway.py`, the single source of truth for project `heartfelt-warmth`; the keys are set
once, by hand, through stdin so they never appear on a command line:

```sh
railway variable set ELEVENLABS_API_KEY --stdin --service bazaar-live
railway variable set GEMINI_API_KEY --stdin --service bazaar-live
# the Approvals screen (all four, or it stays off); the password: generated, e.g. openssl rand -base64 24 piped in
railway variable set APPROVER_PASSWORD --stdin --service bazaar-live
railway variable set BAZAAR_MCP_URL --stdin --service bazaar-live
railway variable set BAZAAR_MCP_TOKEN --stdin --service bazaar-live
railway variable set BAZAAR_APPROVER_TOKEN --stdin --service bazaar-live
```

The show's voice is **ElevenLabs v4 only**: with no ElevenLabs key on the server the show plays with captions only (the header says so); the browser's own voice is no stand-in (`?tts=webspeech` still reaches it, for development, and `?tts=gemini` Gemini).

After the first deploy, check the edge from outside (the proxy trusts what Railway's edge reports):

```sh
URL=https://<the bazaar-live domain>
curl -s $URL/health                                   # {"ok":true,"service":"bazaar-live","tts":[...]}
# The page's own POSTs must pass: the Origin check compares with Host (or X-Forwarded-Host).
# The per-address limit must hold even when a caller sends its own X-Real-IP: with a key set,
# 45 POSTs of DIFFERENT show lines (a repeated line is a cache hit and skips the limiter), each with
# a new X-Real-IP, should start answering 429 by the 41st. Lines are cached after a run, so each run
# starts at a fresh base (BASE) and only a run on lines not yet spoken counts:
BASE=$((RANDOM % 900))
for n in $(seq $((BASE + 1)) $((BASE + 45))); do curl -s -o /dev/null -w '%{http_code} ' -X POST $URL/api/tts \
  -H 'Content-Type: application/json' -H "Origin: $URL" -H "X-Real-IP: 198.51.100.$n" \
  -d "{\"provider\":\"elevenlabs\",\"speaker\":\"seller\",\"lang\":\"es\",\"text\":\"La Latina número $n se queda como está.\"}"; done
```

## Layout

```
src/model     the event model and the public allow-list (sanitize.ts)
src/net       WebSocket feed (backoff, dedupe, replay) and /health, /state fetches
src/mock      fixtures.json (written by scripts/make-fixtures.py) and the looping player
src/show      event → dialogue, mood, memory, situations (from /health), the director, the engine
src/tts       speech queue, Web Speech and its voice picker, the proxy client, provider choice
src/stage     the dusk scene (scene/), the merchants, board, dealers, effects, bubbles (Motion, SVG, CSS)
src/ui        header, transcript, start gate, React hooks
shared/       the language packs (lines.es.ts, lines.en.ts), vocab and slot patterns, tags, endpoints: browser and server
docs/         voices.md: the ElevenLabs settings per role
server/       the Node server: static files, /health, /api/tts, and the game screens' routes (server/approvals: the Approvals screen)
```
