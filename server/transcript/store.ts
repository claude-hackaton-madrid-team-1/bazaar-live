/**
 * What the server knows of the conversations: a bounded ring of items, each with a cursor (`seq`),
 * deduped by id, and a fan-out to whoever is streaming. In memory only: a restart starts a new epoch
 * and the poller backfills the latest lines again.
 */
import { randomUUID } from 'node:crypto'
import { detectLang } from '../../shared/detect-lang.ts'
import type { Lang } from '../../shared/lang.ts'
import { dealerSpeaker, type Speaker } from '../../shared/tags.ts'
import type { Draft, TranscriptItem } from '../../shared/transcript.ts'

export interface StoreOptions {
  /** Items kept for `?since=`. */
  readonly ring?: number
  /** Items a new page gets as history. */
  readonly history?: number
  /** Ids remembered for dedupe (longer than the ring, so the poller's overlap never re-adds). */
  readonly seen?: number
  /** Quotes remembered for the TTS proxy to vouch for. */
  readonly quotes?: number
}

type Listener = (items: readonly TranscriptItem[]) => void

export class TranscriptStore {
  readonly epoch = randomUUID().slice(0, 8)
  private ring: TranscriptItem[] = []
  private readonly ids = new Set<string>()
  private readonly quotes = new Map<string, { readonly lang: Lang; readonly speaker: Speaker }>()
  private readonly listeners = new Set<Listener>()
  private seq = 0
  private readonly opts: Required<StoreOptions>

  constructor(options: StoreOptions = {}) {
    this.opts = { ring: 500, history: 40, seen: 4000, quotes: 2000, ...options }
  }

  get cursor(): number {
    return this.seq
  }

  /** Adds what is new (by id), tells subscribers, and returns it. */
  add(drafts: readonly Draft[]): TranscriptItem[] {
    const fresh: TranscriptItem[] = []
    for (const draft of drafts) {
      if (this.ids.has(draft.id)) continue
      this.remember(this.ids, draft.id)
      this.seq += 1
      const item: TranscriptItem = { ...draft, seq: this.seq }
      fresh.push(item)
      this.indexQuotes(item)
    }
    if (fresh.length === 0) return fresh
    this.ring = [...this.ring, ...fresh].slice(-this.opts.ring)
    this.listeners.forEach((l) => l(fresh))
    return fresh
  }

  /**
   * Items after `cursor`, at most `limit`. No cursor, or one this server has not reached (it
   * restarted), gets the recent history instead.
   */
  since(cursor: number | null, limit: number = this.opts.ring): TranscriptItem[] {
    if (cursor === null || cursor > this.seq) return this.ring.slice(-this.opts.history)
    return this.ring.filter((i) => i.seq > cursor).slice(0, limit)
  }

  /** Whether an item with this id was already added (the poller skips re-reading what it has). */
  has(id: string): boolean {
    return this.ids.has(id)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * What the TTS proxy may voice of a real conversation: the language and the speaker of a DEALER's quote
   * this server read from the database. A rival's duel text is never in here, and a quote is bound to the
   * character who said it (a quote cannot be voiced as our buyer).
   */
  quote(text: string): { readonly lang: Lang; readonly speaker: Speaker } | undefined {
    return this.quotes.get(text)
  }

  private remember(set: Set<string>, id: string): void {
    set.add(id)
    if (set.size > this.opts.seen) {
      const oldest = set.values().next().value
      if (oldest !== undefined) set.delete(oldest)
    }
  }

  private indexQuotes(item: TranscriptItem): void {
    const speaker = item.kind === 'thread_line' && item.who === 'them' ? dealerSpeaker(item.counterpart) : null
    const text = item.text
    if (!speaker || !text || this.quotes.has(text)) return
    const lang = detectLang(text)
    if (lang === 'unknown') return
    this.quotes.set(text, { lang, speaker })
    if (this.quotes.size > this.opts.quotes) {
      const oldest = this.quotes.keys().next().value
      if (oldest !== undefined) this.quotes.delete(oldest)
    }
  }
}
