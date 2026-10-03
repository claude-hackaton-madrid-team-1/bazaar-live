/**
 * What a bank of lines is made of: variants (one short BUYER ↔ SELLER exchange each) tagged with the
 * mood they carry, grouped under a bank key such as `POST_ASK`. Every language has a pack with all keys.
 */

/** `dealer` becomes the dealer on stage (`abuela`, `chato`) or the narrator for an unknown one. */
export type Role = 'buyer' | 'seller' | 'dealer' | 'narrator'
export type Row = readonly [Role, string]
export type Template = readonly Row[]

export const MOODS = ['calm', 'eager', 'sarcastic', 'triumphant'] as const
export type Mood = (typeof MOODS)[number]

export interface Variant {
  readonly mood: Mood
  readonly lines: Template
}
export type Bank = readonly Variant[]

export const BANK_KEYS = [
  'POST_ASK', 'POST_ASK_NO_PRICE', 'POST_BID', 'POST_BID_NO_PRICE', 'REPRICE', 'REPRICE_NO_PRICE', 'HOLD', 'HOLD_MANY',
  'CANCEL_SELLER', 'CANCEL_BUYER', 'TAKE', 'PASS', 'LATE', 'SKIP_SELLER', 'PRACTICE', 'DENIED_BUYER', 'DENIED_SELLER',
  'DEALER_OPEN_KIND', 'DEALER_OPEN_CHATO', 'DEALER_BID_KIND', 'DEALER_BID_CHATO', 'DEALER_BID_NO_PRICE',
  'DEALER_ACCEPT_KIND', 'DEALER_ACCEPT_CHATO', 'DEALER_WALK_KIND', 'DEALER_WALK_CHATO', 'DEAL',
  'SENT_LIST_OFFER', 'SENT_CANCEL', 'SENT_OPEN_THREAD', 'SENT_SAY', 'SENT_CLOSE_THREAD', 'SENT_OTHER',
  'FAIL', 'UNKNOWN', 'DUEL_OFFER', 'DUEL_ACCEPT', 'DUEL_HOLD',
  // Situations: what they say when nothing is happening, by what the agents' /health and /state say.
  'DOORS_CLOSED', 'DOORS_CLOSED_BARE', 'PAUSED', 'QUIET', 'TICK', 'NEW_PAGE', 'MARKET_TEST', 'SIMULATOR', 'DRY', 'OFFLINE',
] as const
export type BankKey = (typeof BANK_KEYS)[number]
export type Pack = Readonly<Record<BankKey, Bank>>

/** Row and variant builders, so a pack reads like a script. */
export const S = (text: string): Row => ['seller', text]
export const B = (text: string): Row => ['buyer', text]
export const D = (text: string): Row => ['dealer', text]
export const N = (text: string): Row => ['narrator', text]
export const v = (mood: Mood, ...lines: Row[]): Variant => ({ mood, lines })
