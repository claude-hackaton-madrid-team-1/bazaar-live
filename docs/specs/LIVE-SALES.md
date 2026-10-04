# LIVE-SALES — Sales conversations and recorded voice

The dedicated backend `sales` worker must appear in Agent activity and Live agents, using the existing authenticated game relay. Show counterpart, venue, recorded messages and both structured offer legs. A sent proposal is not a settlement. Reuse the existing seller ElevenLabs configuration, with a Sales caption.

## Implementation and boundaries

- `shared/decisions.ts`, `db/agent_decisions.sql`: distinct Sales identity. Coordinator must reapply the additive view migration before rollout.
- `src/ui/SalesPanel.tsx`, `src/ui/sales.ts`: bounded observed team conversations beside the stage. Missing text is explicit. Locked and replay views hide private conversations; rival text is escaped and never voiced.
- `shared/sales.ts`, `server/app.ts`: private real speech requires the existing game-view token, DB source, exact recorded own text and an acknowledged Sales decision linked to the thread. Caller-invented text, rival text, wrong speaker and missing/wrong token are denied before cache lookup. No new provider, credential, game read or game write.
- `server/game/dbsource.ts`: recover late stored own words for at most 100 event IDs and eight game ticks. Emit a single quote enrichment; client fills the original message without duplicating its structured offer. Speech retains existing language, cadence and history controls.
- `src/game/mock.ts`: clearly synthetic Sales exchange for visual QA. It claims only a proposal, never a settlement.

## Validation

- Full unit gate: `1261 passed`; isolated Postgres: `135 passed`.
- Late-enrichment/auth/UI and speech-ordering focused run: `81 passed`; TypeScript clean. Final replay-history regression is recorded in the PR body.
- Final complete gate and browser evidence are recorded in the PR body.

## Honest implementation report

Implementation, unit/SQL boundaries and populated desktop browser rendering are verified (3/4 criteria, 75%). Production migration plus actual Sales audio remain coordinator rollout acceptance. Chrome showed the Demo Sales ↔ t18 / v28 card, recorded text and RET-01 → LAT-02 + 3 P terms without a framework overlay. Console errors were confined to an unrelated browser wallet extension.

## Unverified

Production Sales messages, migration, deployment, and actual paid ElevenLabs playback require coordinator rollout. The initial thread-open decision lacks a thread ID until a subsequent offer: Sales attribution starts at the first acknowledged decision carrying it. Longer-than-eight-tick delayed writes are deliberately not chased indefinitely.

## Could not do

No production mutations or paid audio requests were performed in this frontend slice.
