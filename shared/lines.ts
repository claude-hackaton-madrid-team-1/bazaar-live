/**
 * The show's lines, as data: banks of short BUYER ↔ SELLER exchanges with `{slot}` placeholders.
 *
 * The browser fills the slots from public event fields (src/show/dialogue.ts). The TTS proxy only
 * speaks text that matches one of these templates, with each slot restricted to the words the show
 * can produce (SLOT_PATTERNS), so the public proxy cannot be used to voice anyone's own text.
 *
 * Imported by the browser bundle and by the Node proxy, so it imports nothing but types.
 */
import type { Speaker } from './tags.ts'

/** `dealer` becomes the dealer on stage (`abuela`, `chato`) or the narrator for an unknown one. */
export type Role = 'buyer' | 'seller' | 'dealer' | 'narrator'
export type Template = readonly (readonly [Role, string])[]
export type Bank = readonly Template[]

export const SLOTS = ['card', 'price', 'ask', 'item', 'dealerName', 'verdict', 'error', 'kind', 'count'] as const
export type Slot = (typeof SLOTS)[number]
/** A slot's words, or null when the public data has none (templates using it are then skipped). */
export type SlotValues = Readonly<Record<Slot, string | null>>

const HOODS = 'Lavapiés|Malasaña|La Latina|Salamanca|El Retiro|Chamberí'
const CARD = `(?:(?:${HOODS}) number \\d{1,3}|[A-Z]{3}-\\d{1,3}|this card)`
const PRIMAS = '\\d{1,8}(?:\\.\\d)? primas?'

/** What each slot may contain: exactly the words src/show/words.ts produces. */
export const SLOT_PATTERNS: Readonly<Record<Slot, string>> = {
  card: CARD,
  price: PRIMAS,
  ask: PRIMAS,
  item: `(?:a neighbourhood pack|a silver pack|a common|an uncommon|a rare|an epic|a legendary|a little something|${CARD})`,
  dealerName: '(?:Abuela Carmen|El Chato|the dealer)',
  verdict: '[a-z][a-z ]{0,23}',
  error: '[a-z0-9][a-z0-9 ]{0,39}',
  kind: '[a-z0-9][a-z0-9 ]{0,29}',
  count: '\\d{1,3}',
}

// ---------------------------------------------------------------- the SELLER (maker) lists and reprices

export const POST_ASK: Bank = [
  [['seller', '¡Oiga, oiga! {card}, fresh from the stall, {price}!'], ['buyer', '[sarcastic] {price}? For that it should come with churros.']],
  [['seller', '[excited] {card} on the board! {price}, and not one céntimo less.'], ['buyer', '[laughs] Venga, somebody will bite.']],
  [['seller', 'Señoras y señores… {card}! Only {price}!'], ['buyer', "[whispers] Psst. It's a good one. I've seen it up close."]],
  [['seller', 'Card up: {card} for {price}. Que lo vendo, ¿eh?'], ['buyer', 'Madre mía, the price tag is prettier than the card.']],
  [['seller', "[mischievously] {card}, {price}. Grandma's recipe."], ['buyer', '[laughs] Your grandma never sold a card in her life.']],
]

export const POST_ASK_NO_PRICE: Bank = [
  [['seller', '{card} goes on the board.'], ['buyer', '[curious] And the price?'], ['seller', '[whispers] Ask nicely.']],
  [['seller', 'Look at this beauty: {card}!'], ['buyer', '[sarcastic] Beautiful. Expensive, I bet.']],
]

export const POST_BID: Bank = [
  [['seller', "I'm buying today! {card}, I pay {price}!"], ['buyer', "[laughs] Look who's shopping now."]],
  [['seller', 'Anyone with {card}? {price} cash, right here.'], ['buyer', '[whispers] Cash talks, compadre.']],
]

export const POST_BID_NO_PRICE: Bank = [[['seller', 'Wanted: {card}. Good home, fair price.'], ['buyer', '[chuckles] Like a lost-dog poster.']]]

