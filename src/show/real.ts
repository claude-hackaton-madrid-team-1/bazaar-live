/**
 * A real conversation → a beat. The dealer speaks its real words; our agent speaks our offers rendered
 * from the structured offer; a closed duel is replayed with its rival; a settlement is a deal.
 *
 * ONE language: the show's selected one. A real quote is voiced only when its own language is that one
 * (`planQuote`); in the other language it is shown as text, and a generated line in the selected
 * language, built from the structured offer, is spoken in its place. Spanish never reaches an English
 * voice, nor the reverse.
 */
import { detectLang, type QuoteLang } from '../../shared/detect-lang.ts'
import type { Lang } from '../../shared/lang.ts'
import { duelEndLine, duelOfferLine, offerLine, openedLine, settlementLine } from '../../shared/real-lines.ts'
import type { DuelLine, OfferView, TranscriptItem, Who } from '../../shared/transcript.ts'
import { PRIORITY, type Beat, type Cue, type Line, type Speaker } from './beat'
import { dealerId } from './words'

export interface QuotePlan {
  /** True when a voice of the selected language may read the quote. */
  readonly speak: boolean
  readonly lang: QuoteLang
}

export function planQuote(text: string, selected: Lang): QuotePlan {
  const lang = detectLang(text)
  return { speak: lang === selected, lang }
}

/** The most duel lines one replay plays: the end of a haggle is the story. */
const MAX_REPLAY_LINES = 6

const speakerOfDealer = (counterpart: string | null): Speaker => {
  const id = dealerId(counterpart ?? undefined)
  return id === 'other' ? 'narrator' : id
}

/** Our agent speaks as the buyer when it pays and as the seller when it asks. */
const ourChair = (offer: OfferView): Speaker => (offer.verb === 'bid' ? 'buyer' : 'seller')

const line = (speaker: Speaker, text: string, silent = false): Line => (silent ? { speaker, text, silent: true } : { speaker, text })

/** A quote and, when it cannot be voiced, the generated line that is. */
function quoteLines(speaker: Speaker, text: string | null, generated: string | null, lang: Lang): Line[] {
  if (text === null) return generated === null ? [] : [line(speaker, generated)]
  if (planQuote(text, lang).speak) return [line(speaker, text)]
  return generated === null ? [line(speaker, text, true)] : [line(speaker, text, true), line(speaker, generated)]
}

interface Frame {
  readonly agent: Beat['agent']
  readonly priority: number
  readonly lines: readonly Line[]
  readonly cue: Cue
}

function beatOf(item: TranscriptItem, frame: Frame): Beat | null {
  if (frame.lines.length === 0) return null
  return { id: `real:${item.id}`, tick: item.tick, denied: false, jev: null, practice: false, note: null, ...frame }
}

function threadLine(item: TranscriptItem, lang: Lang): Beat | null {
  const dealer = dealerId(item.counterpart ?? undefined)
  const price = item.offer?.price ?? null
  const cue: Cue = { kind: 'dealer', dealer, move: 'bid', price }
  if (item.who === 'us') {
    if (!item.offer) return null
    return beatOf(item, { agent: item.offer.verb === 'bid' ? 'taker' : 'maker', priority: PRIORITY.dealerBid, cue, lines: [line(ourChair(item.offer), offerLine(item.offer, lang))] })
  }
  const generated = item.offer ? offerLine(item.offer, lang) : null
  return beatOf(item, {
    agent: item.offer?.verb === 'bid' ? 'maker' : 'taker',
    priority: item.offer?.final ? PRIORITY.dealer : PRIORITY.dealerBid,
    cue,
    lines: quoteLines(speakerOfDealer(item.counterpart), item.text, generated, lang),
  })
}

function duelReplay(item: TranscriptItem, lang: Lang): Beat | null {
  const ours: Speaker = item.role === 'seller' ? 'seller' : 'buyer'
  const theirs: Speaker = ours === 'seller' ? 'buyer' : 'seller'
  const chair = (who: Who): Speaker => (who === 'us' ? ours : theirs)
  const spoken = (l: DuelLine): Line[] => quoteLines(chair(l.speaker), l.text, l.price === null ? null : duelOfferLine(l.speaker, l.price, lang), lang)
  const status = item.status === 'deal' ? 'deal' : 'no_deal'
  const lines = [...item.lines.slice(-MAX_REPLAY_LINES).flatMap(spoken), line('narrator', duelEndLine(status, item.price, lang))]
  return beatOf(item, {
    agent: item.role === 'seller' ? 'maker' : 'taker',
    priority: status === 'deal' ? PRIORITY.dealerAccept : PRIORITY.dealer,
    cue: status === 'deal' ? { kind: 'deal', big: true, ref: item.item } : { kind: 'talk' },
    lines,
  })
}

/** "Duel in progress: <item> vs <rival>": a live duel is announced, never narrated. Text only. */
function duelLive(item: TranscriptItem, lang: Lang): Beat | null {
  const [head, versus] = lang === 'es' ? ['Duelo en marcha', 'contra'] : ['Duel in progress', 'vs']
  return beatOf(item, {
    agent: item.role === 'seller' ? 'maker' : 'taker',
    priority: PRIORITY.sent,
    cue: { kind: 'talk' },
    lines: [line('narrator', `${head}: ${item.item ?? '?'} ${versus} ${item.counterpart ?? '?'}`, true)],
  })
}

/** The beat for one transcript item in the selected language, or null when there is nothing to play. */
export function realBeat(item: TranscriptItem, lang: Lang): Beat | null {
  switch (item.kind) {
    case 'thread_line':
      return threadLine(item, lang)
    case 'thread_opened': {
      const text = openedLine(item.item, lang)
      return text === null ? null : beatOf(item, { agent: 'taker', priority: PRIORITY.dealer, cue: { kind: 'dealer', dealer: dealerId(item.counterpart ?? undefined), move: 'open', price: null }, lines: [line('buyer', text)] })
    }
    case 'settlement':
      return item.price === null
        ? null
        : beatOf(item, { agent: 'taker', priority: PRIORITY.deal, cue: { kind: 'deal', big: true, ref: item.item }, lines: [line('narrator', settlementLine(item.price, item.item, lang))] })
    case 'duel_replay':
      return duelReplay(item, lang)
    case 'duel_live':
      return duelLive(item, lang)
  }
}
