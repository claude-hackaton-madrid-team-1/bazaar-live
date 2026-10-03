/**
 * Entry point: `node server/index.ts` (Node >= 22.18 runs TypeScript by stripping types).
 * Env: PORT (default 8080), ELEVENLABS_API_KEY, GEMINI_API_KEY and the optional model and voice
 * overrides listed in README.md. With no key at all the show still speaks with Web Speech.
 */
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp, readLimits } from './app.ts'
import { availableProviders, readProviderConfig } from './providers.ts'

const DEFAULT_PORT = 8080
const port = Number(process.env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const config = readProviderConfig(process.env)
const server = createServer(createApp({ config, distDir, limits: readLimits(process.env) }))

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), msg: 'bazaar-live listening', port, tts: availableProviders(config) })}\n`)
})

const shutdown = (): void => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
