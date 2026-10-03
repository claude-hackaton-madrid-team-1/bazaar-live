/** The agents' public, read-only status servers (bazaar/docs/services.md). Browser and proxy share them. */

export const TAKER_HTTP = 'https://bazaar-taker-production.up.railway.app'
export const MAKER_HTTP = 'https://bazaar-maker-production.up.railway.app'

export const toWs = (http: string): string => `${http.replace(/^http/, 'ws')}/events`

/** Where the page may connect: the proxy itself plus both agents (the server's CSP `connect-src`). */
export const CONNECT_SOURCES: readonly string[] = [TAKER_HTTP, MAKER_HTTP, toWs(TAKER_HTTP), toWs(MAKER_HTTP)]
