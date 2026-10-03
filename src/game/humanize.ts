/**
 * What the game screens need to read the agents' ids and texts as people say them. No words here: these
 * functions take the agents' strings apart (a guardrail's denial, a counterparty id, a duel item, a tick) and the
 * page's language turns the parts into a sentence (`strings.ts`, section `hum`). Every screen goes through them,
 * so a rule, an agent or a dealer has the same name everywhere.
 */
import { nameOfRef } from './cards.ts'
import { setOf } from './game.ts'
import type { State } from './state.ts'
import type { GameStrings } from './strings.ts'
import { AGENTS, type AgentName } from '../../shared/decisions.ts'

/** A guardrail's denial taken apart: the three shapes guardrails.check() prints, numbers kept. */
export type Denial =
  | { readonly shape: 'price'; readonly rule: string; readonly price: number; readonly cap: number }
  | { readonly shape: 'cash'; readonly cash: number; readonly cost: number; readonly floor: number }
  | { readonly shape: 'spend'; readonly rule: string; readonly spent: number; readonly cost: number; readonly cap: number }

const NUM = '(-?\\d+(?:\\.\\d+)?)'
const PRICE = new RegExp(`price ${NUM} > (?:[a-z ]*?cap ${NUM} \\(([a-z_]+) [^)]*\\)|([a-z_]+) ${NUM})`)
const CASH = new RegExp(`cash ${NUM} - ${NUM} < cash_floor ${NUM}`)
const SPEND = new RegExp(`spend ${NUM} \\+ ${NUM} > ([a-z_]+) ${NUM}`)

/**
 * `price 27 > max_price_uncommon 26`, `cash 81 - 79 < cash_floor 50`, `spend 128 + 24 > max_spend_per_game_hour 150`,
 * and the dealer's lifted cap (`price 97 > dealer final cap 96 (max_price_rare 80 lifted)`); null for anything else,
 * so the caller falls back to the rule's name.
 */
export function parseDenial(text: string | null | undefined): Denial | null {
  if (!text) return null
  const p = PRICE.exec(text)
  if (p) {
    const [, price, liftedCap, liftedRule, rule, cap] = p
    return { shape: 'price', rule: liftedRule ?? rule ?? 'max_price', price: Number(price), cap: Number(liftedCap ?? cap) }
  }
  const c = CASH.exec(text)
  if (c) return { shape: 'cash', cash: Number(c[1]), cost: Number(c[2]), floor: Number(c[3]) }
  const s = SPEND.exec(text)
  if (s) return { shape: 'spend', rule: s[3] ?? 'max_spend_per_game_hour', spent: Number(s[1]), cost: Number(s[2]), cap: Number(s[4]) }
  return null
}

/** The rarity a `max_price_<rarity>` rule caps, or null. */
export const rarityOfRule = (rule: string): string | null => /^max_price_([a-z]+)$/.exec(rule)?.[1] ?? null

/** The game's three dealers by their stall names: proper nouns, the same in both languages. */
const DEALERS: Readonly<Record<string, string>> = { abuela: 'Abuela Carmen', chato: 'El Chato', pilar: 'Doña Pilar' }

/** Who an id names: a dealer, a rival of the duels, a team (`t06`), a venue (`v03`), or something we keep as written. */
export type Who =
  | { readonly kind: 'dealer'; readonly name: string }
  | { readonly kind: 'rival'; readonly name: string }
  | { readonly kind: 'team'; readonly n: number }
  | { readonly kind: 'venue'; readonly n: number }
  | { readonly kind: 'other'; readonly name: string }

const title = (words: string): string => words.replace(/\b\p{L}/gu, (c) => c.toUpperCase())

export function whoOf(id: string): Who {
  const key = id.trim()
  const lower = key.toLowerCase()
  const dealer = DEALERS[lower]
  if (dealer) return { kind: 'dealer', name: dealer }
  if (/^rival[_ ]/i.test(key)) return { kind: 'rival', name: title(key.replace(/_/g, ' ').toLowerCase()) }
  const team = /^t(\d{1,3})$/i.exec(key)
  if (team) return { kind: 'team', n: Number(team[1]) }
  const venue = /^v(\d{1,3})$/i.exec(key)
  if (venue) return { kind: 'venue', n: Number(venue[1]) }
  return { kind: 'other', name: key }
}

