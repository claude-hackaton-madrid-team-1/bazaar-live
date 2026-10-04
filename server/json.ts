import type { ServerResponse } from 'node:http'

/** Writes `body` as an uncached JSON answer, on top of the routes' security headers. */
export function json(res: ServerResponse, headers: Readonly<Record<string, string>>, status: number, body: unknown, extra: Readonly<Record<string, string>> = {}): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra })
  res.end(JSON.stringify(body))
}
