/**
 * The Strategy screen: what we aim for, why the taker does not buy what is on sale, and why we hold every card we
 * hold, read from our database (GET /api/strategy). The answer first, in big type; the rest behind a toggle.
 */
import { useMemo, type MouseEvent } from 'react'
import { hrefOf, navigate } from '../../ui/route'
import { GUARDRAILS_DOC, GUARDRAILS_DOC_SOURCE } from '../guardrailsDoc.ts'
import { useGame } from '../store.ts'
import { pagePush } from '../fresh.ts'
import { useStrategy } from '../strategy.ts'
import { p, useStrategyStrings } from '../strategyStrings.ts'
import { liveDuels } from '../views/duels.ts'
import {
  bindingOf, blockedBuys, boardOf, holdingsOf, jevVetoOf, leversOf, nowTickOf, planOf, rulesOf, unblockOf, windowOf, WINDOW_TICKS,
  type BlockedBuy, type Binding, type KeptPage, type Levers, type Plan, type RuleValue, type Spare, type SpareWhy,
} from '../views/strategy.ts'
import { nameOfRef } from '../cards.ts'
import { agoText } from '../humanize.ts'
import { useGameStrings } from '../strings.ts'
import { nowTick } from '../views/decisions.ts'
import { Badge, CardRef, Empty, Fresh, Panel } from './bits.tsx'
import { Ago } from './words.tsx'
import { NoticeBar } from './GameHeader.tsx'

/** A value read from GUARDRAILS.md rather than live carries the source as its tooltip. */
function Cap({ v }: { v: RuleValue }) {
  const t = useStrategyStrings()
  return (
    <b className="st-num" data-doc={v.live ? undefined : ''} title={v.live ? undefined : t.docValue(GUARDRAILS_DOC_SOURCE)}>
      {v.value}
    </b>
  )
}

