/**
 * What the Strategy screen answers, from GET /api/strategy (db/strategy.sql): what we aim for (the album pages our
 * affinity rewards and the money levers), why the taker does not buy what is on sale (the one rule that binds now,
 * then every blocked buy by the surplus it gave up), why we hold every card we hold, and how often Jev said no.
 *
 * The caps are read live from the guardrail texts (`cash 81 - 79 < cash_floor 50` names the floor and its value); a
 * cap no denial has named yet comes from ../guardrailsDoc.ts. Facts only: the screen never advises changing a rule.
 */
import type { CatalogCard, OpenAsk, StrategyDecision, StrategySnapshot } from '../../../shared/strategy.ts'
import { SETS } from '../game.ts'
import { GUARDRAILS_DOC } from '../guardrailsDoc.ts'

/** The window the screen reads: the last game ticks of the current run. */
export const WINDOW_TICKS = 300

/** A tick this far above the one after it (newest first) belongs to an earlier day's clock. */
const NEW_RUN = 100

// ── rules ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RuleId = 'cash_floor' | 'max_spend_per_game_hour' | 'max_price' | 'block_buying_held_cards' | 'jev' | 'other' | 'unrecorded'

/** One rule a refused decision broke, as its guardrail text says it. */
export interface Broken {
  readonly rule: RuleId
  /** max_price: the rarity it caps. */
  readonly rarity: string | null
  /** The rule's value in the text (50 for `cash_floor 50`), or null. */
  readonly limit: number | null
  /** A rule we do not name: its words, cut short. */
  readonly text: string | null
}

/** Money rules first: they are what moves when cash comes back. */
const PRIORITY: readonly RuleId[] = ['cash_floor', 'max_spend_per_game_hour', 'max_price', 'block_buying_held_cards', 'other', 'jev', 'unrecorded']

const n = (s: string | undefined): number | null => (s === undefined ? null : Number(s))

/** The rules a refused decision broke, in PRIORITY order; [] for one that went through. */
export function brokenRules(d: StrategyDecision): Broken[] {
  const out: Broken[] = []
  if (d.guardrail) {
    for (const part of d.guardrail.replace(/^denied:\s*/, '').split(/;\s*/)) {
      let m: RegExpMatchArray | null
      if ((m = part.match(/cash_floor (\d+)/))) out.push({ rule: 'cash_floor', rarity: null, limit: n(m[1]), text: null })
      else if ((m = part.match(/max_spend_per_game_hour (\d+)/))) out.push({ rule: 'max_spend_per_game_hour', rarity: null, limit: n(m[1]), text: null })
      else if ((m = part.match(/max_price_([a-z]+) (\d+)/))) out.push({ rule: 'max_price', rarity: m[1] ?? null, limit: n(m[2]), text: null })
      else if (part.includes('block_buying_held_cards')) out.push({ rule: 'block_buying_held_cards', rarity: null, limit: null, text: null })
      else if (part.trim()) out.push({ rule: 'other', rarity: null, limit: null, text: part.trim().slice(0, 80) })
    }
  } else if (d.status === 'rejected' || d.allowed === false) {
    const jev = d.jevVerdict !== null && d.jevVerdict !== 'yes' && d.jevVerdict !== 'accept' && (d.jevReason === 'below_threshold' || /^jev\b/.test(d.reason ?? ''))
    out.push({ rule: jev ? 'jev' : 'unrecorded', rarity: null, limit: null, text: null })
  }
  return out.sort((a, b) => PRIORITY.indexOf(a.rule) - PRIORITY.indexOf(b.rule))
}

export interface RuleValue {
  readonly value: number
  /** Read from a guardrail text in our database (true) or from GUARDRAILS.md (false). */
  readonly live: boolean
}

export interface Rules {
  readonly cashFloor: RuleValue
  readonly maxSpend: RuleValue
  readonly maxPrice: Readonly<Record<string, RuleValue>>
  readonly jevBar: RuleValue
}

