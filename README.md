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
npm run dev            # http://localhost:5173 — the show; voices via Web Speech
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
| `?mock=1` | Plays `src/mock/fixtures.json` on a loop instead of the live feeds: a recorded-style afternoon (lists, a reprice with Jev, a guardrail denial, Abuela and El Chato, a deal, a refused accept, a late row). Use it when the doors are closed. |
| `?speed=2` | Mock playback speed, 0.25 to 8. |
| `?mode=dry` | The mock's agents report DRY RUN, so every move is acted out as practice. |
| `?tts=auto\|webspeech\|elevenlabs\|gemini\|off` | Voice provider. `auto` (default) takes ElevenLabs, then Gemini, when the server has their key, else the browser's voice. The header's picker changes it live. |

Keyboard: **M** mutes and unmutes. Browsers only let a page speak after a click, so the show opens
with a "Start the show with sound / Watch muted" gate.

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
- **LIVE / DRY RUN** comes from each agent's `GET /health` (`mode`), polled every 20 s. The maker's
  `GET /state` seeds the board with our open offers.
- **Only public fields.** `src/model/sanitize.ts` mirrors the allow-list of bazaar PR #69
  (`public_decision`, `public_execution`): kind, card, venue, counterparty, the price on a row actually
  sent by a live agent, status, the guardrail as a label (`allowed` / `denied`) and Jev's verdict label.
  Values, limits, reasons, console lines, Jev probabilities and the game's answer bodies never reach
  the stage, even from an agent that still publishes them. That is why Jev's bubble shows a verdict
  meter (the option Jev picked among its siblings, e.g. quick sale · fair · aggressive) and not
  probabilities: the probabilities are private.
- **Read-only.** The page never sends anything to the agents or the game.

## Real conversations (LIVE-T1)

The show can narrate our real dealer threads and closed duels, read from Postgres through a read-only role.
Spec: [`docs/specs/LIVE-T1.md`](docs/specs/LIVE-T1.md).

- `db/show.sql` (applied by whoever holds the admin url, never by this repo): schema `show`, views
  `show.thread_lines` and `show.duel_lines`, role `bazaar_live_reader` (NOLOGIN in the file; add LOGIN and a
  password outside it). The role has no grant on `feed_events` or `duels`. A duel's words are exposed only
  after it closes, and ONLY once an admin opens the gate after the last session
  (`update show.gate set open_all = true`; until then `show.duel_lines` is empty, in every session). A live
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

- **Stage** (`src/stage/`): the SELLER behind the stall, the BUYER in front, a cork board with our
  offers. A heartbeat per `agent.tick`; offer cards fly from the seller to the board on `post_ask` /
  `post_bid`, price tags roll and flash on a reprice, cards fly back on a cancel; the buyer reaches for
  a card on `accept_ask`; a handshake, a "¡TRATO HECHO!" stamp and confetti on an accepted
  `agent.execution` (a smaller handshake for other requests the game accepted); a shaking red ALTO sign
  on a guardrail denial; Jev's thought bubble; Abuela Carmen and El Chato pop up for `dealer_*` moves; a
  chip says why a move was not sent (practice, blocked, too late). `prefers-reduced-motion` is respected
  (`MotionConfig reducedMotion="user"`, no confetti, no shaking).
- **Dialogue** (`src/show/`): each decision or execution becomes a one-to-three-line BUYER ↔ SELLER
  exchange, Spanish-flavoured, with expressive tags (`[laughs]`, `[sarcastic]`, `[whispers]`,
  `[gasps]`, ...). Deterministic templates: the line is picked by a hash of the event, so a replay says
  the same thing. A director plays beats in order and, on a busy tick, drops the least interesting ones
  (holds before deals), merges runs of holds into one line, and skips stale small talk.
- **Transcript** = captions: every spoken line, in order (`role="log"`, `aria-live="polite"`), with
  replayed and skipped lines dimmed.

## Voices

One queue (`src/tts/queue.ts`): one line at a time, never overlapping; mute stops the current line
and drops the rest; a watchdog ends a line whose provider never reports its end; a failing provider
falls back to the browser's voice, and after three failures in a row the fallback is used alone for a
minute.

| Provider | Where | Model | Tags | Env (server only) |
|---|---|---|---|---|
| `webspeech` | browser `speechSynthesis`, keyless | the browser's voices (a Spanish one for the dealers when available) | stripped | none |
| `elevenlabs` | `POST /api/tts` → `api.elevenlabs.io/v1/text-to-speech/{voice}` | `eleven_v4` (default) | `[laughs]`, `[whispers]`, `[sarcastic]`... passed as they are | `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_VOICE_BUYER` / `_SELLER` / `_ABUELA` / `_CHATO` / `_NARRATOR` |
| `gemini` | `POST /api/tts` → `generativelanguage.googleapis.com/v1beta/interactions` | `gemini-3.8-flash-tts` (default) | sustained tags (`[sarcastic]`, `[whispers]`) go to `speech_metadata.style` with each character's persona; momentary ones become inline `<laugh>`, `<gasp>`, `<sigh>` | `GEMINI_API_KEY`, `GEMINI_TTS_MODEL`, `GEMINI_VOICE_BUYER` / `_SELLER` / `_ABUELA` / `_CHATO` / `_NARRATOR` |

Model names, checked against the official docs on 2026-10-03:

