import type { Speaker } from '../../shared/tags.ts'
import type { AgentId } from '../model/events'

export type { Speaker }

export interface Line {
  readonly speaker: Speaker
  /** With expressive tags (`[laughs]`), stripped or converted by each TTS provider. */
  readonly text: string
  /** Shown in the captions but never voiced (a real quote in the other language). */
  readonly silent?: boolean
}

export type DealerId = 'abuela' | 'chato' | 'other'
export type Side = 'ask' | 'bid'

/** What the stage acts out for one beat. */
export type Cue =
  | { readonly kind: 'post'; readonly side: Side; readonly ref: string; readonly price: number | null }
  | { readonly kind: 'reprice'; readonly side: Side; readonly ref: string; readonly price: number | null }
  | { readonly kind: 'hold'; readonly side: Side; readonly ref: string; readonly count: number }
  | { readonly kind: 'cancel'; readonly side: Side; readonly ref: string }
  | { readonly kind: 'reach'; readonly ref: string; readonly price: number | null; readonly take: boolean }
  | { readonly kind: 'dealer'; readonly dealer: DealerId; readonly move: 'open' | 'bid' | 'accept' | 'walk'; readonly price: number | null }
  | { readonly kind: 'deal'; readonly big: boolean; readonly ref: string | null }
  | { readonly kind: 'fail'; readonly code: string }
  | { readonly kind: 'talk' }

export interface Beat {
  /** The source event's key (unique). */
  readonly id: string
  readonly agent: AgentId
  readonly tick: number | null
  /** Higher plays first and survives a busy tick; see PRIORITY. */
  readonly priority: number
  readonly lines: readonly Line[]
  readonly cue: Cue
  /** A guardrail said no: the stop sign. */
  readonly denied: boolean
  /** Jev's verdict label for the thought bubble, or null. */
  readonly jev: string | null
  /** The row did not go to the game (dry run, expired, skipped...). */
  readonly practice: boolean
  /** Why it did not go, for the stage's chip: `practice`, `blocked`, `too late`, `skipped`; null when sent. */
  readonly note: string | null
}

export const PRIORITY = {
  deal: 100,
  denied: 90,
  dealerAccept: 85,
  take: 80,
  dealer: 70,
  fail: 60,
  dealerBid: 60,
  post: 50,
  reprice: 45,
  cancel: 35,
  pass: 25,
  sent: 20,
  hold: 10,
  other: 5,
} as const
