/**
 * Database rows → wire items. The views already expose only public columns; this is the second wall:
 * every value is re-checked and cleaned, because a row is untrusted data (a dealer's or a rival's text).
 */
import { cleanInt, cleanName, cleanQuote, cleanRef } from '../../shared/clean.ts'
import { EMPTY_ITEM, type Draft, type DuelLine, type OfferView, type Who } from '../../shared/transcript.ts'

type Row = Readonly<Record<string, unknown>>

/** A duel replay keeps its last words: the haggle's end is the story. */
export const MAX_DUEL_LINES = 12

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null

function whoOf(value: unknown): Who | null {
  return value === 'us' || value === 'them' ? value : null
}

/** bigint columns arrive as strings: a safe integer or null. */
function idOf(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null
}

/**
 * The priced offer, from the maker's cash: the maker pays (`bid`) when it gives cash, wants cash
 * (`ask`) when it takes cash. Cash on both sides, or none, names no price.
 */
function offerOf(row: Row, item: string | null): OfferView | null {
  const give = cleanInt(row.give_cash) ?? 0
  const want = cleanInt(row.want_cash) ?? 0
  if ((give > 0) === (want > 0)) return null
  const by: Who = row.offer_maker === 't01' ? 'us' : 'them'
  return { by, verb: give > 0 ? 'bid' : 'ask', price: give > 0 ? give : want, item, final: row.final === true }
}

export function threadItem(row: unknown): Draft | null {
  if (!isRow(row)) return null
  const eventId = idOf(row.event_id)
  const kind = row.kind === 'opened' ? 'thread_opened' : row.kind === 'message' ? 'thread_line' : row.kind === 'settlement' ? 'settlement' : null
  if (eventId === null || kind === null) return null
  const who = whoOf(row.speaker)
  const item = cleanRef(row.item_ref)
  return {
    ...EMPTY_ITEM,
    id: `f${eventId}`,
    kind,
    tick: cleanInt(row.tick),
    counterpart: cleanName(row.counterpart),
    who,
    thread: cleanInt(row.thread),
    item,
    // Our own words are not in the feed; whatever a row claims, only the other side has a quote.
    text: who === 'them' ? cleanQuote(row.text) : null,
    offer: kind === 'thread_line' ? offerOf(row, item) : null,
    price: kind === 'settlement' ? cleanInt(row.price) : null,
  }
}

function duelLine(row: Row): DuelLine | null {
  const n = cleanInt(row.n)
  const speaker = whoOf(row.speaker)
  if (n === null || n < 1 || speaker === null) return null
  return { n, speaker, tick: cleanInt(row.tick), price: cleanInt(row.price), days: cleanInt(row.days), text: cleanQuote(row.text) }
}

/**
 * Header rows (`live` / `closed`) and message rows of the same duels → items. A live duel yields the
 * in-progress notice and never its words; a closed one yields one replay with its lines in order.
 */
export function duelItems(headers: readonly unknown[], messages: readonly unknown[]): Draft[] {
  const lines = new Map<number, DuelLine[]>()
  for (const raw of messages) {
    if (!isRow(raw)) continue
    const duel = cleanInt(raw.duel)
    const line = duelLine(raw)
    if (duel !== null && line) lines.set(duel, [...(lines.get(duel) ?? []), line])
  }
  const items: Draft[] = []
  for (const raw of headers) {
    if (!isRow(raw)) continue
    const duel = cleanInt(raw.duel)
    if (duel === null) continue
    const common = {
      ...EMPTY_ITEM,
      counterpart: cleanName(raw.rival),
      item: cleanRef(raw.item),
      role: raw.role === 'buyer' || raw.role === 'seller' ? raw.role : null,
    } satisfies Draft
    if (raw.kind === 'live') {
      items.push({ ...common, id: `dl:${duel}`, kind: 'duel_live', status: 'live' })
    } else if (raw.kind === 'closed' && (raw.status === 'deal' || raw.status === 'no_deal')) {
      const ordered = [...(lines.get(duel) ?? [])].sort((a, b) => a.n - b.n).slice(-MAX_DUEL_LINES)
      items.push({ ...common, id: `dc:${duel}`, kind: 'duel_replay', status: raw.status, price: cleanInt(raw.final_price), lines: ordered })
    }
  }
  return items
}
