# Bazaar Live · the buyer and the seller, talking out loud

Team 1's real-time show for The Bazaar (Causa Prima hackathon, Madrid 2026). Our two trading agents —
the **BUYER** (taker) and the **SELLER** (maker) — appear as two animated characters at a Rastro
stall, and every move they make is spoken as a short, funny line of dialogue.

Nice-to-have N10 of the main repo's plan
([`bazaar/.ai/specs/98-nice-to-haves.md`](https://github.com/claude-hackaton-madrid-team-1/bazaar/blob/main/.ai/specs/98-nice-to-haves.md)).
Stack: Vite + React + TypeScript + [Motion](https://motion.dev) (`motion` package).

## Data (public, read-only, already live)

Contracts: [`bazaar/docs/services.md`](https://github.com/claude-hackaton-madrid-team-1/bazaar/blob/main/docs/services.md).

| Agent | HTTP | WebSocket |
|---|---|---|
| Buyer (taker) | https://bazaar-taker-production.up.railway.app (`/health`, `/state`) | `wss://bazaar-taker-production.up.railway.app/events` |
| Seller (maker) | https://bazaar-maker-production.up.railway.app (`/health`, `/state`) | `wss://bazaar-maker-production.up.railway.app/events` |

Events: `{id, tick, t, type, scope, actor, agent, payload}` with `type` in `agent.tick`,
`agent.decision`, `agent.execution`; a late joiner first receives the last 200 events. Traces of the
same moves: Phoenix, https://phoenix-production-6aa3.up.railway.app. Optional market context from the
organiser's keyless `https://bazaar.causaprima.ai/api/feed` and `/api/clock`.

## What it shows

- **Animations (Motion):** a tick heartbeat; offer cards flying from the seller's stall to the board
  (`post_ask`/`post_bid`) with price tags that morph on reprice; the buyer reaching for a card
  (`accept_ask`), a handshake and confetti on an execution; a red stop sign that shakes on a guardrail
  denial; a Jev thought bubble with the verdict's probability bar; a DRY RUN / LIVE badge; dealers
  (Abuela, El Chato) popping in for `dealer_*` moves.
- **Voices:** each decision becomes a one-line exchange between the two characters, marked up with
  expressive tags (`[laughs]`, `[sarcastic]`, `[whispers]`, `[gasps]`) to make it funny. One adapter,
  three providers, chosen by availability:
  1. ElevenLabs (requested: "v4 flash" — confirm the exact model id and its audio tags in ElevenLabs' docs);
  2. Gemini TTS (requested: "Gemini 3.8 TTS" — confirm the model id and how it takes style instructions);
  3. the browser's Web Speech API, free and keyless (tags stripped), so the show always works.
  A queue so voices never overlap, and a mute toggle.

## Rules

- **No key in the browser.** TTS provider keys live server-side (a tiny proxy or the host's function);
  the page only receives audio. The agents' endpoints need no key.
- **Read-only.** This app only watches; it never sends anything to the agents or the game.

## Run

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # static files in dist/
```