function Aim({ plan, levers, binding }: { plan: Plan; levers: Levers; binding: Binding['rule'] }) {
  const t = useStrategyStrings()
  const spareSets = plan.spareSets.filter((s) => !s.protected).map((s) => `${s.name} ×${s.affinity}`)
  const protectedSets = plan.spareSets.filter((s) => s.protected).map((s) => s.name)
  return (
    <Panel title={t.aim} sub={t.aimSub}>
      <ul className="st-plan">
        {plan.targets.map((pg) => (
          <li key={pg.set}>
            <b>{t.target(pg.name, pg.affinity, pg.have, pg.of)}</b>
            {pg.missing.length > 0 && (
              <span className="st-missing">
                <span className="gm-muted">{t.lacks(pg.missing.length)}</span>
                {pg.missing.map((m) => (
                  <CardRef key={m.ref} code={m.ref} name={m.name ?? undefined} />
                ))}
              </span>
            )}
          </li>
        ))}
        {plan.complete.length > 0 && (
          <li>
            <span className="gm-good">✓ {t.complete(plan.complete.map((c) => c.name).join(', '))}</span>
          </li>
        )}
        <li>{t.sell(GUARDRAILS_DOC.sellMinSurplus, spareSets.join(', '), protectedSets.join(', '))}</li>
        {plan.venue && <li>{t.venue(plan.venue)}</li>}
      </ul>
      <dl className="st-levers">
        {binding !== 'cash_floor' && (
        <div>
          <dt>{t.room}</dt>
          <dd>
            <b className="st-big">{p(levers.cashRoom)}</b>
            <span className="gm-muted">
              {levers.cash !== null && t.roomSub(levers.cash, levers.floor.value)}
            </span>
          </dd>
        </div>
        )}
        {binding !== 'max_spend_per_game_hour' && (
        <div>
          <dt>{t.spend}</dt>
          <dd>
            <b className="st-big">{p(levers.spent)}</b>
            <span className="gm-muted">{t.spendSub(levers.maxSpend.value)}</span>
          </dd>
        </div>
        )}
        <div>
          <dt>{t.caps}</dt>
          <dd className="st-caps">
            {levers.caps.map((c) => (
              <span key={c.rarity}>
                {t.rarity(c.rarity)} <Cap v={c.cap} />
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </Panel>
  )
}

function BlockedRow({ b }: { b: BlockedBuy }) {
  const t = useStrategyStrings()
  return (
    <li className="st-block" data-held={b.heldNow || undefined}>
      <span className="st-block-card">
        <CardRef code={b.card} name={b.name ?? undefined} />
        <span className="gm-muted">{t.rarity(b.rarity)}</span>
      </span>
      <span className="st-block-money">
        <span>{p(b.price)}</span>
        <span className="gm-muted">→ {p(b.value)}</span>
        {b.surplus !== null && <b className={b.surplus > 0 && !b.heldNow ? 'gm-good' : 'gm-muted'}>{b.surplus >= 0 ? '+' : '−'}{Math.abs(b.surplus)}</b>}
      </span>
      <span className="st-block-rule">
        {b.main && (
          <Badge tone={b.heldNow ? 'neutral' : 'bad'} title={t.ruleTitle[b.main.rule]}>
            {t.rule(b.main)}
          </Badge>
        )}
        <span className="gm-muted">
          ×{b.count} · <Ago tick={b.lastTick} from={b.firstTick} />
        </span>
      </span>
      <span className="st-block-now">
        {b.heldNow ? <Badge tone="good">{t.heldNow}</Badge> : b.onSaleNow !== null ? <Badge tone="warn">{t.onSaleNow(b.onSaleNow)}</Badge> : <span className="gm-muted">{t.notOnSale}</span>}
      </span>
      {b.rules.length > 1 && (
        <details className="st-details">
          <summary>{t.allRules}</summary>
          <ul>
            {b.rules.map((r) => (
              <li key={`${r.rule}${r.rarity ?? ''}${r.text ?? ''}`} title={t.ruleTitle[r.rule]}>
                {t.rule(r)} ×{r.count}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

function PageRow({ pg }: { pg: KeptPage }) {
  const t = useStrategyStrings()
  const value = pg.cards.reduce((sum, c) => sum + (c.value ?? 0), 0)
  return (
    <li className="st-page">
      <span className="st-page-head">
        <b>{t.target(pg.name, pg.affinity, pg.have, pg.of)}</b>
        <Badge tone={pg.complete ? 'good' : 'neutral'}>{t.pageState(pg.complete, pg.missing.length)}</Badge>
        <span className="gm-muted">{t.keptWhy[pg.why]}</span>
        <span className="gm-spacer" />
        <span className="st-num" title={t.pageValue}>
          {p(value)}
        </span>
      </span>
      <details className="st-details">
        <summary>{t.keptCards(pg.cards.length)}</summary>
        <span className="st-chips">
          {pg.cards.map((c) => (
            <span key={c.ref} className="st-chip">
              <CardRef code={c.ref} />
              <span className="gm-muted">{p(c.value)}</span>
            </span>
          ))}
        </span>
      </details>
    </li>
  )
}

function SaleTable({ rows }: { rows: readonly Spare[] }) {
  const t = useStrategyStrings()
  const c = t.saleCol
  return (
    <div className="gm-scroll">
      <table className="gm-table st-sale">
        <thead>
          <tr>
            <th>{c.card}</th>
            <th className="gm-r">{c.ask}</th>
            <th className="gm-r">{c.value}</th>
            <th className="gm-r">{c.other}</th>
            <th className="gm-r">{c.fill}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref} title={r.makerWhy ?? undefined}>
              <td>
                <CardRef code={r.ref} />
                {r.onSale > 1 && <span className="gm-muted"> {t.copies(r.onSale)}</span>}
              </td>
              <td className="gm-r">
                <b>{p(r.ask)}</b>
              </td>
              <td className="gm-r">{p(r.value)}</td>
              <td className={`gm-r${r.bestOther !== null && r.ask !== null && r.bestOther < r.ask ? ' gm-warn' : ''}`}>{p(r.bestOther)}</td>
              <td className="gm-r gm-muted">{p(r.lastFill)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DuelsLine({ n }: { n: number }) {
  const t = useStrategyStrings()
  if (!n) return null
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate('duels')
  }
  return (
    <p className="st-line">
      {t.duels(n)}{' '}
      <a href={hrefOf('duels', window.location.search)} onClick={go}>
        {t.duelsLink}
      </a>
    </p>
  )
}

/** The spares not on sale, one line per reason: the same reason is said once. */
function groupByWhy(rows: readonly Spare[], label: (w: SpareWhy) => string): [string, Spare[]][] {
  const groups = new Map<string, Spare[]>()
  for (const r of rows) {
    const why = r.why ? label(r.why) : ''
    groups.set(why, [...(groups.get(why) ?? []), r])
  }
  return [...groups.entries()]
}

export function StrategyScreen() {
  const store = useGame()
  const g = useGameStrings()
  const t = useStrategyStrings()
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token'), [])
  const push = pagePush(store.status, store.state, 'strategy')
  const { status, snapshot } = useStrategy(store.status === 'mock', token, store.state.tick, push)
  const v = useMemo(() => {
    const now = nowTickOf(snapshot)
    const win = windowOf(snapshot.decisions, now)
    const rules = rulesOf(snapshot.decisions)
    const levers = leversOf(snapshot, rules)
    const blocked = blockedBuys(snapshot, win)
    const binding = bindingOf(blocked, levers)
    return {
      plan: planOf(snapshot), levers, blocked, binding, unblock: unblockOf(binding, blocked, levers),
      board: boardOf(snapshot, rules, levers), jev: jevVetoOf(win, rules), holdings: holdingsOf(snapshot, win),
    }
  }, [snapshot])
  const onHold = liveDuels(store.state).filter((d) => d.state !== 'inside').length
  const { plan, levers, blocked, binding, unblock, board, jev, holdings } = v
  const albumCopies = holdings.pages.reduce((sum, pg) => sum + pg.cards.length, 0)
  const listed = holdings.onSale.reduce((sum, s) => sum + s.onSale, 0)
  const spareNotListed = holdings.notListed.reduce((sum, s) => sum + s.copies, 0)
  // the hint about one card is the line about that card
  const sameCard = unblock !== null && unblock.cards === 1 && unblock.cheapest?.card === binding.latest?.card
  const missingParts = Object.entries(snapshot.parts).filter(([, ok]) => !ok).map(([k]) => k)
  return (
    <>
      {status !== 'live' && status !== 'mock' && <NoticeBar>{t.notice[status]}</NoticeBar>}
      {status === 'live' && missingParts.length > 0 && <NoticeBar>{`${missingParts.join(', ')}: ${t.missingView}`}</NoticeBar>}
      <Aim plan={plan} levers={levers} binding={binding.rule} />
      <Panel
        title={t.why}
        sub={
          <>
            {t.whySub(WINDOW_TICKS)}
            <Fresh page="strategy" status={status} at={snapshot.at} push={push} />
          </>
        }
        className="st-why"
      >
        <p className="st-headline" data-rule={binding.rule}>
          {t.headline(binding, levers.cash, levers.room, levers.spent)}
        </p>
        {binding.latest && (
          <p className="st-line">
            {t.latest(nameOfRef(binding.latest.card) ?? binding.latest.card, binding.latest.price, binding.latest.value, binding.latest.count, agoText(g, store.state, binding.latest.lastTick, nowTick(store.state)), binding.latest.onSaleNow !== null, sameCard ? (unblock?.cashNeeded ?? null) : null)}
          </p>
        )}
        {unblock && !sameCard && <p className="st-line st-hint">{t.unblock(unblock)}</p>}
        <p className="st-line gm-muted">{t.board(board.total, board.wanted, board.missing.length, board.held, board.notChased, board.offAlbum)}</p>
        {board.missing.length > 0 && (
          <ul className="st-sale-missing">
            {board.missing.map((m) => (
              <li key={m.card}>
                <CardRef code={m.card} name={m.name ?? undefined} />
                <span>{t.boardMissing(m.price, m.cap, m.room)}</span>
              </li>
            ))}
          </ul>
        )}
        {jev && <p className="st-line">{t.jev({ ...jev, give: jev.give && (nameOfRef(jev.give) ?? jev.give), want: jev.want && (nameOfRef(jev.want) ?? jev.want) })}</p>}
        <details className="st-details st-blocked">
          <summary>
            {t.blocked} ({blocked.length})
          </summary>
          {blocked.length ? (
            <ul className="st-blocks">
              {blocked.map((b) => (
                <BlockedRow key={b.card} b={b} />
              ))}
            </ul>
          ) : (
            <Empty>{t.noBlocks}</Empty>
          )}
        </details>
      </Panel>
      <Panel title={t.hold} sub={t.holdSub(holdings.copies, albumCopies, listed, spareNotListed)}>
        {holdings.copies === 0 && <Empty>{t.nothingHeld}</Empty>}
        {holdings.pages.length > 0 && (
          <>
            <h3 className="eyebrow st-h3">{t.album}</h3>
            <ul className="st-pages">
              {holdings.pages.map((pg) => (
                <PageRow key={pg.set} pg={pg} />
              ))}
            </ul>
          </>
        )}
        {holdings.onSale.length > 0 && (
          <>
            <h3 className="eyebrow st-h3">{t.onSale}</h3>
            <SaleTable rows={holdings.onSale} />
          </>
        )}
        {holdings.notListed.length > 0 && (
          <>
            <h3 className="eyebrow st-h3">{t.notListed}</h3>
            <ul className="st-spares">
              {groupByWhy(holdings.notListed, t.spareWhy).map(([why, rows]) => (
                <li key={why}>
                  <span className="st-spare-why">{why}</span>
                  <span className="st-chips">
                    {rows.map((r) => (
                      <span key={r.ref} className="st-chip" title={r.makerWhy ?? undefined}>
                        <CardRef code={r.ref} />
                        {r.copies > 1 && <span className="gm-muted">{t.copies(r.copies)}</span>}
                        <span className="gm-muted">{p(r.value)}</span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <DuelsLine n={onHold} />
      </Panel>
    </>
  )
}
