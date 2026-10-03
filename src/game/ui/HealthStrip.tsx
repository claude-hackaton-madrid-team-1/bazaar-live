import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TICK_BUDGET_S } from '../../../shared/health.ts'
import { hhmm, useGameStrings, type GameStrings } from '../strings.ts'
import { useGame, useWallNow } from '../store.ts'
import { healthChips, type HealthChip } from '../views/health.ts'

/** A dot and a word per state, never colour alone. */
const MARK = { good: '●', warn: '▲', bad: '■', neutral: '○' } as const

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

/** The panel a chip opens: what /health said, every reason that holds, and what the decisions say. */
function Details({ chip, t, nowMs, onClose }: { chip: HealthChip; t: GameStrings; nowMs: number; onClose: () => void }) {
  const h = t.health
  const r = chip.report
  const st = chip.status
  const at = (iso: string | null) => (iso ? hhmm(iso) : null)
  const decisions = st.state === 'none' ? t.agt.noLog : st.silentFor == null ? t.agt.never : t.agt.ago(st.silentFor)
  return (
    <div className="gm-health-panel" role="dialog" aria-label={`${chip.agent} · ${h.label}`}>
      <div className="gm-health-head">
        <b className="gm-mono">{chip.agent}</b>
        <span className="gm-health-reason" data-tone={chip.tone}>
          {MARK[chip.tone]} {chip.reason ? h.reason(chip.reason) : h.ok}
          {at(chip.since) && <span className="gm-muted"> · {h.since(at(chip.since) as string)}</span>}
          {chip.health?.tone === 'good' && chip.reason && <span className="gm-muted">{t.agt.healthFine}</span>}
        </span>
        <button type="button" className="gm-health-x" onClick={onClose} aria-label={h.close}>
          ×
        </button>
      </div>
      {chip.health && chip.health.all.length > 1 && (
        <ul className="gm-health-all" aria-label={h.problems}>
          {chip.health.all.map((x) => (
            <li key={x.kind}>
              {h.reason(x)}
              {at(r?.since[x.kind] ?? null) && <span className="gm-muted"> · {h.since(at(r?.since[x.kind] ?? null) as string)}</span>}
            </li>
          ))}
        </ul>
      )}
      <dl className="gm-health-facts">
        {r && r.error !== null && <Row label="/health">{h.error[r.error]}</Row>}
        {r && r.error === null && (
          <>
            {r.mode && <Row label={h.row.mode}>{h.mode[r.mode]}</Row>}
            {r.target && <Row label={h.row.game}>{h.target[r.target]}</Row>}
            {r.ledger && <Row label={h.row.ledger}>{h.ledger[r.ledger]}</Row>}
            {r.tick != null && (
              <Row label={h.row.lastTick}>
                {h.tickOf(r.tick, r.serverTick)}
                {r.tickAgeS != null && <span className="gm-muted"> · {h.ago(r.tickAgeS)}</span>}
              </Row>
            )}
            {r.doors && (
              <Row label={h.row.doors}>
                {r.paused ? h.doors.paused : h.doors[r.doors]}
                {r.doors === 'closed' && at(r.nextOpens) && <span className="gm-muted"> · {at(r.nextOpens)}</span>}
              </Row>
            )}
            {r.tickMs != null && <Row label={h.row.tickTime}>{`${Math.round(r.tickMs / 100) / 10} / ${r.tickBudgetS ?? TICK_BUDGET_S} s`}</Row>}
            {r.rateLimited != null && r.rateLimited > 0 && <Row label={h.row.rateLimited}>×{r.rateLimited}</Row>}
            {(r.jevMs != null || r.jevUndecided != null) && (
              <Row label={h.row.jev}>
                {[r.jevMs != null ? `${Math.round(r.jevMs / 100) / 10} s` : null, r.jevUndecided != null ? h.undecided(r.jevUndecided) : null].filter(Boolean).join(' · ')}
              </Row>
            )}
          </>
        )}
        <Row label={h.row.decisions}>{decisions}</Row>
        {r && <Row label={h.row.checked}>{h.ago(Math.max(0, Math.round((nowMs - Date.parse(r.checkedAt)) / 1000)))}</Row>}
      </dl>
      {!r && <p className="gm-muted gm-health-note">{chip.agent === 'duels' ? h.noHttp : h.noReport}</p>}
    </div>
  )
}

/**
 * One chip per agent in the header: green, amber or red with the one reason that matters (a green chip says only
 * its name). A click opens the details under the strip; a click elsewhere or Escape closes them.
 */
export function HealthStrip() {
  const store = useGame()
  const t = useGameStrings()
  const nowMs = useWallNow(5000)
  const chips = healthChips(store.state, nowMs)
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open === null) return
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const chip = chips.find((c) => c.agent === open)
  return (
    <div className="gm-health" ref={ref} role="group" aria-label={t.health.label}>
      {chips.map((c) => {
        const reason = c.reason ? t.health.reason(c.reason) : null
        return (
          <button
            key={c.agent}
            type="button"
            className="hdr-chip gm-health-chip"
            data-tone={c.tone}
            aria-expanded={open === c.agent}
            title={t.health.title(c.agent, reason ?? t.health.ok)}
            onClick={() => setOpen(open === c.agent ? null : c.agent)}
          >
            <span className="gm-health-mark" aria-hidden="true">
              {MARK[c.tone]}
            </span>
            <span className="gm-health-name">{c.agent}</span>
            {reason && <span className="gm-health-why">{reason}</span>}
          </button>
        )
      })}
      {chip && <Details chip={chip} t={t} nowMs={nowMs} onClose={() => setOpen(null)} />}
    </div>
  )
}
