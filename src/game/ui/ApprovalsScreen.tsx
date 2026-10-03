/**
 * The Approvals screen (HA2): every buy or sell our agents may not make alone (priced at or above
 * `human_approval_above`) waits here for a human yes or no. A password unlocks it; the server holds every token and
 * calls bazaar-mcp's human tools. Approve asks for a second click: it unlocks real money.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ActiveApproval, ApprovalLimits, ApprovalsSnapshot, PendingRequest } from '../../../shared/approvals.ts'
import { REASON_MAX } from '../../../shared/approvals.ts'
import {
  approvalLimitOf, approve, approveInputFrom, checkPrice, checkTtl, denyInput, login, logout, orderActive, orderPending, priceBounds,
  readApprovals, readSession, reasonTooLong, REFRESH_MS, revoke, rowKey, staleness, ticksLeft, type LoginOutcome, type WriteOutcome,
} from '../approvals.ts'
import { p, useApprovalsStrings } from '../approvalsStrings.ts'
import { Badge, CardRef, Empty, Panel } from './bits.tsx'
import './approvals.css'

export function ApprovalsScreen() {
  const t = useApprovalsStrings()
  // undefined: asking the server; null: locked; a string: the session's CSRF token, in memory only
  const [csrf, setCsrf] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    void readSession(controller.signal).then((token) => {
      if (!controller.signal.aborted) setCsrf(token ?? null)
    })
    return () => controller.abort()
  }, [])
  const expired = useCallback(() => setCsrf(null), [])
  const lock = useCallback(() => {
    void logout().then(() => setCsrf(null))
  }, [])
  if (csrf === undefined) {
    return (
      <Panel title={t.title}>
        <Empty>{t.checking}</Empty>
      </Panel>
    )
  }
  if (csrf === null) return <Unlock onIn={setCsrf} />
  return <Approvals csrf={csrf} onExpired={expired} onLock={lock} />
}

function loginMessage(t: ReturnType<typeof useApprovalsStrings>, out: Exclude<LoginOutcome, { kind: 'in' }>): string {
  if (out.kind === 'wrong') return t.wrong
  if (out.kind === 'locked') return t.locked(out.minutes)
  return t.loginError
}

function Unlock({ onIn }: { onIn: (csrf: string) => void }) {
  const t = useApprovalsStrings()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<Exclude<LoginOutcome, { kind: 'in' }> | null>(null)
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    // never a native submit (the page's CSP has form-action 'none'): the password goes only in this fetch's body
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    const out = await login(password)
    setBusy(false)
    setPassword('')
    if (out.kind === 'in') onIn(out.csrf)
    else setFailed(out)
  }
  return (
    <Panel title={t.loginTitle} className="ap-unlock">
      <p className="ap-lead gm-muted">{t.loginSub}</p>
      <form className="ap-login" onSubmit={(e) => void submit(e)} noValidate>
        <label className="ap-field">
          <span>{t.password}</span>
          {/* no name attribute: the field is never part of a form submission */}
          <input className="ap-input" type="password" autoComplete="current-password" value={password} maxLength={512} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <button className="gm-btn ap-primary" type="submit" disabled={busy || !password}>
          {busy ? t.unlocking : t.unlock}
        </button>
      </form>
      {failed && (
        <p className="ap-msg" data-tone="bad" role="alert">
          {loginMessage(t, failed)}
        </p>
      )}
    </Panel>
  )
}

type ReadStatus = 'loading' | 'live' | 'unavailable'

