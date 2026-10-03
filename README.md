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

Node 22.18 or newer (`.nvmrc` pins 22.22.0): the server runs TypeScript directly by stripping types.

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
| `?token=…` | The game screens only: the server's `GAME_VIEW_TOKEN`, when it sets one. Without it a locked server keeps those screens empty. |
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
design, and that branch is gone. A nav in the header moves between the show and five screens, one per
question (the query, `?mock=1`, `?lang=`, `?token=`, is kept from one screen to the next):

| Route | Answers | Shows |
|---|---|---|
| `/agent` | What is our agent doing, and why? | The current phase and goal, then a timeline of our events by tick, each tick read as Observe → Decide → Act → Result (thoughts, actions, our offers, their replies, our settlements with their gain). Nothing from other teams. |
| `/negotiations` | How is each deal going? | Our threads, open first; the selected one (`?id=`) as a conversation: our messages and theirs, each offer with its ids, ask vs bid on a price rail, `final`, expiry, an injection flag on suspicious counterparty text. Duels below. |
| `/album` | How close are we to completing pages? | One row per barrio page by rarity slot, owned and missing, completion; the score breakdown; score and cash over ticks. |
| `/market` | What is everyone else trading? | Every settlement not ours (ours on demand), prices per card, the most active teams. |
| `/learn` | What have our agents learned? | What blocks a deal right now (cooloffs, quotas, sold-outs, level blocks, with the ticks until each lifts), the lessons and learned ladders our scored outcomes wrote, the facts read from the feed (price floors, behaviour, fees, notices), how each dealer behaves (threads, deals, opening ask vs fill, ours vs everyone, firmness, concession size), her latest moves, and the rivals' profiles. Read from Postgres: see below. |
| `/debug` | What exactly arrived? | The raw event stream, filtered by type family and ours / market, with an inspector showing the full JSON of the clicked row. |

`?mock=1` plays a TypeScript port of bazaar's mock game (`src/game/mock.ts`, seeded): our agent
haggling with Abuela and other teams, duels, and the rest of the market around it. No key needed.

**The relay.** The data comes from the server (`server/game/`), which reads the game with the team key
and never hands the key to the page:

| Env | Effect |
|---|---|
| `BAZAAR_KEY` | The real game (`https://bazaar.causaprima.ai`). Without it (and without `BAZAAR_SIM`) the relay is off and the screens say so. |
| `BAZAAR_SIM=1`, `BAZAAR_SIM_KEY` | The simulator instead, with a `sim-…` key (default `sim-team1`). With `sim-team1` the screens show team 1 of the simulator. |
| `GAME_VIEW_TOKEN` | Strongly recommended on a public deploy. When set, the stream needs `?token=` with this value. Without it, anyone with the URL reads our cash, our assets with their values, our album and our duel offers. |
| `GAME_POLL_MS` | Poll interval, default 5000 (2000 to 60000). |

Every poll reads `/api/clock` and `/api/feed`; `/api/me` is read on a new tick and after a settlement
of ours (a 429 there waits for the next tick, the loop does not slow down). It never opens the game's SSE
stream: its cap of 6 streams per key is shared with the agents. Events reach the page in the web view's
envelope (made-up `clock`, `agent.hello`, `agent.me` with negative ids, then the feed unchanged). `agent.me`
carries only what the screens read (`server/game/me.ts`: id, name, cash, the score and its parts, the album
pages, each asset's id, kind, ref, serial and our value); never the affinity, a key or the rest. Duel
messages and results are team-only, so the feed never has them: on each new tick (after `/me`, inside the same
budget, a 429 waiting for the next tick and its Retry-After) the relay reads `/api/duels?done=true` and turns
the newest 20 duels into `duel.message {duel, role, sender, price, days}` and `duel.result {duel, deal, price,
points}`, each once, with stable negative ids, scope `team` (`server/game/duels.ts`). Never our limit, days
weight, gain or the words. The page counts a duel event as ours only when it is `team` or names a duel of ours,
so the feed's public `duel.closed` of other teams stays in the market:

- `GET /api/game` → `{enabled, target, tokenRequired}` (never the key or the URL).
- `GET /api/game/stream` → server-sent events: one `events` message with the replay (the latest hello,
  /me, clock first, then the last 5000 events), then one `events` message per poll, and `hb`.

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

The server reads the four views every 10 s on its own one-connection pool and serves the last read at
`GET /api/learn`, behind the same `GAME_VIEW_TOKEN` as the game stream (the page carries `?token=`). Without
`SHOW_DATABASE_URL` it answers `{enabled: false}`; a view not applied yet only blanks its panel. `?mock=1` shows a
made-up memory around the mock game.

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
| `elevenlabs` (**the show's voice**) | `POST /api/tts` → `api.elevenlabs.io/v1/text-to-speech/{voice}` | `eleven_v4` (default) | `[laughs]`, `[whispers]`, `[sarcastic]`... passed as they are | `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_VOICE_BUYER` / `_SELLER` / `_ABUELA` / `_CHATO` / `_NARRATOR` |
| `gemini` | `POST /api/tts` → `generativelanguage.googleapis.com/v1beta/interactions` | `gemini-3.8-flash-tts` (default) | sustained tags (`[sarcastic]`, `[whispers]`) go to `speech_metadata.style` with each character's persona; momentary ones become inline `<laugh>`, `<gasp>`, `<sigh>` | `GEMINI_API_KEY`, `GEMINI_TTS_MODEL`, `GEMINI_VOICE_BUYER` / `_SELLER` / `_ABUELA` / `_CHATO` / `_NARRATOR` |

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
server/       the Node server: static files, /health, /api/tts
```