/** The caps now: the newest guardrail text that names each one wins, else GUARDRAILS.md. `decisions`: newest first. */
export function rulesOf(decisions: readonly StrategyDecision[]): Rules {
  const doc = (value: number): RuleValue => ({ value, live: false })
  let cashFloor: RuleValue | null = null
  let maxSpend: RuleValue | null = null
  let jevBar: RuleValue | null = null
  const maxPrice: Record<string, RuleValue> = {}
  for (const d of decisions) {
    for (const b of brokenRules(d)) {
      if (b.limit === null) continue
      if (b.rule === 'cash_floor') cashFloor ??= { value: b.limit, live: true }
      if (b.rule === 'max_spend_per_game_hour') maxSpend ??= { value: b.limit, live: true }
      if (b.rule === 'max_price' && b.rarity && !maxPrice[b.rarity]) maxPrice[b.rarity] = { value: b.limit, live: true }
    }
    const bar = d.reason?.match(/^jev \w+ \([\d.]+ < ([\d.]+)/)
    if (bar && !jevBar) jevBar = { value: Number(bar[1]), live: true }
  }
  for (const [rarity, cap] of Object.entries(GUARDRAILS_DOC.maxPrice)) maxPrice[rarity] ??= doc(cap)
  return {
    cashFloor: cashFloor ?? doc(GUARDRAILS_DOC.cashFloor),
    maxSpend: maxSpend ?? doc(GUARDRAILS_DOC.maxSpendPerHour),
    maxPrice,
    jevBar: jevBar ?? doc(GUARDRAILS_DOC.jevBar),
  }
}

// ── the window ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The tick now: our snapshot's, else the newest decision's. */
export function nowTickOf(s: StrategySnapshot): number | null {
  return s.me?.tick ?? s.decisions[0]?.tick ?? null
}

/** The decisions of the last WINDOW_TICKS ticks of the current run (newest first, as they come). */
export function windowOf(decisions: readonly StrategyDecision[], now: number | null, span = WINDOW_TICKS): StrategyDecision[] {
  if (now === null) return []
  const out: StrategyDecision[] = []
  let prev: number | null = null
  for (const d of decisions) {
    if (prev !== null && d.tick > prev + NEW_RUN) break
    prev = d.tick
    if (d.tick > now + NEW_RUN) continue
    if (d.tick < now - span) break
    out.push(d)
  }
  return out
}

// ── cards ────────────────────────────────────────────────────────────────────────────────────────────────────────

const setOfRef = (ref: string): string => ref.split('-')[0] ?? ref

const round1 = (v: number): number => Math.round(v * 10) / 10

export const catalogIndex = (cards: readonly CatalogCard[]): ReadonlyMap<string, CatalogCard> => new Map(cards.map((c) => [c.card, c]))

/** How many copies of each card we hold. */
function heldCounts(s: StrategySnapshot): Map<string, number> {
  const held = new Map<string, number>()
  for (const c of s.me?.cards ?? []) held.set(c.ref, (held.get(c.ref) ?? 0) + 1)
  return held
}

/** The cheapest ask of another team open now, per card. */
function cheapestOthers(asks: readonly OpenAsk[], team: string | null): Map<string, OpenAsk> {
  const best = new Map<string, OpenAsk>()
  for (const a of asks) {
    if (a.ours || (a.to !== null && a.to !== team)) continue
    const b = best.get(a.card)
    if (!b || a.price < b.price) best.set(a.card, a)
  }
  return best
}

// ── 1. what we aim for ───────────────────────────────────────────────────────────────────────────────────────────

export interface MissingCard {
  readonly ref: string
  readonly name: string | null
  readonly rarity: string | null
}

export interface TargetPage {
  readonly set: string
  readonly name: string
  readonly affinity: number | null
  readonly have: number
  readonly of: number
  readonly complete: boolean
  readonly missing: readonly MissingCard[]
}

export interface Plan {
  /** Incomplete pages of the sets our affinity boosts (> 1), the highest affinity first, then the closest. */
  readonly targets: readonly TargetPage[]
  readonly complete: readonly TargetPage[]
  /** Sets whose cards are spares (affinity at most 1), and whether their only copies are protected. */
  readonly spareSets: readonly { readonly set: string; readonly name: string; readonly affinity: number; readonly protected: boolean }[]
  readonly venue: string | null
}

/** Every page of ours, with the page cards it still lacks. */
function pagesOf(s: StrategySnapshot): TargetPage[] {
  const held = heldCounts(s)
  const aff = s.me?.affinity ?? {}
  const pageCards = s.cards.filter((c) => c.page)
  return (s.me?.pages ?? []).map((p) => ({
    set: p.set,
    name: p.name ?? p.set,
    affinity: aff[p.set] ?? null,
    have: p.have,
    of: p.of,
    complete: p.complete,
    missing: pageCards.filter((c) => c.set === p.set && !held.has(c.card)).map((c) => ({ ref: c.card, name: c.name, rarity: c.rarity })),
  }))
}

export function planOf(s: StrategySnapshot): Plan {
  const pages = pagesOf(s)
  const targets = pages
    .filter((p) => !p.complete && (p.affinity ?? 0) > 1)
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0) || b.have / b.of - a.have / a.of)
  const names = new Map(pages.map((p) => [p.set, p.name]))
  const spareSets = Object.entries(s.me?.affinity ?? {})
    .filter(([, a]) => a <= 1)
    .sort((a, b) => a[1] - b[1])
    .map(([set, affinity]) => ({ set, name: names.get(set) ?? SETS[set]?.name ?? set, affinity, protected: GUARDRAILS_DOC.protectPageSets.includes(set) }))
  return { targets, complete: pages.filter((p) => p.complete), spareSets, venue: s.me?.venue ?? null }
}