/** What a decision is about: a card (with its name), a duel (with its rival when we know it), a pack, or text. */
export type ItemOf =
  | { readonly kind: 'card'; readonly ref: string; readonly name: string | null }
  | { readonly kind: 'duel'; readonly id: number; readonly rival: string | null }
  | { readonly kind: 'pack'; readonly pack: string }
  | { readonly kind: 'other'; readonly text: string }

export function itemOf(item: string, rivalOf: (duel: number) => string | null | undefined = () => null): ItemOf {
  const duel = /^duel[:#](\d+)$/i.exec(item.trim())
  if (duel) {
    const id = Number(duel[1])
    return { kind: 'duel', id, rival: rivalOf(id) ?? null }
  }
  if (setOf(item) && /^[A-Z]{3}-\d{2}$/.test(item)) return { kind: 'card', ref: item, name: nameOfRef(item) }
  if (/^sobre[_ ]/i.test(item)) return { kind: 'pack', pack: item.replace(/^sobre[_ ]/i, '').replace(/_/g, ' ') }
  return { kind: 'other', text: item }
}

/**
 * How long ago a tick was, from the newest tick we know (never the wall clock, so it reads the same on every
 * screen and in a frozen timeline): the ticks, and the seconds when the clock says how long a tick lasts. Null for
 * a tick ahead of ours (another day's, after the clock started again): the caller says the tick instead of "now".
 */
export function ago(now: number, tick: number, tickSeconds: number | null | undefined): { readonly ticks: number; readonly seconds: number | null } | null {
  if (tick > now) return null
  const ticks = now - tick
  return { ticks, seconds: tickSeconds && tickSeconds > 0 ? ticks * tickSeconds : null }
}

/** A 0–1 share as a whole percentage (0.29 → 29), null for anything that is not one. */
export const percent = (share: number | null | undefined): number | null =>
  share == null || !Number.isFinite(share) ? null : Math.round(share * 100)

/** An id the page has no word for, made readable: `max_counterparty_share` → `max counterparty share`. */
export const spaced = (id: string): string => id.replace(/_/g, ' ')

/** A label from a table, or the id with spaces: an id we have not seen yet still reads as words. */
export const labelOf = (table: Readonly<Record<string, string>>, id: string): string => table[id] ?? spaced(id)

const isAgent = (a: string): a is AgentName => (AGENTS as readonly string[]).includes(a)

/** "Buyer" for `taker`, in the page's language; an id we do not know stays as written. */
export const agentName = (t: GameStrings, agent: string): string => (isAgent(agent) ? t.hum.agents[agent] : agent)

export const ruleName = (t: GameStrings, rule: string | null): string => labelOf(t.hum.rules, rule ?? 'other')

export const kindName = (t: GameStrings, kind: string): string => labelOf(t.hum.kinds, kind)

/** "El Chato" for `chato`, "Team 6" for `t06`. */
export const whoName = (t: GameStrings, id: string): string => t.hum.who(whoOf(id))

/** Why a guardrail said no, as a sentence when its text has numbers we read, else the rule's name. */
export const denialText = (t: GameStrings, rule: string | null, text: string | null): string => {
  const d = parseDenial(text)
  return d ? t.hum.denial(d) : ruleName(t, rule)
}

/** A duel's rival by name, for a `duel:NNNN` item. */
export const rivalOf = (t: GameStrings, s: State) => (id: number): string | null => {
  const rival = s.duels[id]?.rival
  return rival ? whoName(t, rival) : null
}

/** "3 min ago" for a tick, from the newest tick the state knows. */
export const agoText = (t: GameStrings, s: State, tick: number, now: number): string => {
  const a = ago(now, tick, s.tickSeconds)
  return a ? t.hum.ago(a.ticks, a.seconds) : `${t.tick} ${tick}`
}

/** A number of ticks as game time: "~2 min". */
export const spanText = (t: GameStrings, s: State, ticks: number): string => t.hum.span(ticks, ticks * s.tickSeconds)