export const REPRICE: Bank = [
  [['seller', 'New price for {card}: {price}!'], ['buyer', '[gasps] The tag moved! Inflation, compadre.']],
  [['seller', '[whispers] Jev says {verdict}… so {card} is now {price}.'], ['buyer', 'You listen to that machine more than to me.']],
  [['seller', '{card}, now {price}. Fresh price, fresh day.'], ['buyer', '[sarcastic] Ah yes, the famous Rastro discount.']],
]

export const REPRICE_NO_PRICE: Bank = [
  [['seller', 'Time to touch the price of {card}.'], ['buyer', '[curious] Up or down?'], ['seller', '[mischievously] Sideways.']],
]

export const HOLD: Bank = [
  [['seller', '{card} stays put.'], ['buyer', 'Patience. The Rastro rewards patience.']],
  [['seller', '[whispers] Jev says {verdict}. We hold.'], ['buyer', '[sighs] We hold. Like statues.']],
  [['seller', 'Not touching {card}. Good price is good price.'], ['buyer', '[chuckles] Famous last words.']],
]

export const HOLD_MANY: Bank = [
  [['seller', '{count} prices on the board, and we hold them all.'], ['buyer', '[sighs] Like statues in the Retiro.']],
  [['seller', 'Holding {count} prices. Nobody panic.'], ['buyer', "[whispers] I'm not panicking. You're panicking."]],
]

export const CANCEL_SELLER: Bank = [
  [['seller', '[sighs] Taking {card} off the board.'], ['buyer', 'Back to the drawer, little one.']],
  [['seller', "{card}, you're coming home."], ['buyer', '[sarcastic] Nobody loved it like you did.']],
]

export const CANCEL_BUYER: Bank = [[['buyer', 'I withdraw my bid on {card}.'], ['seller', '[sarcastic] Commitment issues?']]]

// ---------------------------------------------------------------- the BUYER (taker) shops

export const TAKE: Bank = [
  [['buyer', '[excited] {card} at {ask}? ¡Me lo llevo!'], ['seller', '[laughs] Sold before the ink dried.']],
  [['buyer', '[excited] {card} at that price? ¡Me lo llevo!'], ['seller', '[laughs] Sold before the ink dried.']],
  [['buyer', 'That one. {card}. Wrap it up!'], ['seller', '[gasps] No haggling at all!']],
  [['buyer', '[whispers] {card}, {ask}… a bargain. Mine!'], ['seller', 'Olé! Somebody call the newspaper.']],
]

export const PASS: Bank = [
  [['buyer', '{card}… no. Not today.'], ['seller', '[whispers] Picky, picky.']],
  [['buyer', "[sighs] I'll let {card} go."], ['seller', "There's always another card, compadre."]],
]

export const LATE: Bank = [
  [['buyer', '[sighs] Too slow for {card}. The window closed.'], ['seller', 'Mañana será otro día.']],
  [['buyer', 'Wait, wait… the tick is over?'], ['seller', '[laughs] Like the last bus home.']],
]

export const SKIP_SELLER: Bank = [
  [['seller', "I'll keep {card} in the drawer for now."], ['buyer', 'Wise. Very wise.']],
  [['seller', '[whispers] Not yet for {card}.'], ['buyer', '[chuckles] The suspense is killing me.']],
]

export const PRACTICE: Bank = [
  [['buyer', "If this were for real, I'd grab {card}."], ['seller', '[chuckles] Dreaming is free.']],
  [['seller', 'In practice mode, {card} would be on the board.'], ['buyer', '[whispers] Rehearsal. Just a rehearsal.']],
]

export const DENIED_BUYER: Bank = [
  [['buyer', "I'll take {card}—"], ['seller', '[gasps] ¡Alto! The guardrails said no!'], ['buyer', '[sighs] Fine. Fine.']],
  [['buyer', '[excited] {card}, here I come!'], ['seller', 'Stop sign, compadre. Rules are rules.']],
]

export const DENIED_SELLER: Bank = [
  [['seller', "I'll list {card}—"], ['buyer', '[gasps] ¡Alto! The guardrails say no.']],
  [['seller', "[sighs] The guardrails won't let {card} out."], ['buyer', "[whispers] They're stricter than my mother."]],
]