/** Reads every REFRESH_MS while the tab is visible, at once when it comes back, and whenever `version` moves. */
function useApprovalsFeed(onExpired: () => void, version: number): { status: ReadStatus; snapshot: ApprovalsSnapshot | null } {
  const [state, setState] = useState<{ status: ReadStatus; snapshot: ApprovalsSnapshot | null }>({ status: 'loading', snapshot: null })
  useEffect(() => {
    let stopped = false
    let controller: AbortController | null = null
    const read = async (): Promise<void> => {
      if (document.visibilityState !== 'visible') return
      controller?.abort()
      controller = new AbortController()
      try {
        const out = await readApprovals(controller.signal)
        if (stopped) return
        if (out.kind === 'expired') onExpired()
        else if (out.kind === 'live') setState({ status: 'live', snapshot: out.snapshot })
        else setState((s) => ({ status: 'unavailable', snapshot: s.snapshot }))
      } catch (error: unknown) {
        if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) setState((s) => ({ status: 'unavailable', snapshot: s.snapshot }))
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void read()
    }
    void read()
    const timer = setInterval(() => void read(), REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      controller?.abort()
    }
  }, [onExpired, version])
  return state
}

function Approvals({ csrf, onExpired, onLock }: { csrf: string; onExpired: () => void; onLock: () => void }) {
  const t = useApprovalsStrings()
  const [version, setVersion] = useState(0)
  const { status, snapshot } = useApprovalsFeed(onExpired, version)
  // after every write: read again now, and a lapsed session goes back to the lock
  const done = useCallback(
    (out: WriteOutcome) => {
      if (out.kind === 'error' && out.error === 'expired') onExpired()
      else setVersion((v) => v + 1)
    },
    [onExpired],
  )
  const pending = snapshot ? orderPending(snapshot.pending) : []
  const active = snapshot ? orderActive(snapshot.active) : []
  const waiting = pending.filter((r) => r.state === 'waiting').length
  return (
    <>
      <Panel
        title={t.title}
        sub={snapshot ? t.sub(snapshot.threshold) : undefined}
        actions={
          <>
            {snapshot && <Badge>{t.tick(snapshot.tick)}</Badge>}
            <button type="button" className="gm-btn" onClick={onLock}>
              {t.lock}
            </button>
          </>
        }
      >
        {status === 'loading' && <Empty>{t.checking}</Empty>}
        {status === 'unavailable' && (
          <p className="ap-msg" data-tone="bad" role="status">
            {t.unavailable}
          </p>
        )}
        {snapshot && snapshot.skipped > 0 && <p className="ap-msg" data-tone="warn">{t.skipped(snapshot.skipped)}</p>}
        {snapshot && snapshot.notes.length > 0 && (
          <ul className="ap-notes" aria-label={t.notes}>
            {snapshot.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </Panel>
      {snapshot && (
        <Panel title={t.pending} sub={t.pendingSub(waiting, pending.length)}>
          {pending.length === 0 ? (
            <Empty>{t.noPending}</Empty>
          ) : (
            <ul className="ap-list">
              {pending.map((row, i) => (
                <PendingRow key={`${rowKey(row)}#${i}`} row={row} tick={snapshot.tick} limits={snapshot.limits} csrf={csrf} onDone={done} />
              ))}
            </ul>
          )}
        </Panel>
      )}
      {snapshot && (
        <Panel title={t.active} sub={t.activeSub(active.length)}>
          {active.length === 0 ? (
            <Empty>{t.noActive}</Empty>
          ) : (
            <ul className="ap-list">
              {active.map((a, i) => (
                <ActiveRow key={`${a.card}|${a.side}#${i}`} a={a} tick={snapshot.tick} csrf={csrf} onDone={done} />
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  )
}

/** What a write answered, in one line (and a refusal's reasons). Never the server's own error words. */
function Outcome({ out }: { out: WriteOutcome | null }) {
  const t = useApprovalsStrings()
  if (!out) return null
  if (out.kind === 'error') {
    return (
      <p className="ap-msg" data-tone="bad" role="alert">
        {t.error[out.error]}
      </p>
    )
  }
  if (out.kind === 'revoke') {
    const r = out.result
    return (
      <p className="ap-msg" data-tone="neutral" role="status">
        {r.status === 'denied' ? t.denied(r.card, r.side) : t.revoked(r.card, r.side)}
      </p>
    )
  }
  const r = out.result
  if (r.status === 'refused') {
    return (
      <div className="ap-msg" data-tone="bad" role="alert">
        {t.refused}
        <ul>
          {r.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div className="ap-msg" data-tone="good" role="status">
      {t.approved(r.card, r.side, r.side === 'buy' ? r.max_price : r.min_price, r.until_tick)}
      {r.notes.length > 0 && (
        <ul>
          {r.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PendingFacts({ row, tick }: { row: PendingRequest; tick: number }) {
  const t = useApprovalsStrings()
  const stale = staleness(row, tick)
  return (
    <dl className="ap-facts">
      {(row.why || row.score_impact !== null) && (
        <div>
          <dt>{t.whyLabel}</dt>
          <dd>
            {row.why}
            {row.score_impact !== null && (
              <>
                {row.why && ' · '}
                <b className={row.score_impact < 0 ? 'gm-bad' : 'gm-good'}>{t.scoreImpact(row.score_impact)}</b>
              </>
            )}
          </dd>
        </div>
      )}
      <div>
        <dt>{t.values}</dt>
        <dd>
          <span className="gm-num">{p(row.our_value)}</span> <span className="gm-muted">{t.ourValue}</span> · <span className="gm-num">{p(row.official_value)}</span>{' '}
          <span className="gm-muted">{t.officialValue}</span>
        </dd>
      </div>
      {row.album && (
        <div>
          <dt>{t.albumLabel}</dt>
          <dd className="ap-album">
            <span>{t.album(row.album)}</span>
            {row.album.last_copy && (
              <Badge tone="bad" title={t.lastCopyTitle}>
                {t.lastCopy}
              </Badge>
            )}
          </dd>
        </div>
      )}
      <div>
        <dt>{t.askedLabel}</dt>
        <dd>
          {t.askedAt(row.asked_tick)} · {t.askedBy(row.asked_by, row.counterparty)}
          {row.stale_after_tick !== null && (
            <>
              {' · '}
              <span className={stale.stale ? 'gm-warn' : undefined}>{stale.stale ? t.staleSince(row.stale_after_tick) : t.staleIn(row.stale_after_tick, stale.left ?? 0)}</span>
            </>
          )}
        </dd>
      </div>
      {row.side === 'buy' && row.cap && (
        <div>
          <dt>{t.capLabel}</dt>
          <dd>{t.cap(row.cap.max_price, row.cap.rule)}</dd>
        </div>
      )}
    </dl>
  )
}

function PendingRow({ row, tick, limits, csrf, onDone }: { row: PendingRequest; tick: number; limits: ApprovalLimits; csrf: string; onDone: (out: WriteOutcome) => void }) {
  const t = useApprovalsStrings()
  const [price, setPrice] = useState(String(row.price))
  const [ttl, setTtl] = useState(String(limits.ttl_default))
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<WriteOutcome | null>(null)
  const bounds = priceBounds(row, limits)
  const priceCheck = checkPrice(price, bounds)
  const ttlCheck = checkTtl(ttl, limits)
  const input = approveInputFrom(row, { price, ttl, reason }, limits)
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v)
    setConfirming(false)
  }
  const run = async (write: () => Promise<WriteOutcome>) => {
    setBusy(true)
    const result = await write()
    setBusy(false)
    setConfirming(false)
    setOut(result)
    onDone(result)
  }
  const onApprove = () => {
    if (!input || busy) return
    if (!confirming) return setConfirming(true)
    void run(() => approve(csrf, input))
  }
  const waiting = row.state === 'waiting'
  const id = rowKey(row).replace(/[^A-Za-z0-9]/g, '-')
  return (
    <li className="ap-row" data-state={row.state}>
      <div className="ap-row-head">
        <CardRef code={row.card} />
        <Badge tone={row.side === 'buy' ? 'us' : 'them'}>{t.side[row.side]}</Badge>
        <b className="ap-price">{t.asks(row.side, row.price)}</b>
        <span className="gm-spacer" />
        <Badge tone={row.state === 'waiting' ? 'warn' : row.state === 'approved' ? 'good' : 'neutral'}>{t.state[row.state]}</Badge>
      </div>
      <PendingFacts row={row} tick={tick} />
      {waiting && (
        <form className="ap-form" onSubmit={(e) => e.preventDefault()} noValidate>
          <label className="ap-field">
            <span>{t.priceLabel(row.side)}</span>
            <input
              className="ap-input ap-num"
              type="number"
              inputMode="numeric"
              min={bounds.min}
              max={bounds.max}
              step={1}
              value={price}
              aria-invalid={!priceCheck.ok}
              aria-describedby={`${id}-price`}
              onChange={(e) => edit(setPrice)(e.target.value)}
            />
          </label>
          <label className="ap-field">
            <span>{t.ttlLabel}</span>
            <input
              className="ap-input ap-num"
              type="number"
              inputMode="numeric"
              min={limits.ttl_min}
              max={limits.ttl_max}
              step={1}
              value={ttl}
              aria-invalid={!ttlCheck.ok}
              onChange={(e) => edit(setTtl)(e.target.value)}
            />
          </label>
          <label className="ap-field ap-reason">
            <span>{t.reasonLabel}</span>
            <input className="ap-input" type="text" maxLength={REASON_MAX} value={reason} aria-invalid={reasonTooLong(reason)} onChange={(e) => edit(setReason)(e.target.value)} />
          </label>
          <div className="ap-buttons">
            <button type="button" className="gm-btn ap-primary" data-confirm={confirming || undefined} disabled={!input || busy} onClick={onApprove}>
              {busy && confirming ? t.sending : confirming && input ? t.confirm(row.card, row.side, input.price) : t.approve}
            </button>
            {confirming ? (
              <button type="button" className="gm-btn" disabled={busy} onClick={() => setConfirming(false)}>
                {t.cancel}
              </button>
            ) : (
              <button type="button" className="gm-btn ap-deny" disabled={busy} onClick={() => void run(() => revoke(csrf, denyInput(row)))}>
                {busy ? t.sending : t.deny}
              </button>
            )}
          </div>
          <p className="ap-hint" id={`${id}-price`}>
            {!priceCheck.ok && <span className="gm-bad">{t.priceError(priceCheck.error, bounds.min, bounds.max, bounds.cap?.rule ?? null)}</span>}
            {!ttlCheck.ok && <span className="gm-bad">{t.ttlError(limits.ttl_min, limits.ttl_max)}</span>}
            {reasonTooLong(reason) && <span className="gm-bad">{t.reasonError(REASON_MAX)}</span>}
          </p>
        </form>
      )}
      <Outcome out={out} />
    </li>
  )
}

function ActiveRow({ a, tick, csrf, onDone }: { a: ActiveApproval; tick: number; csrf: string; onDone: (out: WriteOutcome) => void }) {
  const t = useApprovalsStrings()
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState<WriteOutcome | null>(null)
  const limit = approvalLimitOf(a)
  const onRevoke = async () => {
    setBusy(true)
    const result = await revoke(csrf, { card: a.card, side: a.side })
    setBusy(false)
    setOut(result)
    onDone(result)
  }
  return (
    <li className="ap-row">
      <div className="ap-row-head">
        <CardRef code={a.card} />
        <Badge tone={a.side === 'buy' ? 'us' : 'them'}>{t.side[a.side]}</Badge>
        <b className="ap-price">{t.limit(limit.side, limit.price)}</b>
        <span className="gm-spacer" />
        <button type="button" className="gm-btn ap-deny" disabled={busy} onClick={() => void onRevoke()}>
          {busy ? t.sending : t.revoke}
        </button>
      </div>
      <p className="ap-line gm-muted">
        {t.until(a.until_tick, ticksLeft(a.until_tick, tick))}
        {a.by && ` · ${t.by(a.by)}`}
        {a.reason && ` · ${a.reason}`}
      </p>
      <Outcome out={out} />
    </li>
  )
}