export interface Levers {
  readonly cash: number | null
  readonly floor: RuleValue
  /** Cash above the floor: what a buy may spend before the floor refuses it. */
  readonly cashRoom: number | null
  readonly spent: number | null
  readonly maxSpend: RuleValue
  readonly spendRoom: number | null
  /** The smaller of the two: what we can still buy with now. */
  readonly room: number | null
  readonly caps: readonly { readonly rarity: string; readonly cap: RuleValue }[]
}

const RARITIES = ['common', 'uncommon', 'rare', 'pack']

export function leversOf(s: StrategySnapshot, rules: Rules): Levers {
  const cash = s.me?.cash ?? null
  const spent = s.spend?.spent ?? null
  const cashRoom = cash === null ? null : cash - rules.cashFloor.value
  const spendRoom = spent === null ? null : rules.maxSpend.value - spent
  const rooms = [cashRoom, spendRoom].filter((v): v is number => v !== null)
  const caps = Object.entries(rules.maxPrice)
    .sort((a, b) => (RARITIES.indexOf(a[0]) + 1 || 99) - (RARITIES.indexOf(b[0]) + 1 || 99))
    .map(([rarity, cap]) => ({ rarity, cap }))
  return { cash, floor: rules.cashFloor, cashRoom, spent, maxSpend: rules.maxSpend, spendRoom, room: rooms.length ? Math.max(0, Math.min(...rooms)) : null, caps }
}

// ── 2. why we do not buy ─────────────────────────────────────────────────────────────────────────────────────────

export interface RuleCount {
  readonly rule: RuleId
  readonly rarity: string | null
  readonly limit: number | null
  readonly text: string | null
  readonly count: number
}

/** The same card refused again and again: one row. */
export interface BlockedBuy {
  readonly card: string
  readonly name: string | null
  readonly rarity: string | null
  readonly count: number
  readonly firstTick: number
  readonly lastTick: number
  /** The cheapest it was offered at, fee included. */
  readonly price: number | null
  /** What it was worth to us (the newest refusal's value). */
  readonly value: number | null
  /** value − price: what we gave up. */
  readonly surplus: number | null
  /** The rule that refused the newest attempt (money first). */
  readonly main: Broken | null
  readonly rules: readonly RuleCount[]
  /** We hold it now (bought another way since). */
  readonly heldNow: boolean
  /** The cheapest ask of another team open for it now. */
  readonly onSaleNow: number | null
}

/** A taker decision that wanted to buy and did not: a refused accept, a dealer step a rule stopped. */
const isBlockedBuy = (d: StrategyDecision): boolean =>
  d.agent === 'taker' && d.kind !== 'team_open' && d.card !== null && (d.guardrail !== null || (d.status === 'rejected' && /^(accept_ask|dealer_|pack_)/.test(d.kind)))

