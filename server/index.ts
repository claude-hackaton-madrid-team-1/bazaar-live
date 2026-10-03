/**
 * Entry point: `node server/index.ts` (Node >= 22.18 runs TypeScript by stripping types).
 * Env: PORT (default 8080), ELEVENLABS_API_KEY, GEMINI_API_KEY, SHOW_DATABASE_URL (the read-only role
 * of db/show.sql; absent = no real transcript) and the optional model and voice overrides listed in README.md. With no key at all the show still speaks with Web Speech.
 * The game screens: BAZAAR_KEY (the real game) or BAZAAR_SIM=1 with BAZAAR_SIM_KEY (the simulator, default
 * sim-team1); GAME_VIEW_TOKEN to require a token on their stream; GAME_POLL_MS (default 5000). No key = no feed.
 * The Learn screen reads db/learn.sql's views with the same SHOW_DATABASE_URL, behind the same GAME_VIEW_TOKEN;
 * the Movements screen reads db/history.sql's views the same way.
 * With SHOW_DATABASE_URL (or a game key and the database), our agents' decisions join that stream (GUARDRAIL_* override the caps shown).
 * With SHOW_DATABASE_URL the game screens read db/game.sql's views instead of the game's API (GAME_SOURCE=api
 * forces the API); views missing → the API relay. One pool for all of them: the role holds four connections.
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { startDecisions } from './game/decisions.ts'
import { startGame } from './game/start.ts'
import { startHistory } from './history/start.ts'
import { startLearn } from './learn/start.ts'
import { readLimits } from './limits.ts'
import { availableProviders, readProviderConfig } from './providers.ts'
import { startShowPool } from './transcript/pg.ts'
import { startTranscript } from './transcript/start.ts'

const DEFAULT_PORT = 8080
const port = Number(process.env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const config = readProviderConfig(process.env)
const log = (entry: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
}
// The one pool on SHOW_DATABASE_URL, shared by the transcript, the game screens, /api/learn and /api/history; null without it.
const show = startShowPool(process.env, log)
// SHOW_DATABASE_URL absent or wrong → off, and the show runs as it always did.
const transcript = startTranscript(process.env, log, show)
// Our database's views first; no database and no BAZAAR_KEY (or a refused one) → the game screens say so.
const game = startGame(process.env, log, undefined, show)
// Without SHOW_DATABASE_URL (or before db/learn.sql is applied) the Learn screen says so; nothing else changes.
const learn = startLearn(process.env, log, show)
// Our agents' decisions (db/agent_decisions.sql) into the game stream: on the shared pool and the game hub, else off.
const decisions = startDecisions(process.env, { db: transcript.db, hub: game.hub, log, secrets: transcript.secrets })
// Our cash and what moved it (db/history.sql), on the shared pool: no connection of its own.
const history = startHistory(process.env, log, show)
const perAddress = Number(process.env.TRANSCRIPT_STREAMS_PER_ADDRESS)
const server = createServer(
  createApp({
    config, distDir, limits: readLimits(process.env), log,
    transcript: {
      ...transcript,
      maxPerAddress: Number.isInteger(perAddress) && perAddress > 0 ? perAddress : undefined,
      vouchQuotes: process.env.TRANSCRIPT_SPEAK_QUOTES === '1',
    },
    game,
    learn,
    history,
  }),
)

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), msg: 'bazaar-live listening', port, tts: availableProviders(config) })}\n`)
})

const shutdown = (): void => {
  decisions.stop()
  void transcript.stop()
  game.stop()
  history.stop()
  void learn.stop()
  void show?.pool.end().catch(() => undefined)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
