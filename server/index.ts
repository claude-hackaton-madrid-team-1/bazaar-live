/**
 * Entry point: `node server/index.ts` (Node >= 22.18 runs TypeScript by stripping types).
 * Env: PORT (default 8080), ELEVENLABS_API_KEY, GEMINI_API_KEY, SHOW_DATABASE_URL (the read-only role
 * of db/show.sql; absent = no real transcript) and the optional model and voice overrides listed in README.md. With no key at all the show still speaks with Web Speech.
 * The game screens: BAZAAR_KEY (the real game) or BAZAAR_SIM=1 with BAZAAR_SIM_KEY (the simulator, default
 * sim-team1); GAME_VIEW_TOKEN to require a token on their stream; GAME_POLL_MS (default 5000). No key = no feed.
 * The Learn screen reads db/learn.sql's views with the same SHOW_DATABASE_URL, behind the same GAME_VIEW_TOKEN;
 * the Movements screen reads db/history.sql's views the same way, the Strategy screen db/strategy.sql's and the Rivals
 * screen db/rival_albums.sql's. All four are told on the game stream when their rows change (`pages.changed`) and read again as soon as our agents' sockets
 * ring (PAGES_WAKE=off: their timers only).
 * /api/injections reads db/injections.sql's view on the same pool, public (the show has no token), never voiced.
 * With the game stream on, the taker's and the maker's /health join it every 10 s (AGENT_HEALTH=off turns it off;
 * RAILWAY_SERVICE_BAZAAR_TAKER_URL / _MAKER_URL override where they are).
 * With SHOW_DATABASE_URL (or a game key and the database), our agents' decisions join that stream (GUARDRAIL_* override the caps shown).
 * With SHOW_DATABASE_URL the game screens read db/game.sql's views instead of the game's API (GAME_SOURCE=api
 * forces the API); views missing → the API relay. One pool for all of them: the role holds four connections.
 * With SHOW_DATABASE_URL the server also listens to the agents' /events sockets and reads at once on a live event
 * (the 3 s poll stays): AGENTS_WS=off turns that off, =watch only logs; AGENT_TAKER_WS_URL / _MAKER_WS_URL override.
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.ts'
import { createDealerNames, dealersUrl } from './dealers.ts'
import { startAgentsWs } from './game/agentsws.ts'
import { startDecisions } from './game/decisions.ts'
import { startHealth } from './game/health.ts'
import { startPages } from './game/pages.ts'
import { startGame } from './game/start.ts'
import { startHistory } from './history/start.ts'
import { startInjections } from './injections/start.ts'
import { startLearn } from './learn/start.ts'
import { startRivals } from './rivals/start.ts'
import { startStrategy } from './strategy/start.ts'
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
// Whether we run our own venue (the floor's bond reserve) comes from the Strategy poller's last read, asked at each poll.
const decisions = startDecisions(process.env, { db: transcript.db, hub: game.hub, log, secrets: transcript.secrets, venue: () => ourVenue() })
// Our agents' /health (taker, maker) every 10 s into the same stream, so the page never calls them itself.
const health = startHealth(process.env, { hub: game.hub, log })
// The agents' /events: a live event reads the game views and the decisions now instead of at the next 3 s poll.
const agentsWs = startAgentsWs(process.env, { database: show !== null, game, decisions, log })
// Our cash and what moved it (db/history.sql), on the shared pool: no connection of its own.
const history = startHistory(process.env, log, show)
// What we aim for, why we hold what we hold and why we do not buy (db/strategy.sql), on the same pool.
const strategy = startStrategy(process.env, log, show)
function ourVenue(): boolean | null {
  const me = strategy.snapshot().me
  return me ? me.venue !== null : null
}
// What each rival holds by the public feed, its rank and what it chases (db/rival_albums.sql), on the same pool.
const rivals = startRivals(process.env, log, show)
// The prompt-injection attempts our agents recorded (db/injections.sql), on the same pool: public, never voiced.
const injections = startInjections(log, show)
// /history, /learn, /strategy and /rivals told on the game stream when their rows change, and read as soon as our agents' sockets ring.
const pages = startPages(process.env, {
  hub: game.hub, agents: agentsWs, log,
  pollers: { history: history.poller, learn: learn.poller, strategy: strategy.poller, rivals: rivals.poller },
})
const perAddress = Number(process.env.TRANSCRIPT_STREAMS_PER_ADDRESS)
const app = createApp({
  config, distDir, limits: readLimits(process.env), log,
  transcript: {
    ...transcript,
    maxPerAddress: Number.isInteger(perAddress) && perAddress > 0 ? perAddress : undefined,
    vouchQuotes: process.env.TRANSCRIPT_SPEAK_QUOTES === '1',
  },
  game: { ...game, sockets: agentsWs.sockets },
  learn,
  history,
  strategy,
  rivals,
  injections,
  dealerNames: createDealerNames({ url: dealersUrl(process.env) }),
})
const server = createServer(app)
// The game stream's WebSocket (GET /api/game/ws); every other upgrade is answered 404.
server.on('upgrade', app.upgrade)

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), msg: 'bazaar-live listening', port, tts: availableProviders(config) })}\n`)
})

const shutdown = (): void => {
  agentsWs.stop()
  decisions.stop()
  health.stop()
  void transcript.stop()
  game.stop()
  pages.stop()
  history.stop()
  strategy.stop()
  rivals.stop()
  injections.stop()
  void learn.stop()
  void show?.pool.end().catch(() => undefined)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
