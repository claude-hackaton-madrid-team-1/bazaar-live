/**
 * The live half of the Negotiations screen: our open negotiations in plain words, the teams negotiating with us,
 * and what is on each market's board. Another team's words are printed as React text (escaped), never spoken.
 */
import { nameOfRef } from '../cards.ts'
import { fmtP, isSuspicious } from '../game.ts'
import { ruleName, whoName } from '../humanize.ts'
import { useNegLiveStrings, type NegLiveStrings } from '../negLiveStrings.ts'
import { useGameStrings, type GameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { marketBoards, ourNegotiations, teamTalks, type BoardOffer, type MarketBoard, type Mark, type Sentence, type TeamTalk } from '../views/negotiations-live.ts'
import type { NegRow } from '../views/negotiations.ts'
import { Badge, EventLink, Injection, Panel, RefChip, type Tone } from './bits.tsx'
import { useLimitsVisible } from './limits.ts'

/** A card as a sentence says it: its code, and its name when the catalogue has one. */
const cardText = (ref: string): string => {
  const name = nameOfRef(ref)
  return name ? `${ref} (${name})` : ref
}

function sentenceText(x: Sentence, t: GameStrings, l: NegLiveStrings, limits: boolean): string {
  switch (x.kind) {
    case 'dealer':
      return l.dealer(x, { who: whoName(t, x.with), card: cardText(x.ref) }, limits ? x.cap : null, x.blockedBy ? ruleName(t, x.blockedBy) : null)
    case 'swap':
      return l.swap(x, { who: whoName(t, x.with), card: '' })
    case 'duel':
      return l.duel(x, { who: x.rival ?? '?', card: '' }, limits ? x.limit : null)
  }
}

/** One sentence per open negotiation of ours, for one dealer when the screen is filtered to it. */
export function OurNegotiations({ rows, dealer }: { rows: readonly NegRow[]; dealer: string | null }) {
  const { state } = useGame()
  const t = useGameStrings()
  const l = useNegLiveStrings()
  const limits = useLimitsVisible()
  const all = ourNegotiations(state, rows)
  const shown = dealer ? all.filter((x) => x.kind === 'dealer' && x.with === dealer) : all
  if (dealer && !shown.length) return null
  const hasLimit = shown.some((x) => (x.kind === 'dealer' && x.cap != null) || (x.kind === 'duel' && x.limit != null))
  return (
    <Panel title={l.ours} sub={l.oursSub(shown.length)} className="nl-ours">
      {shown.length ? (
        <ul className="nl-sentences">
          {shown.map((x) => (
            <li key={`${x.kind}-${x.id}`} className="nl-sentence" data-kind={x.kind}>
              {sentenceText(x, t, l, limits)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="gm-empty">{l.noOurs}</p>
      )}
      {!limits && hasLimit && <p className="nl-note gm-muted">{l.limitsHidden}</p>}
    </Panel>
  )
}

const MARK_TONE: Readonly<Record<Mark, Tone>> = { ours: 'us', forUs: 'warn', missing: 'good', spare: 'good' }

function OfferLine({ o }: { o: BoardOffer }) {
  const t = useGameStrings()
  const l = useNegLiveStrings()
  return (
    <li className="nl-offer" data-mark={o.mark ?? undefined}>
      <span className="nl-side" data-side={o.side}>
        {l.side[o.side]}
      </span>
      <RefChip topic={o.ref} />
      <span className="gm-mono gm-muted">{o.ref}</span>
      {o.rarity && (
        <span className="nl-rarity" data-rarity={o.rarity}>
          {l.rarity[o.rarity]}
        </span>
      )}
      <b className="nl-price">{fmtP(o.price)}</b>
      {o.mark !== 'ours' && <span className="gm-muted nl-maker">{whoName(t, o.maker)}</span>}
      {o.mark && (
        <Badge tone={MARK_TONE[o.mark]} title={l.markTitle[o.mark]}>
          {l.mark[o.mark]}
        </Badge>
      )}
      <EventLink id={o.eventId} />
    </li>
  )
}

function Board({ b }: { b: MarketBoard }) {
  const t = useGameStrings()
  const l = useNegLiveStrings()
  return (
    <section className="nl-board" data-kind={b.kind} aria-label={b.name}>
      <h3 className="nl-board-head">
        <span>{l.board(b.kind, b.name, b.owner ? whoName(t, b.owner) : null)}</span>
        <span className="gm-muted nl-counts">{l.boardCounts(b.asks, b.bids, b.swaps)}</span>
      </h3>
      {b.offers.length ? (
        <ul className="nl-offers">
          {b.offers.map((o) => (
            <OfferLine key={o.id} o={o} />
          ))}
        </ul>
      ) : (
        <p className="gm-empty">{l.emptyBoard}</p>
      )}
      {b.more > 0 && <p className="nl-more gm-muted">{l.more(b.more)}</p>}
      {b.trades.length > 0 && (
        <div className="nl-trades">
          <span className="eyebrow">{l.trades}</span>
          <ul>
            {b.trades.map((x, i) => (
              <li key={`${x.eventId}-${x.ref}-${i}`} data-ours={x.ours || undefined}>
                <RefChip topic={x.ref} /> <span className="gm-muted">{l.trade(whoName(t, x.seller), whoName(t, x.buyer), x.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** What is on each board now and what traded there last; the offers that concern us first and marked. */
export function Markets() {
  const { state } = useGame()
  const l = useNegLiveStrings()
  const boards = marketBoards(state)
  const marked = boards.reduce((n, b) => n + b.marked, 0)
  return (
    <Panel title={l.markets} sub={l.marketsSub(boards.length, marked)} className="nl-markets">
      {boards.length ? (
        <div className="nl-boards">
          {boards.map((b) => (
            <Board key={b.venue} b={b} />
          ))}
        </div>
      ) : (
        <p className="gm-empty">{l.noMarkets}</p>
      )}
    </Panel>
  )
}

const STATUS_TONE: Readonly<Record<TeamTalk['status'], Tone>> = { open: 'us', closed: 'neutral', deal: 'good', 'no deal': 'bad' }

function TalkLine({ x }: { x: TeamTalk }) {
  const t = useGameStrings()
  const l = useNegLiveStrings()
  return (
    <li className="nl-talk" data-kind={x.kind} data-live={x.status === 'open' || undefined}>
      <span className="nl-talk-head">
        <Badge tone={STATUS_TONE[x.status]}>{l.status[x.status]}</Badge>
        <span className="nl-kind">{l.kind[x.kind]}</span>
        {x.kind === 'swap' ? (
          <span>{l.swapLine({ who: whoName(t, x.with), card: '' }, x.weGive, x.theyGive)}</span>
        ) : (
          <span>{l.duelLine(x.rival ?? '?', x.side, x.item, x.ourPrice, x.theirPrice)}</span>
        )}
        {x.kind === 'swap' && x.status === 'open' && x.lastBy && <span className="gm-muted">· {l.lastBy[x.lastBy]}</span>}
        {x.kind === 'swap' && x.final && <Badge tone="warn">{t.badge.final}</Badge>}
        {x.kind === 'duel' && x.status === 'open' && x.ticksLeft != null && <span className="gm-muted">· {l.left(x.ticksLeft)}</span>}
        {x.kind === 'duel' && x.status === 'deal' && x.dealPrice != null && <b>{fmtP(x.dealPrice)}</b>}
      </span>
      {x.kind === 'swap' && x.lastText && (
        // Another team's words: React text (escaped), bounded, never spoken; only the structured offer counts.
        <span className="nl-words" title={l.untrustedTitle}>
          <span className="eyebrow">{l.untrusted}</span> <q>{x.lastText}</q> <Injection on={isSuspicious(x.lastText)} />
        </span>
      )}
    </li>
  )
}

/** Every team negotiating with us: team swaps and duels, live first. */
export function TeamsWithUs() {
  const { state } = useGame()
  const l = useNegLiveStrings()
  const talks = teamTalks(state)
  const live = talks.filter((x) => x.status === 'open').length
  return (
    <Panel title={l.teams} sub={l.teamsSub(live)} className="nl-teams">
      {talks.length ? (
        <ul className="nl-talks">
          {talks.map((x) => (
            <TalkLine key={`${x.kind}-${x.id}`} x={x} />
          ))}
        </ul>
      ) : (
        <p className="gm-empty">{l.noTeams}</p>
      )}
    </Panel>
  )
}
