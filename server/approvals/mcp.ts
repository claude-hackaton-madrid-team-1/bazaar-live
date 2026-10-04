/**
 * One call to a bazaar-mcp human tool: a stateless JSON-RPC `tools/call` on POST {BAZAAR_MCP_URL}/mcp, no initialize,
 * with the bearer and the approver token. The answer is the tool's text, parsed as JSON. Every failure becomes one of
 * two errors, neither carrying the upstream's words: `McpUnavailable` (the service, its HTTP status or a malformed
 * reply) and `McpToolError` (the tool said isError: a short plain message we never pass on). Never retried here.
 */
import { Buffer } from 'node:buffer'
import type { ApprovalsConfig } from './config.ts'

export const MCP_TIMEOUT_MS = 8000
const PROTOCOL_VERSION = '2025-06-18'
const MAX_REPLY = 512 * 1024

export type HumanTool = 'approvals' | 'approve' | 'revoke' | 'operator_propose' | 'operator_review' | 'operator_approve' | 'operator_execute' | 'operator_snapshot'

/** bazaar-mcp did not answer as the contract says: down, refused (401/403/429), timed out, or a malformed reply. */
export class McpUnavailable extends Error {
  /** The HTTP status bazaar-mcp answered, 0 when it never answered. */
  readonly status: number
  constructor(status: number, reason: string) {
    super(`bazaar-mcp unavailable: ${reason}`)
    this.status = status
  }
}

/** The tool answered with isError: invalid arguments, an unknown tool, a rate limit. */
export class McpToolError extends Error {
  readonly rateLimited: boolean
  constructor(rateLimited: boolean) {
    super('bazaar-mcp tool error')
    this.rateLimited = rateLimited
  }
}

export interface McpClientDeps {
  readonly config: ApprovalsConfig
  readonly fetchImpl: typeof fetch
  readonly timeoutMs?: number
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The reply's body as text, refused past MAX_REPLY bytes without buffering more than that. */
async function cappedText(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_REPLY) throw new Error('too large')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_REPLY) {
      await reader.cancel().catch(() => undefined)
      throw new Error('too large')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** The JSON-RPC message in a reply: a JSON body, or (Streamable HTTP's other form) the SSE event that carries our id. */
function messageOf(body: string, contentType: string, id: number): unknown {
  if (!contentType.includes('text/event-stream')) return JSON.parse(body)
  const events = body.split(/\r?\n\r?\n/).map((event) =>
    event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n'),
  )
  for (const data of events) {
    if (!data) continue
    const message: unknown = JSON.parse(data)
    if (isObject(message) && message.id === id) return message
  }
  throw new Error('no reply for our id')
}

/** The tool's text, when the message is a JSON-RPC result for `id` with one text content. */
function toolTextOf(message: unknown, id: number): { text: string; isError: boolean } | null {
  if (!isObject(message) || message.jsonrpc !== '2.0' || message.id !== id || !isObject(message.result)) return null
  const { content, isError } = message.result
  if (!Array.isArray(content)) return null
  const first: unknown = content.find((c) => isObject(c) && c.type === 'text')
  if (!isObject(first) || typeof first.text !== 'string') return null
  return { text: first.text, isError: isError === true }
}

export function createMcpClient(deps: McpClientDeps): (tool: HumanTool, args: Record<string, unknown>) => Promise<unknown> {
  let nextId = 1
  const endpoint = `${deps.config.mcpUrl}/mcp`
  return async (tool, args) => {
    const id = nextId++
    let res: Response
    try {
      res = await deps.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': PROTOCOL_VERSION,
          authorization: `Bearer ${deps.config.mcpToken}`,
          ...(tool === 'operator_propose' || tool === 'operator_snapshot' ? {} : { 'x-approver-token': deps.config.approverToken }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }),
        signal: AbortSignal.timeout(deps.timeoutMs ?? MCP_TIMEOUT_MS),
        redirect: 'error',
      })
    } catch {
      throw new McpUnavailable(0, 'no answer')
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined)
      throw new McpUnavailable(res.status, 'status')
    }
    let reply: { text: string; isError: boolean } | null
    try {
      const body = await cappedText(res)
      reply = toolTextOf(messageOf(body, res.headers.get('content-type') ?? '', id), id)
    } catch {
      throw new McpUnavailable(200, 'malformed')
    }
    if (reply === null) throw new McpUnavailable(200, 'malformed')
    if (reply.isError) throw new McpToolError(/^rate limited/i.test(reply.text.trim()))
    try {
      return JSON.parse(reply.text) as unknown
    } catch {
      throw new McpUnavailable(200, 'malformed')
    }
  }
}
