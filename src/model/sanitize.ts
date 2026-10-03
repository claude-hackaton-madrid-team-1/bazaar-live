/**
 * The boundary: untrusted JSON from the agents' /events, /health and /state, turned into the show's
 * typed model, keeping ONLY the public fields.
 *
 * The allow-lists mirror bazaar PR #69 (`src/bazaar_agent/agents/status.py`: `public_decision`,
 * `public_execution`), so the show never displays our values, limits, reasons or Jev numbers, even
 * while an agent still publishes the full row. A field not listed here never reaches the stage.
 */
import type {
  AgentHealth,
  AgentId,
  AgentState,
  GuardrailLabel,
  OpenOffer,
  PublicDecision,
  PublicExecution,
  PublicInputs,
  PublicMove,
  ShowEvent,
} from './events.ts'

type Json = Record<string, unknown>

const MAX_TEXT = 64

/** Inputs published on a sent row (approved on a live agent), as in PR #69's INPUT_FIELDS + price. */
const SENT_INPUTS = new Set([
  'dealer', 'thread', 'item', 'ref', 'card', 'rarity', 'side', 'venue', 'offer_id', 'maker',
  'ask', 'her_ask', 'fee', 'final', 'price',
])
/** Inputs published on a row that was not sent: the card and where, nothing else. */
const UNSENT_INPUTS = new Set(['item', 'ref', 'card', 'venue', 'side'])
/** Maker Jev states nest the card one level down. */
const INPUT_GROUPS = ['offer', 'listing'] as const

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function int(value: unknown): number | undefined {
  const n = num(value)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean ? clean.slice(0, MAX_TEXT) : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function isAgent(value: unknown): value is AgentId {
  return value === 'taker' || value === 'maker'
}

function guardrailLabel(value: unknown): GuardrailLabel {
  const raw = typeof value === 'string' ? value : ''
  if (raw === 'allowed') return 'allowed'
  return raw.startsWith('denied') ? 'denied' : '-'
}

function mode(value: unknown): 'live' | 'dry' | null {
  return value === 'live' || value === 'dry' ? value : null
}

/** Scalar inputs from the row and its `offer` / `listing` part, filtered by the allow-list. */
function pickInputs(raw: unknown, allowed: ReadonlySet<string>): PublicInputs {
  if (!isRecord(raw)) return {}
  const groups = [raw, ...INPUT_GROUPS.map((g) => raw[g])].filter(isRecord)
  const flat: Json = {}
  for (const group of groups) {
    for (const [k, v] of Object.entries(group)) {
      if (allowed.has(k) && (v === null || ['string', 'number', 'boolean'].includes(typeof v))) flat[k] = v
    }
  }
  return dropUndefined({
    dealer: text(flat.dealer),
    thread: int(flat.thread),
    item: text(flat.item),
    ref: text(flat.ref),
    card: text(flat.card),
    rarity: text(flat.rarity),
    side: text(flat.side),
    venue: text(flat.venue),
    offerId: int(flat.offer_id),
    maker: text(flat.maker),
    ask: num(flat.ask),
    herAsk: num(flat.her_ask),
    fee: num(flat.fee),
    final: bool(flat.final),
    price: num(flat.price),
  })
}

function pickMove(raw: unknown): PublicMove {
  if (!isRecord(raw)) return {}
  const want = isRecord(raw.want) ? raw.want : undefined
  return dropUndefined({
    kind: text(raw.kind),
    price: num(raw.price),
    accept: int(raw.accept),
    openThread: text(raw.open_thread),
    cancel: int(raw.cancel),
    hold: int(raw.hold),
    reprice: int(raw.reprice),
    wantCash: num(want?.cash),
    venue: text(raw.venue),
  })
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

/** PR #69's `public_decision`: a row that was not sent shows only its card, where and status. */
export function publicDecision(payload: unknown): PublicDecision | null {
  if (!isRecord(payload)) return null
  const kind = text(payload.kind)
  if (!kind) return null
  const status = text(payload.status) ?? 'unknown'
  const dryRun = bool(payload.dry_run)
  const sent = status === 'approved' && dryRun === false
  const jev = payload.jev
  return {
    decisionId: sent ? orNull(int(payload.decision_id)) : null,
    tick: orNull(int(payload.tick)),
    kind,
    chosen: sent ? orNull(bool(payload.chosen)) : null,
    status,
    dryRun: orNull(dryRun),
    sent,
    threadId: sent ? orNull(int(payload.thread_id)) : null,
    guardrail: guardrailLabel(payload.guardrail),
    jevVerdict: sent && isRecord(jev) ? orNull(text(jev.verdict)) : null,
    inputs: pickInputs(payload.inputs, sent ? SENT_INPUTS : UNSENT_INPUTS),
    move: sent ? pickMove(payload.move) : {},
  }
}

/** PR #69's `public_execution`: the request we sent and how it ended, never the game's answer body. */
export function publicExecution(payload: unknown): PublicExecution | null {
  if (!isRecord(payload)) return null
  const method = text(payload.method) ?? text(payload.sdk_method)
  if (!method) return null
  const errorCode = text(payload.error_code) ?? null
  const request = isRecord(payload.request) ? payload.request : {}
  const response = isRecord(payload.response) ? payload.response : {}
  return {
    decisionId: orNull(int(payload.decision_id)),
    tick: orNull(int(payload.tick)),
    method,
    ok: payload.ok === undefined ? errorCode === null : payload.ok === true && errorCode === null,
    errorCode,
    createdId: orNull(int(payload.created_id) ?? int(response.id)),
    request: dropUndefined({
      offer: int(request.offer),
      thread: int(request.thread),
      with: text(request.with),
      price: num(request.price),
      venue: text(request.venue),
    }),
  }
}

/** One WS message (already JSON-parsed) to a ShowEvent, or null when it is not one we show. */
export function parseEnvelope(raw: unknown, fallbackAgent?: AgentId): ShowEvent | null {
  if (!isRecord(raw)) return null
  const id = int(raw.id)
  const type = text(raw.type)
  const agentField = isRecord(raw.payload) ? (raw.agent ?? raw.payload.agent) : raw.agent
  const agent = isAgent(agentField) ? agentField : fallbackAgent
  if (id === undefined || !type || !agent) return null
  const tick = orNull(int(raw.tick))
  const t = orNull(num(raw.t))
  const key = `${agent}|${id}|${type}|${tick ?? '-'}|${t ?? '-'}`
  const base = { key, id, agent, tick, t }
  switch (type) {
    case 'agent.tick':
      return { ...base, type, mode: isRecord(raw.payload) ? mode(raw.payload.mode) : null }
    case 'agent.decision': {
      const decision = publicDecision(raw.payload)
      return decision ? { ...base, type, decision } : null
    }
    case 'agent.execution': {
      const execution = publicExecution(raw.payload)
      return execution ? { ...base, type, execution } : null
    }
    default:
      return null
  }
}

function targetMode(raw: unknown): 'real' | 'simulator' | null {
  const mode = isRecord(raw) ? text(raw.mode) : undefined
  return mode === 'real' || mode === 'simulator' ? mode : null
}

export function parseHealth(raw: unknown): AgentHealth | null {
  if (!isRecord(raw)) return null
  return {
    ok: raw.ok === true,
    agent: text(raw.agent) ?? '?',
    mode: mode(raw.mode),
    tick: orNull(int(raw.tick)),
    doors: orNull(text(raw.doors)),
    paused: orNull(bool(raw.paused)),
    nextOpens: orNull(text(raw.next_opens)),
    tickSeconds: orNull(num(raw.tick_seconds)),
    serverTick: orNull(int(raw.server_tick)),
    target: targetMode(raw.target),
  }
}

function parseOffer(raw: unknown): OpenOffer | null {
  if (!isRecord(raw)) return null
  const id = int(raw.id)
  const ref = text(raw.ref)
  if (id === undefined || !ref) return null
  return { id, ref, side: text(raw.side) ?? 'ask', price: orNull(num(raw.price)), venue: orNull(text(raw.venue)) }
}

/** GET /state: the header facts and the maker's open offers (public on the board). */
export function parseState(raw: unknown): AgentState | null {
  if (!isRecord(raw)) return null
  const offers = Array.isArray(raw.open_offers) ? raw.open_offers : null
  return {
    agent: text(raw.agent) ?? '?',
    mode: mode(raw.mode),
    tick: orNull(int(raw.tick)),
    team: orNull(text(raw.team)),
    openOffers: offers ? offers.map(parseOffer).filter((o): o is OpenOffer => o !== null).slice(0, 30) : null,
  }
}
