/**
 * A real conversation → a beat. The dealer speaks its real words; our agent speaks our offers rendered
 * from the structured offer; a closed duel is replayed with its rival; a settlement is a deal.
 *
 * ONE language: the show's selected one. By default every real quote is a caption only and a generated
 * line in the selected language, built from the structured offer, is spoken in its place. With
 * `speakQuotes` a quote is voiced only when its own language is the selected one (`planQuote`); in the
 * other language it is still a caption. Only a dealer's quotes can be voiced; a rival's duel words never
 * are. Spanish never reaches an English voice, nor the reverse.
 */
import { detectLang, type QuoteLang } from '../../shared/detect-lang.ts'
import { looksLikeInjection } from '../../shared/injections.ts'
import type { Lang } from '../../shared/lang.ts'
import { duelEndLine, duelOfferLine, offerLine, openedLine, settlementLine } from '../../shared/real-lines.ts'
import { dealerSpeaker, guestSpeaker, isGuest } from '../../shared/tags.ts'
import type { DuelLine, OfferView, TranscriptItem, Who } from '../../shared/transcript.ts'
import { PRIORITY, type Beat, type Cue, type Line, type Speaker } from './beat'
import { dealerId } from './words'

export interface RealOptions {
  /**
   * Speak a real quote when its language is the selected one. Off by default: a dealer's or a rival's
   * words are captions only (an insult is not for the stage's voices); the line built from the
   * structured offer is spoken instead.
   */
  readonly speakQuotes: boolean
}

const CAPTIONS_ONLY: RealOptions = { speakQuotes: false }
/** A rival's duel words are never voiced, in any mode: prompt injection is allowed in this game. */
const NO_VOICE: RealOptions = CAPTIONS_ONLY

export interface QuotePlan {
  /** True when a voice of the selected language may read the quote. */
  readonly speak: boolean
  readonly lang: QuoteLang
}

/** A quote with an injection's shape is never voiced, whatever its language: it stays a caption. */
export function planQuote(text: string, selected: Lang): QuotePlan {
  const lang = detectLang(text)
  return { speak: lang === selected && !looksLikeInjection(text), lang }
}

/** The most duel lines one replay plays: the end of a haggle is the story. */
const MAX_REPLAY_LINES = 6

/** Every dealer speaks with its own voice: a known one by id, any other dealer with a guest voice. */
const speakerOfDealer = (counterpart: string | null): Speaker => dealerSpeaker(counterpart) ?? (counterpart && /^t\d{1,3}$/i.test(counterpart) ? guestSpeaker(counterpart) : 'narrator')

/** A guest voice's lines carry the dealer's id, so the captions can show its name, not the voice's slot. */
const dealerLines = (counterpart: string | null, lines: readonly Line[]): Line[] =>
  lines.map((l) => (isGuest(l.speaker) && counterpart ? { ...l, dealer: counterpart.trim().toLowerCase() } : l))

/** Our agent speaks as the buyer when it pays and as the seller when it asks. */
const ourChair = (offer: OfferView): Speaker => (offer.verb === 'bid' ? 'buyer' : 'seller')

/** A line a voice reads, in the language it is in. */
const spoken = (speaker: Speaker, text: string, lang: Lang): Line => ({ speaker, text, lang })
/** A line the captions show and no voice reads. */
const shown = (speaker: Speaker, text: string): Line => ({ speaker, text, silent: true })

/** A quote and, when it is not voiced, the generated line that is. */
function quoteLines(speaker: Speaker, text: string | null, generated: string | null, lang: Lang, opts: RealOptions): Line[] {
  if (text === null) return generated === null ? [] : [spoken(speaker, generated, lang)]
  if (opts.speakQuotes && planQuote(text, lang).speak) return [spoken(speaker, text, lang)]
  return generated === null ? [shown(speaker, text)] : [shown(speaker, text), spoken(speaker, generated, lang)]
}