export function blockedBuys(s: StrategySnapshot, win: readonly StrategyDecision[]): BlockedBuy[] {
  const held = heldCounts(s)
  const cards = catalogIndex(s.cards)
  const sale = cheapestOthers(s.asks, s.me?.team ?? null)
  const groups = new Map<string, StrategyDecision[]>()
  for (const d of win) if (isBlockedBuy(d)) groups.set(d.card ?? '', [...(groups.get(d.card ?? '') ?? []), d])
  const out: BlockedBuy[] = []
  for (const [card, rows] of groups) {
    const newest = rows[0]
    if (!newest) continue
    const prices = rows.map((r) => r.total ?? r.price).filter((p): p is number => p !== null)
    const price = prices.length ? Math.min(...prices) : null
    const value = rows.find((r) => r.value !== null)?.value ?? null
    const counts = new Map<string, RuleCount>()
    for (const r of rows) {
      for (const b of brokenRules(r)) {
        const key = `${b.rule}|${b.rarity ?? ''}|${b.text ?? ''}`
        const c = counts.get(key)
        counts.set(key, { ...b, limit: c?.limit ?? b.limit, count: (c?.count ?? 0) + 1 })
      }
    }
    const info = cards.get(card)
    out.push({
      card,
      name: info?.name ?? null,
      rarity: newest.rarity ?? info?.rarity ?? null,
      count: rows.length,
      firstTick: rows.at(-1)?.tick ?? newest.tick,
      lastTick: newest.tick,
      price,
      value,
      surplus: value !== null && price !== null ? round1(value - price) : null,
      main: brokenRules(newest)[0] ?? null,
      rules: [...counts.values()].sort((a, b) => b.count - a.count),
      heldNow: held.has(card),
      onSaleNow: sale.get(card)?.price ?? null,
    })
  }
  // what we still lack first, then by what we gave up
  return out.sort((a, b) => Number(a.heldNow) - Number(b.heldNow) || (b.surplus ?? -Infinity) - (a.surplus ?? -Infinity) || b.count - a.count)
}

export interface Binding {
  /** The rule that stops buys now; `none`: nothing was refused in the window; `cleared`: the money rule that refused
   *  the newest buy no longer binds (cash came back) and no other rule refused it. */
  readonly rule: RuleId | 'none' | 'cleared'
  readonly rarity: string | null
  readonly limit: number | null
  readonly text: string | null
  /** The newest refused buy that still matters (a card we lack). */
  readonly latest: BlockedBuy | null
}

/**
 * The ONE rule that binds now. A money rule wins while the newest refusal's price is still above what we can spend
 * (cash and the hour's spend move, so it is re-checked against the levers now); else the rule that refused the
 * newest buy we still lack; else the most frequent one.
 */
export function bindingOf(blocked: readonly BlockedBuy[], levers: Levers): Binding {
  const open = blocked.filter((b) => !b.heldNow)
  const latest = [...open].sort((a, b) => b.lastTick - a.lastTick)[0] ?? null
  if (!latest) return { rule: 'none', rarity: null, limit: null, text: null, latest: null }
  const isMoney = (r: { rule: RuleId }) => r.rule === 'cash_floor' || r.rule === 'max_spend_per_game_hour'
  const money = latest.rules.filter(isMoney)
  if (money.length && latest.price !== null && levers.room !== null && latest.price > levers.room) {
    const cashBinds = levers.cashRoom !== null && (levers.spendRoom === null || levers.cashRoom <= levers.spendRoom)
    const rule = cashBinds ? 'cash_floor' : 'max_spend_per_game_hour'
    return { rule, rarity: null, limit: (rule === 'cash_floor' ? levers.floor : levers.maxSpend).value, text: null, latest }
  }
  // the money is there now: only a rule that does not move with cash still stops this buy
  const rest = money.length ? [...latest.rules.filter((r) => !isMoney(r))].sort((a, b) => PRIORITY.indexOf(a.rule) - PRIORITY.indexOf(b.rule)) : null
  if (rest && !rest.length) return { rule: 'cleared', rarity: null, limit: null, text: null, latest }
  const main = rest ? rest[0] : (latest.main ?? latest.rules[0])
  return { rule: main?.rule ?? 'unrecorded', rarity: main?.rarity ?? null, limit: main?.limit ?? null, text: main?.text ?? null, latest }
}

/** Facts for the one-line hint: how many cards we lack that one rule refused, the surplus they carried, the cheapest. */
export interface Unblock {
  readonly rule: 'cash_floor' | 'max_spend_per_game_hour' | 'max_price'
  readonly rarity: string | null
  readonly limit: number | null
  readonly cards: number
  readonly surplus: number
  readonly cheapest: BlockedBuy | null
  /** cash_floor: the cash the cheapest one needs (its price + the floor). */
  readonly cashNeeded: number | null
}

