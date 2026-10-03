# LIVE-T1 — the show narrates our real conversations

Task id: **LIVE-T1** (this repo has no backlog; the spec lives here and in the PR body).
Pipeline: `bazaar/.ai/pipeline.md` (identify → spec → plan → build → test → review).

## Why

Omar wants the show to speak the *real* conversations (dealer threads and duels), not templates.
Source decided by Jev (0.99): **a read-only Postgres role**. Not the bazaar-mcp server (its bearer
token can also trade) and not the game API (every read spends the one team key's shared 5 req/s).

Duel visibility (Jev undecided, closed_only 0.51 vs live 0.44) → safe default: a duel's
conversation is shown **only after it closes** (`deal` or `no_deal`). A live duel shows only
`duel in progress: <item> vs <rival>`. Our limits are never public.

## Hard limits

Zero real ElevenLabs / Gemini calls. Never push to main, merge, touch Railway, or run SQL against
the Railway database. No secret (database URL, password, key) in code, logs, tests or PR text.
The coordinator applies `db/show.sql` and sets `SHOW_DATABASE_URL`.

## Data (bazaar `sql/schema.sql`; our team id is `t01`)

- `feed_events(id, tick, type, actor, payload jsonb, received_at)`: `thread.opened`,
  `thread.message` (dealer text; OUR text is null; structured `offer`), `settlement`, `duel.closed`.
- `duels(duel, session, tick, status live|deal|no_deal, role, item, your_limit PRIVATE, rival, price,
  days, result PRIVATE, payload jsonb{messages[]}, updated_at)`.
- PRIVATE keys never leave the DB: `your_limit`, `your_days_weight`, `limit_meaning`, `result`,
  and any `reason` / `limit` field.

## Acceptance criteria

| # | Criterion |
|---|---|
| AC1 | `db/show.sql` is idempotent; creates schema `show`, views `show.thread_lines` and `show.duel_lines`, role `bazaar_live_reader` (NOLOGIN) with USAGE on the schema and SELECT on those two views only. |
| AC2 | On a local Postgres 17 with synthetic rows, the role cannot read `feed_events` or `duels`, cannot write, and no private key or value appears in any view row. |
| AC3 | `show.thread_lines` exposes only our dealer threads (opened / message / settlement where `t01` is a party); our own text is null. |
| AC4 | `show.duel_lines` exposes message rows only for CLOSED duels; a live duel yields one row with item and rival only. |
| AC5 | Server: `SHOW_DATABASE_URL` absent → feature off, show unchanged; present → pool max 2, `statement_timeout` 2 s, poll every 3 s by watermark, row cap per poll, backoff on errors, never crashes the server, errors logged without the URL. |
| AC6 | Every text is sanitized (length cap, control / invisible / bidi characters, markup, expressive `[tags]`, URLs); ref / counterpart / numbers come from closed vocabularies. |
| AC7 | `GET /api/transcript?since=<cursor>` and SSE `/api/transcript/stream`; the CSP and existing limits stay; the stream is capped. |
| AC8 | Page: a transcript feed client (reconnect + dedupe); the director plays the real lines: the dealer speaks its real line, our agent speaks our offers rendered from the structured offer, duel replays play after a duel closes. |
| AC9 | ONE selected language (ES or EN, `?lang=`) for every generated line and voice. A real quote is detected (es/en, deterministic, tested) and spoken ONLY when its language is the selected one; otherwise it is shown as text and a generated line in the selected language, built from the structured offer, is spoken. |
| AC10 | The TTS proxy still speaks only text it can vouch for: show templates, the generated real-line templates, or a quote the server itself read from the database. |
| AC11 | `?mock=1` shows a synthetic transcript with no database. |
| AC12 | Tests: SQL privacy (local Postgres), poller + routes with a fake pg, client feed, language routing, mock fixtures. |

## Design

- `db/show.sql`: views run with the owner's rights, so the role needs no table grant. JSON is read
  defensively (`show.as_int`, `jsonb_typeof` guards) so one odd row cannot break the view.
  Duel message rows copy ONLY `from, text, tick, price, days` out of the payload.
  `show.duel_lines` also carries one `live` row per live duel (item, rival, no text, no price) and one
  `closed` row per closed duel, so the live notice needs no third view.
- `shared/transcript.ts`: the wire type `TranscriptItem` (closed vocabularies only).
  `shared/clean.ts`: text sanitizer. `shared/detect-lang.ts`: es/en detector.
  `shared/real-lines.ts`: generated-line templates per language, with slot patterns (like `lines.ts`).
- `server/transcript/`: `rows.ts` (DB row → item), `store.ts` (ring + seq cursor + epoch + dedupe),
  `poller.ts` (injected `query`), `pg.ts` (pool factory), `routes.ts` (JSON + SSE).
- `src/net/transcript.ts` (SSE client), `src/show/real.ts` (item → Beat, language routing),
  `src/mock/transcript.ts`; `Line.silent` makes a line display-only.
- Language: the v2 worker owns the selector and the banks. This branch carries a byte-identical copy of
  its `shared/lang.ts` (`Lang`, `parseLang`) so the rebase is clean, and reads `config.lang`.

## Plan (dependency order; one thin step each)

1. `db/show.sql` + privacy test on local Postgres 17 (AC1–4).
2. `shared/` primitives: `clean.ts`, `detect-lang.ts`, `transcript.ts` (AC6, AC9 detector).
3. `server/transcript/` rows → store → poller → pg → routes, wired in `server/app.ts` / `index.ts` (AC5–7).
4. `shared/real-lines.ts` + proxy allow-rule (AC10) and `src/show/real.ts` language routing (AC9).
5. `src/net/transcript.ts` + `useShow` wiring + engine hook (`Line.silent`, `ingestBeat`) (AC8).
6. Mock transcript for `?mock=1` (AC11); README; review; PR.

## Out of scope / follow-ups

Live duel conversations (Jev undecided); a second selector; voice casting per language (v2).
