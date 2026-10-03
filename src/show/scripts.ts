/**
 * The show's lines: banks of short BUYER ↔ SELLER exchanges, one bank per situation.
 * A template gets a context of ready-made words and returns one to three lines. Each bank has a
 * variant for every case the public data allows: a price may be missing (rows that were not sent
 * publish none), so every template that names a price has a sibling that does not.
 */
import type { DealerId, Line, Speaker } from './beat'

export interface Ctx {
  /** `La Latina number 9` */
  readonly card: string
  /** `68 primas`, or null when the row publishes no price. */
  readonly price: string | null
  /** The counterparty's public ask, as words, or null. */
  readonly ask: string | null
  readonly item: string
  readonly dealer: DealerId
  readonly dealerName: string
  readonly verdict: string | null
  readonly error: string
  readonly kind: string
  readonly count: number
}

export type Template = (c: Ctx) => Line[]

const say = (speaker: Speaker, text: string): Line => ({ speaker, text })
export const buyer = (text: string): Line => say('buyer', text)
export const seller = (text: string): Line => say('seller', text)
const narrator = (text: string): Line => say('narrator', text)
const dealer = (c: Ctx, text: string): Line => say(c.dealer === 'other' ? 'narrator' : c.dealer, text)

// ---------------------------------------------------------------- the SELLER (maker) lists and reprices

export const POST_ASK: readonly Template[] = [
  (c) => [seller(`¡Oiga, oiga! ${c.card}, fresh from the stall, ${c.price}!`), buyer(`[sarcastic] ${c.price}? For that it should come with churros.`)],
  (c) => [seller(`[excited] ${c.card} on the board! ${c.price}, and not one céntimo less.`), buyer(`[laughs] Venga, somebody will bite.`)],
  (c) => [seller(`Señoras y señores… ${c.card}! Only ${c.price}!`), buyer(`[whispers] Psst. It's a good one. I've seen it up close.`)],
  (c) => [seller(`Card up: ${c.card} for ${c.price}. Que lo vendo, ¿eh?`), buyer(`Madre mía, the price tag is prettier than the card.`)],
  (c) => [seller(`[mischievously] ${c.card}, ${c.price}. Grandma's recipe.`), buyer(`[laughs] Your grandma never sold a card in her life.`)],
]

export const POST_ASK_NO_PRICE: readonly Template[] = [
  (c) => [seller(`${c.card} goes on the board.`), buyer(`[curious] And the price?`), seller(`[whispers] Ask nicely.`)],
  (c) => [seller(`Look at this beauty: ${c.card}!`), buyer(`[sarcastic] Beautiful. Expensive, I bet.`)],
]

export const POST_BID: readonly Template[] = [
  (c) => [seller(`I'm buying today! ${c.card}, I pay ${c.price}!`), buyer(`[laughs] Look who's shopping now.`)],
  (c) => [seller(`Anyone with ${c.card}? ${c.price} cash, right here.`), buyer(`[whispers] Cash talks, compadre.`)],
]

export const POST_BID_NO_PRICE: readonly Template[] = [
  (c) => [seller(`Wanted: ${c.card}. Good home, fair price.`), buyer(`[chuckles] Like a lost-dog poster.`)],
]

export const REPRICE: readonly Template[] = [
  (c) => [seller(`New price for ${c.card}: ${c.price}!`), buyer(`[gasps] The tag moved! Inflation, compadre.`)],
  (c) => [seller(`[whispers] Jev says ${c.verdict ?? 'move it'}… so ${c.card} is now ${c.price}.`), buyer(`You listen to that machine more than to me.`)],
  (c) => [seller(`${c.card}, now ${c.price}. Fresh price, fresh day.`), buyer(`[sarcastic] Ah yes, the famous Rastro discount.`)],
]

export const REPRICE_NO_PRICE: readonly Template[] = [
  (c) => [seller(`Time to touch the price of ${c.card}.`), buyer(`[curious] Up or down?`), seller(`[mischievously] Sideways.`)],
]