export function unblockOf(binding: Binding, blocked: readonly BlockedBuy[], levers: Levers): Unblock | null {
  if (binding.rule !== 'cash_floor' && binding.rule !== 'max_spend_per_game_hour' && binding.rule !== 'max_price') return null
  const rule = binding.rule
  const hit = blocked.filter((b) => !b.heldNow && b.rules.some((r) => r.rule === rule && (rule !== 'max_price' || r.rarity === binding.rarity)))
  if (!hit.length) return null
  const cheapest = [...hit].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0] ?? null
  return {
    rule,
    rarity: binding.rarity,
    limit: binding.limit,
    cards: hit.length,
    surplus: round1(hit.reduce((sum, b) => sum + Math.max(0, b.surplus ?? 0), 0)),
    cheapest,
    cashNeeded: rule === 'cash_floor' && cheapest?.price != null ? cheapest.price + levers.floor.value : null,
  }
}

/** What other teams have on sale now (asks anyone, or we, may take), read against what we lack. */
export interface Board {
  readonly total: number
  /** Asks for page cards we lack in the sets we aim for, the cheapest per card: its price against the cap and what we can spend. */
  readonly missing: readonly { readonly card: string; readonly name: string | null; readonly rarity: string | null; readonly price: number; readonly cap: number | null; readonly room: number | null }[]
  /** How many page cards the pages we aim for still lack, on sale or not. */
  readonly wanted: number
  /** Asks for cards we already hold (a second copy is worth a quarter or less to us). */
  readonly held: number
  /** Asks for cards of sets our affinity does not boost (at most 1). */
  readonly notChased: number
  /** Asks for cards outside the album pages. */
  readonly offAlbum: number
}

export function boardOf(s: StrategySnapshot, rules: Rules, levers: Levers): Board {
  const held = heldCounts(s)
  const cards = catalogIndex(s.cards)
  const team = s.me?.team ?? null
  const aff = s.me?.affinity ?? {}
  const chased = (card: string) => (aff[setOfRef(card)] ?? 0) > 1
  const others = s.asks.filter((a) => !a.ours && (a.to === null || a.to === team))
  let heldN = 0
  let notChased = 0
  let off = 0
  for (const a of others) {
    if (held.has(a.card)) heldN++
    else if (cards.get(a.card)?.page !== true) off++
    else if (!chased(a.card)) notChased++
  }
  const missing = [...cheapestOthers(s.asks, team).values()]
    .filter((a) => !held.has(a.card) && cards.get(a.card)?.page === true && chased(a.card))
    .sort((a, b) => a.price - b.price)
    .map((a) => {
      const rarity = a.rarity ?? cards.get(a.card)?.rarity ?? null
      return { card: a.card, name: cards.get(a.card)?.name ?? null, rarity, price: a.price, cap: rarity ? (rules.maxPrice[rarity]?.value ?? null) : null, room: levers.room }
    })
  const wanted = planOf(s).targets.reduce((sum, p) => sum + p.missing.length, 0)
  return { total: others.length, missing, wanted, held: heldN, notChased, offAlbum: off }
}

export interface JevVeto {
  readonly count: number
  readonly bar: number
  /** The newest one: the swap it refused and Jev's confidence. */
  readonly give: string | null
  readonly want: string | null
  readonly value: number | null
  readonly tick: number
}

/** The taker's swaps Jev refused in the window (below its bar): one line. */
export function jevVetoOf(win: readonly StrategyDecision[], rules: Rules): JevVeto | null {
  const vetoed = win.filter((d) => d.agent === 'taker' && brokenRules(d).some((b) => b.rule === 'jev'))
  const newest = vetoed[0]
  if (!newest) return null
  return { count: vetoed.length, bar: rules.jevBar.value, give: newest.giveCard, want: newest.card, value: newest.jevValue, tick: newest.tick }
}

// ── 3. why we hold ───────────────────────────────────────────────────────────────────────────────────────────────

export interface KeptCard {
  readonly ref: string
  readonly name: string | null
  readonly rarity: string | null
  readonly value: number | null
}

/** A page of ours: the copies we keep for it, and what it still lacks. */
export interface KeptPage extends TargetPage {
  readonly cards: readonly KeptCard[]
  /** Kept for the page bonus (a set our affinity boosts), or because the set's page is protected. */
  readonly why: 'boost' | 'protected'
}

export type SpareWhy =
  | { readonly kind: 'two_copies' }
  | { readonly kind: 'other_copy_on_sale' }
  | { readonly kind: 'maker'; readonly reason: string; readonly tick: number }
  | { readonly kind: 'no_ask' }

