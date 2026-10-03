/**
 * The Approvals screen's configuration, from the environment. The feature is on only when all four are set:
 *
 *   APPROVER_PASSWORD      the screen's own login (16 characters or more; a shorter one counts as unset)
 *   BAZAAR_MCP_URL         bazaar-mcp's base URL, without /mcp (https, or http on localhost / *.railway.internal)
 *   BAZAAR_MCP_TOKEN       the bearer bazaar-mcp asks for
 *   BAZAAR_APPROVER_TOKEN  the human tools' own token (x-approver-token)
 *
 * Off, every /api/approver/* path answers like any unknown /api path. Values are never logged: only which names
 * are missing or wrong.
 */

export const MIN_PASSWORD = 16

export interface ApprovalsConfig {
  readonly password: string
  /** Base URL, no trailing slash and no /mcp. */
  readonly mcpUrl: string
  readonly mcpToken: string
  readonly approverToken: string
}

type Env = Readonly<Record<string, string | undefined>>

/** Plain http only where the hop never leaves the machine or Railway's private network. */
function privateHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.railway.internal')
}

/** The base URL as bazaar-mcp is reached, or null when it is not a URL we may send the tokens to. */
export function mcpBaseOf(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost(url.hostname))) return null
  // "…/mcp" or a trailing slash: the route is added once, by the client
  const path = url.pathname.replace(/\/+$/, '').replace(/\/mcp$/, '')
  return `${url.origin}${path}`
}

export function readApprovalsConfig(env: Env, log: (entry: Record<string, unknown>) => void = () => undefined): ApprovalsConfig | null {
  const value = (name: string) => env[name]?.trim() ?? ''
  const password = value('APPROVER_PASSWORD')
  const rawUrl = value('BAZAAR_MCP_URL')
  const mcpToken = value('BAZAAR_MCP_TOKEN')
  const approverToken = value('BAZAAR_APPROVER_TOKEN')
  const missing = [
    ['APPROVER_PASSWORD', password],
    ['BAZAAR_MCP_URL', rawUrl],
    ['BAZAAR_MCP_TOKEN', mcpToken],
    ['BAZAAR_APPROVER_TOKEN', approverToken],
  ].flatMap(([name, v]) => (v ? [] : [name]))
  if (missing.length === 4) {
    log({ event: 'approvals', enabled: false, reason: 'not_configured' })
    return null
  }
  if (missing.length > 0) {
    log({ event: 'approvals', enabled: false, reason: 'missing', missing })
    return null
  }
  if (password.length < MIN_PASSWORD) {
    log({ event: 'approvals', enabled: false, reason: 'password_too_short', min: MIN_PASSWORD })
    return null
  }
  const mcpUrl = mcpBaseOf(rawUrl)
  if (mcpUrl === null) {
    log({ event: 'approvals', enabled: false, reason: 'bad_mcp_url' })
    return null
  }
  log({ event: 'approvals', enabled: true })
  return { password, mcpUrl, mcpToken, approverToken }
}
