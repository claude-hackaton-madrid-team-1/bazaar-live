/**
 * Our money against its limits, said the same way on the Agent screen, the Strategy screen and the header: what we can
 * spend right now, and which limit stops us first (highlighted). The numbers come from ../limits.ts.
 */
import { fmtP } from '../game.ts'
import type { Limit, Money, Release } from '../limits.ts'
import { useGameStrings, type GameStrings } from '../strings.ts'
import { share } from '../views/decisions.ts'
import { Badge } from './bits.tsx'

const sourceOf = (t: GameStrings, l: Limit): string => t.money.source(l.source, l.tick)

/** Cash against the floor, then the hour's spend as a meter; the one that leaves less room is marked. */
export function MoneyLevers({ money, release }: { money: Money; release: Release | null }) {
  const t = useGameStrings()
  const m = t.money
  const cashBinds = money.binds === 'cash_floor'
  const spendBinds = money.binds === 'max_spend_per_game_hour'
  const used = money.spent === null ? 0 : share(money.spent, money.maxSpend.value)
  return (
    <dl className="gm-money">
      <div className="gm-money-row" data-binds={cashBinds || undefined} data-zero={(cashBinds && money.available === 0) || undefined}>
        <dt className="eyebrow">
          {m.cashLabel}
          {cashBinds && <Badge tone={money.available === 0 ? 'bad' : 'warn'}>{m.binds}</Badge>}
        </dt>
        <dd>
          <span className="gm-money-line" title={sourceOf(t, money.cashFloor)}>
            {m.cashLine(money.cash === null ? '—' : fmtP(money.cash), String(money.floor), money.available === null ? '—' : String(money.available))}
          </span>
          {money.reserve !== null && <span className="gm-money-note">{m.reserve(money.cashFloor.value, money.reserve)}</span>}
        </dd>
      </div>
      <div className="gm-money-row gm-meter" data-binds={spendBinds || undefined} data-level={used >= 1 ? 'bad' : used >= 0.8 ? 'warn' : 'ok'}>
        <dt className="eyebrow">
          {m.spentLabel}
          {spendBinds && <Badge tone={money.available === 0 ? 'bad' : 'warn'}>{m.binds}</Badge>}
        </dt>
        <dd>
          <span className="gm-meter-num" title={sourceOf(t, money.maxSpend)}>
            {money.spent === null ? '—' : money.spent} / {fmtP(money.maxSpend.value)}
          </span>
          <span className="gm-track" aria-hidden="true">
            <span className="gm-fill" style={{ width: `${Math.round(used * 100)}%` }} />
          </span>
          {release && (
            <span className="gm-money-note" title={m.rolling}>
              {m.release(fmtP(release.amount), release.ticks === null ? '' : t.hum.within(release.ticks, release.seconds))}
            </span>
          )}
        </dd>
      </div>
    </dl>
  )
}

/** The header's chip beside our cash: the floor and what we can buy with; red once nothing is left. */
export function MoneyChip({ money }: { money: Money }) {
  const t = useGameStrings()
  const m = t.money
  if (money.available === null) return null
  const tone = money.available === 0 ? 'bad' : 'ok'
  const spend = money.spent === null ? '' : ` · ${m.spentLabel} ${money.spent} / ${money.maxSpend.value}`
  return (
    <span className="hdr-chip gm-kpi gm-room" data-tone={tone} title={`${m.cashLine(money.cash === null ? '—' : String(money.cash), String(money.floor), String(money.available))}${spend}`}>
      <span className="gm-kpi-label">{m.chip(String(money.floor))}</span>
      <span className="gm-kpi-num">{fmtP(money.available)}</span>
    </span>
  )
}