export interface Spare {
  readonly ref: string
  readonly name: string | null
  readonly rarity: string | null
  /** Spare copies of it (all we hold but the one a page keeps). */
  readonly copies: number
  readonly value: number | null
  /** Our open ask (the cheapest when several). */
  readonly ask: number | null
  readonly onSale: number
  /** The cheapest ask of another team for it now, and the tape's last fill. */
  readonly bestOther: number | null
  readonly lastFill: number | null
  /** The maker's own why for its newest ask on it. */
  readonly makerWhy: string | null
  /** Why the copies not on sale are not (null when every spare is on sale). */
  readonly why: SpareWhy | null
}

export interface Holdings {
  readonly pages: readonly KeptPage[]
  readonly onSale: readonly Spare[]
  readonly notListed: readonly Spare[]
  readonly copies: number
}

export function holdingsOf(s: StrategySnapshot, win: readonly StrategyDecision[]): Holdings {
  const me = s.me
  const cards = catalogIndex(s.cards)
  const plan = planOf(s)
  const aff = me?.affinity ?? {}
  const byRef = new Map<string, { value: number | null; rarity: string | null; copies: number }>()
  for (const c of me?.cards ?? []) {
    const r = byRef.get(c.ref)
    byRef.set(c.ref, { value: r?.value ?? c.value, rarity: r?.rarity ?? c.rarity, copies: (r?.copies ?? 0) + 1 })
  }
  const keepsFor = (ref: string): KeptPage['why'] | null => {
    const set = setOfRef(ref)
    if (cards.get(ref)?.page === false) return null
    if ((aff[set] ?? 0) > 1) return 'boost'
    return GUARDRAILS_DOC.protectPageSets.includes(set) ? 'protected' : null
  }
  // the pages we aim for first, then the complete ones, then the rest
  const order = [...plan.targets, ...plan.complete]
  const pages: KeptPage[] = [...order, ...pagesOf(s).filter((p) => !order.some((o) => o.set === p.set))].flatMap((p) => {
    const kept = [...byRef.entries()].filter(([ref]) => setOfRef(ref) === p.set && keepsFor(ref) !== null)
    if (!kept.length) return []
    return [{
      ...p,
      why: keepsFor(kept[0]?.[0] ?? '') ?? 'boost',
      cards: kept.map(([ref, h]) => ({ ref, name: cards.get(ref)?.name ?? null, rarity: h.rarity, value: h.value })).sort((x, y) => x.ref.localeCompare(y.ref, 'en', { numeric: true })),
    }]
  })
  const ours = s.asks.filter((a) => a.ours)
  const others = cheapestOthers(s.asks, me?.team ?? null)
  const makerRows = win.filter((d) => d.agent === 'maker' && d.card)
  const onSale: Spare[] = []
  const notListed: Spare[] = []
  for (const [ref, h] of byRef) {
    const spare = h.copies - (keepsFor(ref) !== null ? 1 : 0)
    if (spare <= 0) continue
    const asks = ours.filter((a) => a.card === ref).sort((a, b) => a.price - b.price)
    const listed = Math.min(asks.length, spare)
    const newestMaker = makerRows.find((d) => d.card === ref) ?? null
    const newestPost = makerRows.find((d) => d.card === ref && d.kind === 'post_ask') ?? null
    let why: SpareWhy | null = null
    if (spare > listed) {
      if (h.copies === 2 && GUARDRAILS_DOC.teamThreads && listed === 0) why = { kind: 'two_copies' }
      else if (listed > 0) why = { kind: 'other_copy_on_sale' }
      else if (newestMaker?.reason && newestMaker.kind !== 'post_ask') why = { kind: 'maker', reason: newestMaker.reason, tick: newestMaker.tick }
      else why = { kind: 'no_ask' }
    }
    const row: Spare = {
      ref,
      name: cards.get(ref)?.name ?? null,
      rarity: h.rarity,
      copies: spare,
      value: h.value,
      ask: asks[0]?.price ?? null,
      onSale: listed,
      bestOther: others.get(ref)?.price ?? null,
      lastFill: cards.get(ref)?.lastFill ?? null,
      makerWhy: listed > 0 ? (newestPost?.reason ?? null) : why?.kind === 'two_copies' ? (newestMaker?.reason ?? null) : null,
      why,
    }
    if (listed > 0) onSale.push(row)
    if (spare > listed) notListed.push({ ...row, copies: spare - listed })
  }
  const byRefOrder = (a: Spare, b: Spare) => a.ref.localeCompare(b.ref, 'en', { numeric: true })
  return { pages, onSale: onSale.sort(byRefOrder), notListed: notListed.sort(byRefOrder), copies: me?.cards.length ?? 0 }
}
