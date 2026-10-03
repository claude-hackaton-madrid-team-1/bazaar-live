/** Serves the Vite build (dist/): hashed assets cached for a year, index.html never, SPA fallback. */
import { Buffer } from 'node:buffer'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt', '.webmanifest'])

interface Loaded {
  readonly raw: Buffer
  readonly gz: Buffer | null
  readonly type: string
}

export function createStatic(root: string): (req: IncomingMessage, res: ServerResponse, headers: Record<string, string>) => Promise<void> {
  const base = resolve(root)
  const memo = new Map<string, Loaded>()

  async function load(file: string): Promise<Loaded | null> {
    const cached = memo.get(file)
    if (cached) return cached
    try {
      if (!(await stat(file)).isFile()) return null
    } catch {
      return null
    }
    const raw = await readFile(file)
    const ext = extname(file)
    const loaded = { raw, gz: COMPRESSIBLE.has(ext) && raw.length > 1024 ? gzipSync(raw) : null, type: TYPES[ext] ?? 'application/octet-stream' }
    memo.set(file, loaded)
    return loaded
  }

  return async (req, res, headers) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname)
    const target = normalize(join(base, pathname))
    const inside = target === base || target.startsWith(base + sep)
    const direct = inside ? await load(target) : null
    // A missing hashed asset is a 404, not the SPA page (a module script must never get HTML).
    const file = direct ?? (pathname.startsWith('/assets/') ? null : await load(join(base, 'index.html')))
    if (!file) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(pathname.startsWith('/assets/') ? 'Not found' : 'Not built yet: run npm run build')
      return
    }
    const hashed = direct !== null && pathname.startsWith('/assets/')
    const gzip = file.gz !== null && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    const body = gzip && file.gz ? file.gz : file.raw
    res.writeHead(200, {
      ...headers,
      'Content-Type': file.type,
      'Content-Length': String(body.length),
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      Vary: 'Accept-Encoding',
      ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
