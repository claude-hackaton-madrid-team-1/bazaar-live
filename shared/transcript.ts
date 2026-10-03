/**
 * The wire type between the server's poller and the page: one item per thing worth narrating.
 * Every field is already clean (shared/clean.ts): text is plain, refs and names are closed
 * vocabularies, numbers are whole primas. The page still treats it as untrusted data.
 */

export type ItemKind = 'thread_opened' | 'thread_line' | 'settlement' | 'duel_replay'

/** Who said it: our agent or the other side (a dealer, a rival). */
export type Who = 'us' | 'them'

/** A priced offer read from the structured offer, never from the words around it. */
export interface OfferView {
  /** Whose offer: ours or the dealer's. */
  readonly by: Who
  /** `bid`: the maker pays cash for a card. `ask`: the maker wants cash for a card. */
  readonly verb: 'bid' | 'ask'
  readonly price: number
  readonly item: string | null
  readonly final: boolean
}

export interface DuelLine {
  readonly n: number
  readonly speaker: Who
  readonly tick: number | null
  readonly price: number | null
  readonly days: number | null
  readonly text: string | null
}

export interface TranscriptItem {
  /** Stable key: the same event always has the same id (the page dedupes on it). */
  readonly id: string
  /** The server's cursor: grows by one per item it learned; `?since=` asks for items after it. */
  readonly seq: number
  readonly kind: ItemKind
  readonly tick: number | null
  /** A dealer handle (`chato`) or a rival's alias. */
  readonly counterpart: string | null
  readonly who: Who | null
  readonly thread: number | null
  /** A card ref (`LAV-08`), a pack or a duel's item name. */
  readonly item: string | null
  /** The real words, sanitized; null for our own messages (the feed has none) and for non-speech. */
  readonly text: string | null
  readonly offer: OfferView | null
  /** Settlement price, or a closed duel's final price. */
  readonly price: number | null
  readonly status: 'deal' | 'no_deal' | null
  /** In a duel, which side we played. */
  readonly role: 'buyer' | 'seller' | null
  readonly lines: readonly DuelLine[]
}

/** An item before the store gives it a cursor. */
export type Draft = Omit<TranscriptItem, 'seq'>

/** What GET /api/transcript and each SSE batch carry. */
export interface TranscriptBatch {
  /** Changes when the server restarts: cursors from another epoch mean nothing. */
  readonly epoch: string
  /** The newest seq the server has (also when `items` is empty). */
  readonly cursor: number
  readonly enabled: boolean
  /** True when `items` are history for a page that has no cursor yet: captions, not scenes. */
  readonly replay: boolean
  readonly items: readonly TranscriptItem[]
}

export const EMPTY_ITEM: Draft = {
  id: '', kind: 'thread_line', tick: null, counterpart: null, who: null, thread: null, item: null, text: null,
  offer: null, price: null, status: null, role: null, lines: [],
}