interface Frame {
  readonly agent: Beat['agent']
  readonly priority: number
  readonly lines: readonly Line[]
  readonly cue: Cue
}

function beatOf(item: TranscriptItem, frame: Frame): Beat | null {
  if (frame.lines.length === 0) return null
  const mood = frame.cue.kind === 'deal' ? 'triumphant' : 'calm'
  return { id: `real:${item.id}`, tick: item.tick, denied: false, jev: null, practice: false, note: null, mood, ...frame }
}

function threadLine(item: TranscriptItem, lang: Lang, opts: RealOptions): Beat | null {
  const dealer = dealerId(item.counterpart ?? undefined)
  const price = item.offer?.price ?? null
  const cue: Cue = { kind: 'dealer', dealer, move: 'bid', price }
  if (item.who === 'us') {
    if (!item.offer) return null
    return beatOf(item, { agent: item.offer.verb === 'bid' ? 'taker' : 'maker', priority: PRIORITY.dealerBid, cue, lines: [spoken(ourChair(item.offer), offerLine(item.offer, lang), lang)] })
  }
  const generated = item.offer ? offerLine(item.offer, lang) : null
  return beatOf(item, {
    agent: item.offer?.verb === 'bid' ? 'maker' : 'taker',
    priority: item.offer?.final ? PRIORITY.dealer : PRIORITY.dealerBid,
    cue,
    // A dealer's words are voiced by its own voice; a counterpart with no dealer voice (a team) is a caption, and so
    // is a quote the server muted (its raw words had an injection's shape).
    lines: dealerLines(item.counterpart, quoteLines(speakerOfDealer(item.counterpart), item.text, generated, lang, { speakQuotes: opts.speakQuotes && dealerSpeaker(item.counterpart) !== null && item.muted !== true })),
  })
}

function duelReplay(item: TranscriptItem, lang: Lang): Beat | null {
  const ours: Speaker = item.role === 'seller' ? 'seller' : 'buyer'
  const theirs: Speaker = guestSpeaker(item.counterpart ?? 'rival')
  const chair = (who: Who): Speaker => (who === 'us' ? ours : theirs)
  const said = (l: DuelLine): Line[] => dealerLines(l.speaker === 'us' ? null : item.counterpart, quoteLines(chair(l.speaker), l.text, l.price === null ? null : duelOfferLine(l.speaker, l.price, lang), lang, NO_VOICE))
  const status = item.status === 'deal' ? 'deal' : 'no_deal'
  const lines = [...item.lines.slice(-MAX_REPLAY_LINES).flatMap(said), spoken('narrator', duelEndLine(status, item.price, lang), lang)]
  return beatOf(item, {
    agent: item.role === 'seller' ? 'maker' : 'taker',
    priority: status === 'deal' ? PRIORITY.dealerAccept : PRIORITY.dealer,
    cue: status === 'deal' ? { kind: 'deal', big: true, ref: item.item, price: item.price } : { kind: 'talk' },
    lines,
  })
}

/** The beat for one transcript item in the selected language, or null when there is nothing to play. */
export function realBeat(item: TranscriptItem, lang: Lang, opts: RealOptions = CAPTIONS_ONLY): Beat | null {
  switch (item.kind) {
    case 'thread_line':
      return threadLine(item, lang, opts)
    case 'thread_opened': {
      const text = openedLine(item.item, lang)
      return text === null ? null : beatOf(item, { agent: 'taker', priority: PRIORITY.dealer, cue: { kind: 'dealer', dealer: dealerId(item.counterpart ?? undefined), move: 'open', price: null }, lines: [spoken('buyer', text, lang)] })
    }
    case 'settlement':
      return item.price === null
        ? null
        : beatOf(item, { agent: 'taker', priority: PRIORITY.deal, cue: { kind: 'deal', big: true, ref: item.item, price: item.price }, lines: [spoken('narrator', settlementLine(item.price, item.item, lang), lang)] })
    case 'duel_replay':
      return duelReplay(item, lang)
  }
}