// ---------------------------------------------------------------- dealers at the Rastro (El Chato is not kind)

const HANDLE: Template = [['buyer', '[whispers] Let me handle {dealerName}.'], ['seller', '[chuckles] This I want to see.']]

export const DEALER_OPEN_KIND: Bank = [[['buyer', "¡Buenos días, {dealerName}! I'm after {item}."], ['dealer', 'Ay, cariño, sit down, sit down.']], HANDLE]
export const DEALER_OPEN_CHATO: Bank = [[['buyer', "¡Buenos días, {dealerName}! I'm after {item}."], ['dealer', '[sarcastic] You again. What do you want?']], HANDLE]

const BID_SHARED: Bank = [
  [['buyer', 'You say {ask}, I say {price}.'], ['seller', '[whispers] Steady… steady…']],
  [['buyer', 'I say {price}.'], ['seller', '[whispers] Steady… steady…']],
  [['buyer', "[mischievously] {price}, and I'll tell everyone you're the best."], ['seller', '[laughs] Flattery! The oldest trick in the Rastro.']],
]

export const DEALER_BID_KIND: Bank = [[['buyer', 'I offer {price} for {item}.'], ['dealer', '[laughs] You remind me of my grandson. Too cheap!']], ...BID_SHARED]
export const DEALER_BID_CHATO: Bank = [[['buyer', 'I offer {price} for {item}.'], ['dealer', '[snorts] {price}? Pigeons offer more.']], ...BID_SHARED]

export const DEALER_BID_NO_PRICE: Bank = [[['buyer', 'A little offer for {item}…'], ['seller', '[whispers] Steady… steady…']]]

const ACCEPT_SHARED: Bank = [
  [['buyer', '{ask}? Deal!'], ['seller', '[gasps] A deal with {dealerName}! Frame it!']],
  [['buyer', 'That price? Deal!'], ['seller', '[gasps] A deal with {dealerName}! Frame it!']],
]

export const DEALER_ACCEPT_KIND: Bank = [[['buyer', '[excited] ¡Trato hecho, {dealerName}!'], ['dealer', '¡Que aproveche, mi niño!']], ...ACCEPT_SHARED]
export const DEALER_ACCEPT_CHATO: Bank = [[['buyer', '[excited] ¡Trato hecho, {dealerName}!'], ['dealer', "[sighs] Fine. Don't tell anyone."]], ...ACCEPT_SHARED]

const WALK_SHARED: Template = [['buyer', 'No deal, {dealerName}. My wallet says no.'], ['seller', '[sarcastic] Your wallet is very talkative today.']]

export const DEALER_WALK_KIND: Bank = [[['buyer', '[sighs] Too much for me. ¡Hasta luego!'], ['dealer', "Come back Sunday, I'll have churros."]], WALK_SHARED]
export const DEALER_WALK_CHATO: Bank = [[['buyer', '[sighs] Too much for me. ¡Hasta luego!'], ['dealer', "[snorts] Walk, then. The door's that way."]], WALK_SHARED]

// ---------------------------------------------------------------- what the game answered

export const DEAL: Bank = [
  [['buyer', '[excited] ¡Trato hecho!'], ['seller', '[laughs] Handshake, confetti, the works!']],
  [['seller', '[gasps] It went through!'], ['buyer', 'Olé, olé, olé!']],
  [['buyer', 'Shake on it, compadre.'], ['seller', '[laughs] Firm handshake. I like it.']],
]

/** One short confirmation per SDK route the agents call. */
export const SENT: Readonly<Record<string, Bank>> = {
  list_offer: [[['seller', 'Done. Official, stamped, and on the board.']], [['seller', 'The game said yes. ¡Vamos!']]],
  cancel: [[['seller', 'Gone from the board.']], [['seller', '[sighs] Withdrawn. Officially.']]],
  open_thread: [[['buyer', 'Conversation open. Here we go.']]],
  say: [[['buyer', '[whispers] Message delivered.']], [['buyer', 'Offer sent. Fingers crossed.']]],
  close_thread: [[['buyer', 'Thread closed. ¡Adiós!']]],
  other: [[['seller', 'The game said yes. ¡Vamos!']]],
}