export const HOLD: readonly Template[] = [
  (c) => [seller(`${c.card} stays put.`), buyer(`Patience. The Rastro rewards patience.`)],
  (c) => [seller(`[whispers] Jev says ${c.verdict ?? 'hold'}. We hold.`), buyer(`[sighs] We hold. Like statues.`)],
  (c) => [seller(`Not touching ${c.card}. Good price is good price.`), buyer(`[chuckles] Famous last words.`)],
]

export const HOLD_MANY: readonly Template[] = [
  (c) => [seller(`${c.count} prices on the board, and we hold them all.`), buyer(`[sighs] Like statues in the Retiro.`)],
  (c) => [seller(`Holding ${c.count} prices. Nobody panic.`), buyer(`[whispers] I'm not panicking. You're panicking.`)],
]

export const CANCEL_SELLER: readonly Template[] = [
  (c) => [seller(`[sighs] Taking ${c.card} off the board.`), buyer(`Back to the drawer, little one.`)],
  (c) => [seller(`${c.card}, you're coming home.`), buyer(`[sarcastic] Nobody loved it like you did.`)],
]

export const CANCEL_BUYER: readonly Template[] = [
  (c) => [buyer(`I withdraw my bid on ${c.card}.`), seller(`[sarcastic] Commitment issues?`)],
]

// ---------------------------------------------------------------- the BUYER (taker) shops

export const TAKE: readonly Template[] = [
  (c) => [buyer(`[excited] ${c.card} at ${c.ask ?? 'that price'}? ¡Me lo llevo!`), seller(`[laughs] Sold before the ink dried.`)],
  (c) => [buyer(`That one. ${c.card}. Wrap it up!`), seller(`[gasps] No haggling at all!`)],
  (c) => [buyer(`[whispers] ${c.card}, ${c.ask ?? 'cheap'}… a bargain. Mine!`), seller(`Olé! Somebody call the newspaper.`)],
]

export const PASS: readonly Template[] = [
  (c) => [buyer(`${c.card}… no. Not today.`), seller(`[whispers] Picky, picky.`)],
  (c) => [buyer(`[sighs] I'll let ${c.card} go.`), seller(`There's always another card, compadre.`)],
]

export const LATE: readonly Template[] = [
  (c) => [buyer(`[sighs] Too slow for ${c.card}. The window closed.`), seller(`Mañana será otro día.`)],
  () => [buyer(`Wait, wait… the tick is over?`), seller(`[laughs] Like the last bus home.`)],
]

export const SKIP_SELLER: readonly Template[] = [
  (c) => [seller(`I'll keep ${c.card} in the drawer for now.`), buyer(`Wise. Very wise.`)],
  (c) => [seller(`[whispers] Not yet for ${c.card}.`), buyer(`[chuckles] The suspense is killing me.`)],
]

export const PRACTICE: readonly Template[] = [
  (c) => [buyer(`If this were for real, I'd grab ${c.card}.`), seller(`[chuckles] Dreaming is free.`)],
  (c) => [seller(`In practice mode, ${c.card} would be on the board.`), buyer(`[whispers] Rehearsal. Just a rehearsal.`)],
]

export const DENIED_BUYER: readonly Template[] = [
  (c) => [buyer(`I'll take ${c.card}—`), seller(`[gasps] ¡Alto! The guardrails said no!`), buyer(`[sighs] Fine. Fine.`)],
  (c) => [buyer(`[excited] ${c.card}, here I come!`), seller(`Stop sign, compadre. Rules are rules.`)],
]

export const DENIED_SELLER: readonly Template[] = [
  (c) => [seller(`I'll list ${c.card}—`), buyer(`[gasps] ¡Alto! The guardrails say no.`)],
  (c) => [seller(`[sighs] The guardrails won't let ${c.card} out.`), buyer(`[whispers] They're stricter than my mother.`)],
]

// ---------------------------------------------------------------- dealers at the Rastro

export const DEALER_OPEN: readonly Template[] = [
  (c) => [buyer(`¡Buenos días, ${c.dealerName}! I'm after ${c.item}.`), ...(c.dealer === 'chato' ? [dealer(c, `[sarcastic] You again. What do you want?`)] : [dealer(c, `Ay, cariño, sit down, sit down.`)])],
  (c) => [buyer(`[whispers] Let me handle ${c.dealerName}.`), seller(`[chuckles] This I want to see.`)],
]

