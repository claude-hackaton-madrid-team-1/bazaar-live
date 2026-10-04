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
