/**
 * The page's side of the wire: a server batch is still parsed like untrusted JSON, and every text and
 * name is cleaned again. Nothing here trusts the shape it was sent.
 */
import { cleanInt, cleanItem, cleanName, cleanQuote, cleanRef } from './clean.ts'
import type { Draft, DuelLine, ItemKind, OfferView, TranscriptBatch, TranscriptItem, Who } from './transcript.ts'

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const KINDS: readonly ItemKind[] = ['thread_opened', 'thread_line', 'settlement', 'duel_replay']
const whoOf = (v: unknown): Who | null => (v === 'us' || v === 'them' ? v : null)

function offerOf(raw: unknown): OfferView | null {
  if (!isRecord(raw)) return null
  const by = whoOf(raw.by)
  const price = cleanInt(raw.price)
  if (!by || price === null || (raw.verb !== 'bid' && raw.verb !== 'ask')) return null
  return { by, verb: raw.verb, price, item: cleanRef(raw.item), final: raw.final === true }
}

function lineOf(raw: unknown): DuelLine | null {
  if (!isRecord(raw)) return null
  const n = cleanInt(raw.n)
  const speaker = whoOf(raw.speaker)
  return n === null || !speaker ? null : { n, speaker, tick: cleanInt(raw.tick), price: cleanInt(raw.price), days: cleanInt(raw.days), text: cleanQuote(raw.text) }
}

export function parseItem(raw: unknown): TranscriptItem | null {
  if (!isRecord(raw)) return null
  const seq = cleanInt(raw.seq)
  const kind = KINDS.find((k) => k === raw.kind)
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 40 || seq === null || !kind) return null
  const who = whoOf(raw.who)
  const draft: Draft = {
    id: raw.id,
    kind,
    tick: cleanInt(raw.tick),
    counterpart: cleanName(raw.counterpart),
    who,
    thread: cleanInt(raw.thread),
    item: cleanItem(raw.item),
    text: who === 'them' ? cleanQuote(raw.text) : null,
    offer: offerOf(raw.offer),
    price: cleanInt(raw.price),
    status: raw.status === 'deal' || raw.status === 'no_deal' ? raw.status : null,
    role: raw.role === 'buyer' || raw.role === 'seller' ? raw.role : null,
    history: raw.history === true,
    lines: Array.isArray(raw.lines) ? raw.lines.slice(-12).flatMap((l) => lineOf(l) ?? []) : [],
  }
  return { ...draft, seq }
}

export function parseBatch(raw: unknown): TranscriptBatch | null {
  if (!isRecord(raw) || typeof raw.epoch !== 'string' || raw.epoch.length > 40 || !Array.isArray(raw.items)) return null
  const cursor = cleanInt(raw.cursor)
  if (cursor === null) return null
  return { epoch: raw.epoch, cursor, enabled: raw.enabled === true, replay: raw.replay === true, items: raw.items.slice(0, 200).flatMap((i) => parseItem(i) ?? []) }
}