export const FAIL: Bank = [
  [['seller', '[gasps] The game says: {error}!'], ['buyer', '[sighs] Paperwork. Always paperwork.']],
  [['buyer', 'Refused? {error}?'], ['seller', '[sarcastic] Bureaucracy, the true boss of the Rastro.']],
]

export const UNKNOWN: Bank = [[['narrator', 'A new move at the stall: {kind}.']]]

export const IDLE: Bank = [
  [['buyer', '[whispers] Is the market asleep?'], ['seller', '[chuckles] Siesta. Even the cards need one.']],
  [['seller', 'Quiet day at the Rastro.'], ['buyer', '[sighs] Too quiet.']],
  [['buyer', 'Any good cards today?'], ['seller', '[mischievously] Wait and see, compadre.']],
]

const BANKS: readonly Bank[] = [
  POST_ASK, POST_ASK_NO_PRICE, POST_BID, POST_BID_NO_PRICE, REPRICE, REPRICE_NO_PRICE, HOLD, HOLD_MANY,
  CANCEL_SELLER, CANCEL_BUYER, TAKE, PASS, LATE, SKIP_SELLER, PRACTICE, DENIED_BUYER, DENIED_SELLER,
  DEALER_OPEN_KIND, DEALER_OPEN_CHATO, DEALER_BID_KIND, DEALER_BID_CHATO, DEALER_BID_NO_PRICE,
  DEALER_ACCEPT_KIND, DEALER_ACCEPT_CHATO, DEALER_WALK_KIND, DEALER_WALK_CHATO, DEAL, ...Object.values(SENT),
  FAIL, UNKNOWN, IDLE,
]

// ---------------------------------------------------------------- rendering and matching

const SLOT = /\{([a-zA-Z]+)\}/g

function isSlot(name: string): name is Slot {
  return (SLOTS as readonly string[]).includes(name)
}

/** The slots a template needs. */
export function slotsOf(template: Template): Slot[] {
  return template.flatMap(([, text]) => [...text.matchAll(SLOT)].map((m) => m[1] ?? '')).filter(isSlot)
}

/** A template can be used only when every slot it names has a value. */
export function usable(template: Template, values: SlotValues): boolean {
  return slotsOf(template).every((slot) => values[slot] !== null)
}

export function fill(text: string, values: SlotValues): string {
  return text.replace(SLOT, (match, name: string) => (isSlot(name) ? (values[name] ?? match) : match))
}

/** Who says a template line: the dealer role resolves to the dealer on stage, or the narrator. */
export function speakerOf(role: Role, dealer: 'abuela' | 'chato' | 'other'): Speaker {
  if (role !== 'dealer') return role
  return dealer === 'other' ? 'narrator' : dealer
}

const ROLES_FOR: Readonly<Record<Speaker, readonly Role[]>> = {
  buyer: ['buyer'],
  seller: ['seller'],
  abuela: ['dealer'],
  chato: ['dealer'],
  narrator: ['narrator', 'dealer'],
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compile(text: string): RegExp {
  const parts = text.split(SLOT).map((part, i) => (i % 2 === 1 && isSlot(part) ? SLOT_PATTERNS[part] : escape(part)))
  return new RegExp(`^${parts.join('')}$`, 'u')
}

let matchers: ReadonlyMap<Role, readonly RegExp[]> | null = null

function allMatchers(): ReadonlyMap<Role, readonly RegExp[]> {
  if (matchers) return matchers
  const byRole = new Map<Role, RegExp[]>()
  const seen = new Set<string>()
  for (const [role, text] of BANKS.flatMap((bank) => bank.flatMap((template) => template))) {
    const key = `${role}|${text}`
    if (seen.has(key)) continue
    seen.add(key)
    byRole.set(role, [...(byRole.get(role) ?? []), compile(text)])
  }
  matchers = byRole
  return byRole
}

/** True when `speaker` saying `text` is a line the show could have produced. */
export function isShowLine(speaker: Speaker, text: string): boolean {
  return ROLES_FOR[speaker].some((role) => (allMatchers().get(role) ?? []).some((re) => re.test(text)))
}
