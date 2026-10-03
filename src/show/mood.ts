/**
 * A small deterministic "mood" for each line: calm, eager, sarcastic or triumphant, chosen from the
 * situation alone (what just happened, whether the stage is busy or has been quiet for long, what
 * mood the last lines had), never from random numbers. The same inputs always give the same moods.
 */
import { MOODS, type Mood } from '../../shared/bank.ts'

/** What a line is about: an event the agents produced, or a situation the stage reads from /health. */
export type Topic =
  | 'post' | 'reprice' | 'hold' | 'cancel' | 'take' | 'pass' | 'late' | 'practice' | 'denied' | 'fail'
  | 'dealer_open' | 'dealer_bid' | 'dealer_accept' | 'dealer_walk' | 'deal' | 'sent' | 'unknown'
  | 'duel_offer' | 'duel_accept' | 'duel_hold'
  | 'doors_closed' | 'paused' | 'offline' | 'quiet' | 'tick' | 'new_page' | 'market_test' | 'simulator' | 'dry'

/** The two moods that fit a topic best, first choice first. */
const BASE: Readonly<Record<Topic, readonly [Mood, Mood]>> = {
  post: ['eager', 'calm'],
  reprice: ['eager', 'sarcastic'],
  hold: ['calm', 'sarcastic'],
  cancel: ['calm', 'sarcastic'],
  take: ['triumphant', 'eager'],
  pass: ['calm', 'sarcastic'],
  late: ['sarcastic', 'calm'],
  practice: ['sarcastic', 'calm'],
  denied: ['sarcastic', 'calm'],
  fail: ['sarcastic', 'calm'],
  dealer_open: ['eager', 'sarcastic'],
  dealer_bid: ['calm', 'eager'],
  dealer_accept: ['triumphant', 'eager'],
  dealer_walk: ['sarcastic', 'calm'],
  deal: ['triumphant', 'eager'],
  sent: ['calm', 'eager'],
  unknown: ['calm', 'eager'],
  duel_offer: ['eager', 'sarcastic'],
  duel_accept: ['triumphant', 'eager'],
  duel_hold: ['calm', 'sarcastic'],
  doors_closed: ['calm', 'eager'],
  paused: ['calm', 'sarcastic'],
  offline: ['calm', 'sarcastic'],
  quiet: ['calm', 'sarcastic'],
  tick: ['calm', 'eager'],
  new_page: ['eager', 'triumphant'],
  market_test: ['eager', 'sarcastic'],
  simulator: ['calm', 'sarcastic'],
  dry: ['sarcastic', 'calm'],
}

/** A stage that has said nothing for this long gets drier. */
export const BORED_AFTER_MS = 3 * 60_000

export interface MoodInput {
  readonly topic: Topic
  /** How long since the last real event (ms), or null. */
  readonly quietMs?: number | null
  /** The director's queue is long: the stage is in a hurry. */
  readonly busy?: boolean
  /** The moods of the last lines said, oldest first. */
  readonly recent?: readonly Mood[]
  /** The row did not reach the game (practice). */
  readonly practice?: boolean
}

const QUIET_TOPICS: ReadonlySet<Topic> = new Set(['quiet', 'tick', 'doors_closed', 'paused', 'hold', 'sent', 'unknown'])
const NEUTRAL_TOPICS: ReadonlySet<Topic> = new Set(['post', 'reprice', 'hold', 'cancel', 'sent'])

/** Every mood, the most fitting first. */
export function moodsFor(input: MoodInput): readonly Mood[] {
  let [first, second] = BASE[input.topic]
  if (input.practice && first !== 'sarcastic') [first, second] = ['sarcastic', first]
  // In a hurry, neutral moves get an eager voice; after a long silence the idle talk gets drier.
  if (input.busy && NEUTRAL_TOPICS.has(input.topic) && first !== 'eager') [first, second] = ['eager', first]
  if ((input.quietMs ?? 0) >= BORED_AFTER_MS && QUIET_TOPICS.has(input.topic) && second === 'sarcastic') [first, second] = [second, first]
  // The same tone three times running sounds like a script: let the second choice speak.
  const recent = input.recent ?? []
  const lastTwo = recent.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((m) => m === first)) [first, second] = [second, first]
  return [first, second, ...MOODS.filter((m) => m !== first && m !== second)]
}
