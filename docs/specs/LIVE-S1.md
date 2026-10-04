# LIVE-S1 — Reviewed operator desk and truthful live narration

Scope: reuse the existing human session for exact typed proposals, optional browser dictation,
manual private status, explicit approval and durable backend execution. Keep public narration
limited to safe recorded facts. Provide a clearly labelled replay for the Sunday presentation.
No model, provider or authentication changes; no live game write during development.

Implementation sequence: shared boundary decoders → authenticated proxy → operator UI →
recorded Jev/team narration and queue handling → real-event replay → tests and browser checks.
The backend owns fresh game validation and once-only execution. This repository never infers
successful settlement from submission, a vanished offer or a narration line.

## Verification report

| Criterion | Status | Evidence |
|---|---|---|
| Exact proposal review, explicit confirmation and unchanged terms | Verified | `server/approvals/routes.test.ts`: unauthenticated confirm rejected; changed terms rejected; review → approve → execute order checked. Local browser fixture displayed exact bid and returned dry_run only after confirmation. |
| Unknown outcomes remain unknown; no automatic retry | Verified | `src/game/operator.test.ts` nullable-sent case; `OperatorDesk.tsx` clears active confirmation on error and offers status lookup. |
| Private status and public narration boundaries | Verified | `src/game/operator.test.ts` strips nested private inputs; `shared/jev-lines.test.ts` finite recorded-verdict vocabulary; existing public sanitizer suite passes. |
| Real historical replay and presentation media | Verified | 35-second VP8/Opus capture, public transcript ticks 1430–1437, sequences 29–40. Provenance and source JSON accompany the deck in the Bazaar repository. No trade was sent. |
| Desktop/mobile typed interaction and existing voices | Verified | Local fixture screenshots at 1280px/390px; browser console reported no errors; existing production TTS returned audio/mpeg for two structured recorded lines. |
| Actual microphone recognition in the presentation browser | Partial | Browser exposes SpeechRecognition, and only final text enters the field. Real microphone/permission test not performed; typing remains the verified path. |

Honest implementation metric: 5 / 6 criteria verified (83%).

Checks: `npm run lint` (zero errors, one pre-existing Fast Refresh warning),
`npm run typecheck`, `npm run build`, and `npm test` pass. Full suite: 110 files passed,
10 skipped; 1166 tests passed, 101 skipped. The skipped tests require database integration setup.
Build retains the existing bundle-size warning.

Unverified: live MCP deployment with these new operator tools, a real approved game write,
and actual microphone transcription. Could-not-do: live game execution was intentionally
outside this validation scope; no production credentials were exposed or changed.

Implementation notes: raw quote TTS was rejected by the existing proxy, so the presentation
uses only its accepted structured buyer/dealer lines. Replay network failure leaves an empty
labelled stage; use the included video fallback for the presentation. Work was parallel with
backend operator and deck work, with file ownership split by repository.

Security review follow-up: agent/read tools now omit the human-only MCP header;
review and execution retain it. Full bounded canonical monetary terms are rendered and
bound to confirmation, including card, counterpart, asset, gross price, fee and debit/net.
Successful submission responses may omit a reason without becoming a proxy error.
Focused regression result: 45 tests passed across operator boundary and proxy routes.

CI repair: Depot's stale shell smoke assertion expected the old `/api/game` shape
and failed after lint, types, tests and build succeeded. Removed the duplicate GitHub
workflow that still queued Blacksmith runners. Depot now runs exactly lint, formatting,
unit tests and Postgres integration tests. Formatting reuses installed ESLint fixers;
no dependency was added. Local evidence: `npm run test:unit` reports 110 files /
1166 tests passed; `sh scripts/test-sql.sh` reports 10 files / 101 tests passed against
Postgres 17. `npm run format:check` passes; lint has zero errors and its existing
Fast Refresh warning. Hosted CI verification follows the feature-branch push.

Main+PR follow-up: the first hosted run caught six quote-style violations in two
files newly merged to main. Merged `origin/main` (`f70d784`) into this branch and
formatted those lines. Expanded local suites: 118 files / 1217 unit tests passed;
11 files / 115 Postgres integration tests passed. This supersedes the earlier
pre-merge test counts. Hosted verification is recorded on PR #58.

Hosted Depot passed all four checks in 49 seconds on `e9114b8`: 1217 unit tests
and 132 integration tests (12 files). The local SQL helper's old hand-maintained
list omitted one suite; it now uses the same discovery command as CI. Local
recheck: `sh scripts/test-sql.sh` → 12 files / 132 tests passed.


## Broadcaster activity follow-up

Requested scope: make the original voice page reflect duels, ticks, negotiations with other
teams, Jev orchestration, trades and errors, while keeping it useful when muted.

Implemented in `src/show/broadcast.ts` and `src/ui/ActivityPanel.tsx`: bounded, validated
activity from the existing protected game stream. The stream is connected only with a token
and an explicit server `tokenRequired: true`; public maker/taker and settled replay feeds
remain usable without it. Only our team-scoped duel events are eligible. New speech uses
finite bilingual templates, existing structured duel prices and recorded Jev verdict labels;
raw messages and private valuation/reasoning fields are never narrated. Thread closure and
accept submission are not settlement. Failures correlate by our parties, actor or observed
own offer. Day labels do not claim a proven round transition.

| Criterion | Status | Evidence |
|---|---|---|
| Validated event coverage and private/public boundary | Verified | `src/show/broadcast.test.ts`: real duel producer payloads, team scope, other-team exclusion, failure correlation, recorded Jev and template whitelist. `src/game/feed.test.ts`: supplied token does not unlock an unprotected server. |
| Every tick visible; bounded speech/history | Verified | Broadcast tests check 10 clock events with two spoken summaries; replay silent; timeline keeps at most three entries per category. Existing director remains bounded to eight queued beats. |
| Usable muted desktop/mobile interaction | Verified | Local production build at `http://127.0.0.1:8773/?mock=1&speed=2&tts=off&lang=en`: 1440×1000 and 390×844 screenshots, category selector switched to Duels and Jev, no browser errors or console messages. Demo label appears on the panel and every row. |
| Existing real voices with new live events | Partial | TTS allow-list and structured role mapping tested; no live audio, microphone or authenticated production stream exercised in this follow-up. |

Honest implementation metric for this follow-up: 3/4 criteria verified (75%).

Actual validation output: `Test Files 119 passed (119); Tests 1226 passed (1226)`.
`npm run typecheck`, `npm run lint`, `npm run format:check` exited 0.
`npm run build`: `✓ 611 modules transformed`, build succeeded; existing >500 kB bundle warning remains.
Independent reviewer ran 107 focused tests across eight files, all passed.
Screenshots: `/tmp/bazaar-voice-desktop-final.png`, `/tmp/bazaar-voice-duels-final.png`,
`/tmp/bazaar-voice-mobile-final.png` (local artifacts, not committed).

Unverified: production stream coverage depends on the deployed producers; no live producer
was found for phase events, so they appear only when actually supplied. Real audio and
microphone were not tested. Could-not-do: no deployment or live game writes were authorized
for this slice. The local demo combines separate seeded game/dealer tick counters and is
explicitly synthetic. Parallel work: producer contract audit and independent security review
ran separately from implementation. Browser QA caught dealer bursts erasing rare categories;
retaining three rows per category fixed that without adding a new queue.
