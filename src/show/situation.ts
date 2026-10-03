/**
 * What the stage knows about the world besides the events: the agents' public /health (doors, paused,
 * next_opens, tick_seconds, mode, target) and /state (tick), plus a couple of one-shot facts the engine
 * notices in the events (a new neighbourhood page, a Market Test session). From it the show picks what
 * to talk about when nothing is happening, so the characters know they are idle.
 */
import type { Lang } from '../../shared/lang.ts'
import { etaWords, opensWords } from '../../shared/vocab.ts'
import type { AgentHealth, AgentId } from '../model/events'
import type { FeedStatus } from '../net/feed'
import type { Topic } from './mood'

export interface Narration {
  readonly health: Readonly<Record<AgentId, AgentHealth | null>>
  readonly feeds: Readonly<Record<AgentId, FeedStatus>>
  /** The current time (ms). */
  readonly now: number
  /** The game tick the agents last handled, or null. */
  readonly tick: number | null
  /** A neighbourhood page nobody has announced yet (`El Retiro`), or null. */
  readonly freshHood: string | null
  /** A Market Test session started and nobody has announced it. */
  readonly freshMarketTest: boolean
}

export type Situation =
  | { readonly topic: 'doors_closed'; readonly eta: string | null; readonly opens: string | null }
  | { readonly topic: 'paused' | 'offline' | 'quiet' | 'simulator' | 'dry' | 'market_test' }
  | { readonly topic: 'new_page'; readonly hood: string }
  | { readonly topic: 'tick'; readonly tick: number }

const TIME_ZONE = 'Europe/Madrid'

interface Parts {
  readonly day: string
  readonly weekday: number
  readonly hour: number
  readonly minute: number
}

/** A moment as the clock on the wall in Madrid shows it. */
export function madridParts(ms: number): Parts | null {
  if (!Number.isFinite(ms)) return null
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const get = (type: string): string => fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? ''
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { day: `${get('year')}-${get('month')}-${get('day')}`, weekday, hour: Number(get('hour')), minute: Number(get('minute')) }
}

const DAY_MS = 86_400_000

/** How many Madrid calendar days from `now` to `target` (0 = same day). */
function dayOffset(now: Parts, target: Parts): number {
  return Math.round((Date.parse(`${target.day}T00:00:00Z`) - Date.parse(`${now.day}T00:00:00Z`)) / DAY_MS)
}

/** The doors-closed facts from the first agent that reports closed doors: the countdown and the hour. */
export function doorsFacts(health: AgentHealth, now: number, lang: Lang): { eta: string | null; opens: string | null } {
  const at = health.nextOpens ? Date.parse(health.nextOpens) : NaN
  if (!Number.isFinite(at) || at <= now) return { eta: null, opens: null }
  const eta = etaWords(Math.ceil((at - now) / 60_000), lang)
  const target = madridParts(at)
  const here = madridParts(now)
  const opens = target && here ? opensWords(dayOffset(here, target), target.weekday, target.hour, target.minute, lang) : null
  return { eta, opens }
}

const both = (n: Narration): AgentHealth[] => [n.health.taker, n.health.maker].filter((h): h is AgentHealth => h !== null)

/**
 * What is most worth saying right now. News (a new page, a Market Test) first, then the state of the
 * game (nobody reachable, closed doors, a pause); otherwise the ambient ones take turns by `turn`, so a quiet stage does not
 * say the same kind of thing twice in a row.
 */
export function situationOf(n: Narration, lang: Lang, turn: number): Situation {
  // News comes out of live events, so the game is up: it outranks every state below.
  if (n.freshHood) return { topic: 'new_page', hood: n.freshHood }
  if (n.freshMarketTest) return { topic: 'market_test' }
  const healths = both(n)
  const noFeed = n.feeds.taker !== 'open' && n.feeds.maker !== 'open'
  if (healths.length === 0 && noFeed) return { topic: 'offline' }
  const closed = healths.find((h) => h.doors === 'closed')
  if (closed) return { topic: 'doors_closed', ...doorsFacts(closed, n.now, lang) }
  if (healths.some((h) => h.paused === true)) return { topic: 'paused' }
  const ambient: Situation[] = [{ topic: 'quiet' }]
  if (n.tick !== null) ambient.push({ topic: 'tick', tick: n.tick })
  if (healths.some((h) => h.mode === 'dry')) ambient.push({ topic: 'dry' })
  if (healths.some((h) => h.target === 'simulator')) ambient.push({ topic: 'simulator' })
  return ambient[turn % ambient.length] as Situation
}

export const topicOf = (s: Situation): Topic => s.topic