- **ElevenLabs:** the models page lists `eleven_v4` and `eleven_v4_turbo`; there is no "v4 flash"
  (Flash is `eleven_flash_v2_5`, which has no audio tags). `eleven_v4` is the default; set
  `ELEVENLABS_MODEL_ID` to change it. The docs say v4 Turbo is served through the Text to Dialogue
  WebSocket, so it may not work on this REST endpoint.
- **Gemini:** "Gemini 3.8 TTS" is `gemini-3.8-flash-tts` (expressive) or `gemini-3.8-flash-lite-tts`
  (faster, cheaper); set `GEMINI_TTS_MODEL` to switch.
- **Voices:** Gemini's defaults (Puck, Fenrir, Sulafat, Algenib, Charon) are from its prebuilt list.
  ElevenLabs' seller default is the voice in ElevenLabs' own v4 sample; the other ElevenLabs defaults
  are premade voice ids we could not check without a key. Set `ELEVENLABS_VOICE_*` to voices in your
  account.

**No key in the browser.** Keys are read from the server's environment and never sent to the page,
logged or committed. The proxy is public, so it guards what it speaks and what it spends:

- **Only the show's own lines.** The dialogue templates live in `shared/lines.ts`; the page fills
  their `{slots}` from public event fields, and the proxy accepts a line only when it matches one of
  those templates for that speaker, with every slot restricted to the words the show can produce: card
  names, primas, dealer names, and closed lists for the game's error codes, the documented decision
  kinds and Jev's verdicts. Anything else is a `400`; a test checks that every line the show can produce
  passes and arbitrary text (or a phrase smuggled into a slot) does not.
- **Only this page.** A request must carry an `Origin` naming this host (browsers always send it on a
  `POST`); others get `403`. Text is capped at 300 characters.
- **Limits.** Per address (Railway's `X-Real-IP`; `X-Forwarded-For` is never trusted) a burst of 40
  then 24 lines a minute; all callers together a burst of 160 then 72 a minute. The address is checked
  before the shared bucket, so one caller over its limit cannot drain it for everyone. A daily budget of
  40,000 characters sent to a provider (UTC day) caps the cost; a share per address is opt-in
  (`TTS_DAILY_CHARS_PER_ADDRESS`, off by default because the pitch screen is one address too), and a
  call the provider refused gives its characters back. IPv6 callers are counted by their /64. Env: `TTS_PER_ADDRESS_BURST`, `TTS_PER_ADDRESS_PER_MINUTE`,
  `TTS_GLOBAL_BURST`, `TTS_GLOBAL_PER_MINUTE`, `TTS_DAILY_CHARS`, `TTS_DAILY_CHARS_PER_ADDRESS`,
  `TTS_CLIENT_IP_HEADER` (each must be declared in bazaar's `.railway/railway.py` before it is set, or
  the next apply deletes it). For the pitch, size `TTS_DAILY_CHARS` to the window (the mock scene talks
  about 850 characters a minute) and set a credit limit on the provider key itself.
- **Cache.** Every viewer hears the same line for the same event: a 24 MB cache and shared in-flight
  requests make a repeated line free.

A refused or failed line falls back to the browser's voice.

## Deploy (Railway)

One Node service, `bazaar-live`, serves `dist/` and the TTS proxy (`npm run build`, then
`node server/index.ts`; healthcheck `GET /health`). It is declared in the bazaar repo's
`.railway/railway.py`, the single source of truth for project `heartfelt-warmth`; the keys are set
once, by hand, through stdin so they never appear on a command line:

```sh
railway variable set ELEVENLABS_API_KEY --stdin --service bazaar-live
railway variable set GEMINI_API_KEY --stdin --service bazaar-live
```

With neither key set, the show still speaks with the browser's voice.

After the first deploy, check the edge from outside (the proxy trusts what Railway's edge reports):

```sh
URL=https://<the bazaar-live domain>
curl -s $URL/health                                   # {"ok":true,"service":"bazaar-live","tts":[...]}
# The page's own POSTs must pass: the Origin check compares with Host (or X-Forwarded-Host).
# The per-address limit must hold even when a caller sends its own X-Real-IP: with a key set,
# 45 POSTs of DIFFERENT show lines (a repeated line is a cache hit and skips the limiter), each with
# a new X-Real-IP, should start answering 429 by the 41st:
for n in $(seq 1 45); do curl -s -o /dev/null -w '%{http_code} ' -X POST $URL/api/tts \
  -H 'Content-Type: application/json' -H "Origin: $URL" -H "X-Real-IP: 198.51.100.$n" \
  -d "{\"provider\":\"elevenlabs\",\"speaker\":\"seller\",\"text\":\"La Latina number $n stays put.\"}"; done
```

## Layout

```
src/model     the event model and the public allow-list (sanitize.ts)
src/net       WebSocket feed (backoff, dedupe, replay) and /health, /state fetches
src/mock      fixtures.json (written by scripts/make-fixtures.py) and the looping player
src/show      event → dialogue, the director, the engine that plays beats
src/tts       speech queue, Web Speech, the proxy client, provider choice
src/stage     Motion components: characters, board, dealers, effects, bubbles
src/ui        header, transcript, start gate, React hooks
shared/       dialogue templates (lines.ts), tag conversion, endpoints: browser and server
server/       the Node server: static files, /health, /api/tts
```