export const DEALER_BID: readonly Template[] = [
  (c) => [buyer(`I offer ${c.price} for ${c.item}.`), ...(c.dealer === 'chato' ? [dealer(c, `[snorts] ${c.price}? Pigeons offer more.`)] : [dealer(c, `[laughs] You remind me of my grandson. Too cheap!`)])],
  (c) => [buyer(`${c.ask ? `You say ${c.ask}, ` : ''}I say ${c.price}.`), seller(`[whispers] Steady… steady…`)],
  (c) => [buyer(`[mischievously] ${c.price}, and I'll tell everyone you're the best.`), seller(`[laughs] Flattery! The oldest trick in the Rastro.`)],
]

export const DEALER_BID_NO_PRICE: readonly Template[] = [
  (c) => [buyer(`A little offer for ${c.item}…`), seller(`[whispers] Steady… steady…`)],
]

export const DEALER_ACCEPT: readonly Template[] = [
  (c) => [buyer(`[excited] ¡Trato hecho, ${c.dealerName}!`), ...(c.dealer === 'chato' ? [dealer(c, `[sighs] Fine. Don't tell anyone.`)] : [dealer(c, `¡Que aproveche, mi niño!`)])],
  (c) => [buyer(`${c.ask ?? 'That price'}? Deal!`), seller(`[gasps] A deal with ${c.dealerName}! Frame it!`)],
]

export const DEALER_WALK: readonly Template[] = [
  (c) => [buyer(`[sighs] Too much for me. ¡Hasta luego!`), ...(c.dealer === 'chato' ? [dealer(c, `[snorts] Walk, then. The door's that way.`)] : [dealer(c, `Come back Sunday, I'll have churros.`)])],
  (c) => [buyer(`No deal, ${c.dealerName}. My wallet says no.`), seller(`[sarcastic] Your wallet is very talkative today.`)],
]

// ---------------------------------------------------------------- what the game answered

export const DEAL: readonly Template[] = [
  () => [buyer(`[excited] ¡Trato hecho!`), seller(`[laughs] Handshake, confetti, the works!`)],
  () => [seller(`[gasps] It went through!`), buyer(`Olé, olé, olé!`)],
  () => [buyer(`Shake on it, compadre.`), seller(`[laughs] Firm handshake. I like it.`)],
]

/** One short confirmation per SDK route the agents call. */
export const SENT: Readonly<Record<string, readonly Template[]>> = {
  list_offer: [() => [seller(`Done. Official, stamped, and on the board.`)], () => [seller(`The game said yes. ¡Vamos!`)]],
  cancel: [() => [seller(`Gone from the board.`)], () => [seller(`[sighs] Withdrawn. Officially.`)]],
  open_thread: [() => [buyer(`Conversation open. Here we go.`)]],
  say: [() => [buyer(`[whispers] Message delivered.`)], () => [buyer(`Offer sent. Fingers crossed.`)]],
  close_thread: [() => [buyer(`Thread closed. ¡Adiós!`)]],
  other: [() => [seller(`The game said yes. ¡Vamos!`)]],
}

export const FAIL: readonly Template[] = [
  (c) => [seller(`[gasps] The game says: ${c.error}!`), buyer(`[sighs] Paperwork. Always paperwork.`)],
  (c) => [buyer(`Refused? ${c.error}?`), seller(`[sarcastic] Bureaucracy, the true boss of the Rastro.`)],
]

export const UNKNOWN: readonly Template[] = [
  (c) => [narrator(`A new move at the stall: ${c.kind.replace(/_/g, ' ')}.`)],
]

export const IDLE: readonly Template[] = [
  () => [buyer(`[whispers] Is the market asleep?`), seller(`[chuckles] Siesta. Even the cards need one.`)],
  () => [seller(`Quiet day at the Rastro.`), buyer(`[sighs] Too quiet.`)],
  () => [buyer(`Any good cards today?`), seller(`[mischievously] Wait and see, compadre.`)],
]
