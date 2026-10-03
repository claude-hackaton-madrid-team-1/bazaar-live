/**
 * The rival board on the Rivals screen (db/rival_board.sql): a move badge for each team of the standings, and the
 * picked team's panel, with where it beats or trails us, what it wants against what we hold, and our move in plain
 * words. Private (our spares, the cards we miss, our estimates). Plain text only: every string is a React text node.
 * The panel says which leaderboard tick the board is from: a board that keeps failing keeps its last rows, so its own
 * tick (not the screen's read time) tells how old it is.
 */
import type { BoardRow, CardSignal } from '../../../shared/rivalBoard.ts'
import { whoName } from '../humanize.ts'
import { useRivalBoardStrings } from '../rivalBoardStrings.ts'
import { useGameStrings } from '../strings.ts'
import { interestsOf, isTrade, moveOf, moveTone, rankTrend } from '../views/rivalBoard.ts'
import { Badge, CardRef, Panel } from './bits.tsx'
import './rivalBoard.css'

/** The move for one team, as a badge in the standings: its title counts what they want against what we hold. */
export function MoveBadge({ row }: { row: BoardRow }) {
  const t = useRivalBoardStrings()
  return (
    <Badge tone={moveTone(row.moveKind)} title={t.moveTitle(row.weHaveForThem.length, row.theyHaveForUs.length)}>
      {t.moveKind[row.moveKind]}
      {row.matchCount > 0 ? ` · ${row.matchCount}` : ''}
    </Badge>
  )
}

function Signals({ head, items, price }: { head: string; items: readonly CardSignal[]; price: (p: number | null) => string }) {
  const t = useRivalBoardStrings()
  return (
    <div className="rb-list">
      <b>{head}</b>
      {items.length ? (
        <ul>
          {items.map((c) => (
            <li key={c.ref}>
              <CardRef code={c.ref} /> <span className="gm-muted">{price(c.price)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gm-muted">{t.noCards}</p>
      )}
    </div>
  )
}

/** The picked team against us, and our move with it. */
export function BoardPanel({ row }: { row: BoardRow }) {
  const t = useRivalBoardStrings()
  const g = useGameStrings()
  const move = moveOf(row)
  const trend = rankTrend(row)
  const interests = interestsOf(row)
  return (
    <Panel title={t.title(whoName(g, row.team))} sub={t.sub(row.tick)} className="rb-panel">
      <div className="rb-move" data-tone={moveTone(row.moveKind)}>
        <span className="rb-move-head">
          <Badge tone={moveTone(row.moveKind)}>{t.moveKind[row.moveKind]}</Badge>
          {row.guarded && row.guardReason && (
            <Badge tone="warn" title={t.guardTitle[row.guardReason]}>
              {t.guard[row.guardReason]}
            </Badge>
          )}
        </span>
        <p className="rb-sentence">{t.move(move)}</p>
        {row.guarded && row.guardReason && isTrade(row.moveKind) && <p className="gm-muted rb-note">{t.guardedTrade(row.guardReason, row.rank, row.ourRank)}</p>}
      </div>

      <dl className="rb-vs" aria-label={t.versusUs}>
        <div>
          <dt>{t.component.score}</dt>
          <dd className="gm-mono">{t.vs(row.score, row.ourScore)}</dd>
        </div>
        <div>
          <dt>{t.component.negotiating}</dt>
          <dd className="gm-mono">{t.vs(row.negotiating, row.ourNegotiating)}</dd>
        </div>
        <div>
          <dt>{t.component.market}</dt>
          <dd className="gm-mono">{t.vs(row.market, row.ourMarket)}</dd>
        </div>
        <div>
          <dt>{t.component.pages}</dt>
          <dd className="gm-mono">{t.vs(row.pages, row.ourPages)}</dd>
        </div>
      </dl>
      <p className="gm-muted rb-line">
        {trend ? `${t.trend(trend.from, trend.to, row.trendTicks)} · ` : ''}
        {t.activity(row.dealerDeals, row.venueTrades)}
      </p>

      <div className="rb-badges">
        <b>{t.strengthsHead}</b>
        {row.strengths.length ? (
          row.strengths.map((c) => (
            <Badge key={c} tone="them" title={t.strength[c].title}>
              {t.strength[c].label}
            </Badge>
          ))
        ) : (
          <span className="gm-muted">{t.none}</span>
        )}
      </div>
      <div className="rb-badges">
        <b>{t.weaknessesHead}</b>
        {row.weaknesses.length ? (
          row.weaknesses.map((c) => (
            <Badge key={c} tone="good" title={t.weakness[c].title}>
              {t.weakness[c].label}
            </Badge>
          ))
        ) : (
          <span className="gm-muted">{t.none}</span>
        )}
      </div>

      <div className="rb-lists">
        <div className="rb-list">
          <b>{t.weHaveForThem}</b>
          {row.weHaveForThem.length ? (
            <ul>
              {row.weHaveForThem.map((s) => (
                <li key={s.ref}>
                  <CardRef code={s.ref} /> <span className="gm-muted">{`${t.spare(s.spare)} · ${t.theirBid(s.theirPrice)}`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gm-muted">{t.noCards}</p>
          )}
        </div>
        <div className="rb-list">
          <b>{t.theyHaveForUs}</b>
          {row.theyHaveForUs.length ? (
            <ul>
              {row.theyHaveForUs.map((c) => (
                <li key={c.ref}>
                  <CardRef code={c.ref} />{' '}
                  <span className="gm-muted">{[t.theirAsk(c.theirPrice), t.valueToUs(c.valueToUs)].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gm-muted">{t.noCards}</p>
          )}
        </div>
        <Signals head={t.theyWant} items={row.theyWant} price={t.priceShort} />
        <Signals head={t.theyHave} items={row.theyHave} price={t.priceShort} />
      </div>

      {interests.length > 0 && (
        <p className="rb-line" title={t.interestTitle}>
          <b>{t.setInterest}</b>{' '}
          <span className="gm-mono">{interests.map((i) => `${i.set} ${i.interest > 0 ? '+' : ''}${i.interest}`).join(' · ')}</span>
        </p>
      )}
      {row.whyClimbed && (
        <p className="rb-line">
          <b>{t.whyClimbed}</b> <span>{row.whyClimbed}</span>
          {row.whyClimbedTick !== null && <span className="gm-muted">{` · ${t.atTick(row.whyClimbedTick)}`}</span>}
        </p>
      )}
    </Panel>
  )
}
