/**
 * The "Injection attempts" panel, on the show, /debug and /injections: every text a counterparty sent us with a
 * prompt-injection shape, as our agents recorded it, with the proof to verify it and what our agent did.
 *
 * SECURITY: `raw` is hostile. It is rendered ONLY as React text nodes (escaped by React): never
 * dangerouslySetInnerHTML, never markdown, never in an attribute (href, src, title, style). Hidden characters are
 * replaced by visible markers (⟨U+200B⟩), so a bidi override cannot reorder what is shown, and a stack of combining
 * marks becomes one marker (⟨+238 marks⟩) and the text box clips what is left, so nothing paints over the page.
 * Nothing here talks to the speech queue or the TTS proxy.
 */
import { useState, type MouseEvent } from 'react'
import type { InjectionAttempt } from '../../shared/injections.ts'
import { useLang } from './lang'
import { hrefOf, navigate } from './route'
import { hiddenCount, INJECTION_STRINGS, preview, revealHidden, useInjections, type InjectionsState, type InjectionStrings } from './injectionRows'
import './injections.css'

/** A hostile text as plain text, with each hidden character shown as a marker. */
export function HostileText({ text }: { readonly text: string }) {
  return (
    <>
      {revealHidden(text).map((s, i) =>
        'hidden' in s ? (
          <span key={i} className="inj-hidden">
            ⟨{s.hidden}⟩
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

function Said({ raw, t }: { readonly raw: string; readonly t: InjectionStrings }) {
  const [open, setOpen] = useState(false)
  const cut = preview(raw)
  const hidden = hiddenCount(raw)
  return (
    <div className="inj-said">
      <p className="inj-raw">
        <HostileText text={open || !cut.cut ? raw : cut.text} />
        {cut.cut && !open && '…'}
      </p>
      {hidden > 0 && <span className="inj-flag">{t.hidden(hidden)}</span>}
      {cut.cut && (
        <button type="button" className="inj-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t.less : t.more(cut.length)}
        </button>
      )}
    </div>
  )
}

function when(row: InjectionAttempt, t: InjectionStrings): string {
  const time = row.seenAt ? new Date(row.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
  return row.tick === null ? time : `${time} · ${t.tick(row.tick)}`
}

function Row({ row, t }: { readonly row: InjectionAttempt; readonly t: InjectionStrings }) {
  return (
    <li className="inj-row" data-severity={row.severity}>
      <div className="inj-meta">
        <span className="inj-when">{when(row, t)}</span>
        <span className="inj-from">{row.from ?? '—'}</span>
        <span className="inj-channel">{t.channel[row.source]}</span>
        {row.toUs && <span className="inj-pill">{t.toUs}</span>}
        {row.severity === 'weak' && <span className="inj-pill inj-weak">{t.weak}</span>}
        {row.tags.map((tag) => (
          <span key={tag} className="inj-tag">
            {tag}
          </span>
        ))}
      </div>
      <Said raw={row.raw} t={t} />
      <dl className="inj-facts">
        <div>
          <dt>{t.head.response}</dt>
          <dd>{row.ourResponse || '—'}</dd>
        </div>
        <div>
          <dt>{t.head.proof}</dt>
          <dd>
            <code>{row.proof}</code>
          </dd>
        </div>
      </dl>
    </li>
  )
}

interface ViewProps {
  readonly state: InjectionsState
  readonly t: InjectionStrings
  readonly className?: string
  /** At most this many rows (the show keeps a few), with a link to every row. */
  readonly max?: number
  /** The judges' view, for that link. */
  readonly allHref?: string
  readonly onAll?: (e: MouseEvent<HTMLAnchorElement>) => void
}

/** The panel from a state: pure, so tests render it without a server. */
export function InjectionsView({ state, t, className, max, allHref, onAll }: ViewProps) {
  const [weak, setWeak] = useState(false)
  const { snapshot, status } = state
  const shown = weak ? snapshot.rows : snapshot.rows.filter((r) => r.severity === 'attempt')
  const rows = max === undefined ? shown : shown.slice(0, max)
  const total = snapshot.counts.attempt + (weak ? snapshot.counts.weak : 0)
  // the show (`max`) is projected: it shows rows (or the mock), never a setup note, a loading line or an error; a failed
  // read keeps the rows it had (the snapshot stays), with no notice
  const compact = max !== undefined
  if (compact && status !== 'mock' && !snapshot.ready) return null
  const notice = compact && status !== 'mock' ? null : status === 'live' ? (snapshot.ready ? null : t.missing) : t.status[status]
  return (
    <section className={`inj material${className ? ` ${className}` : ''}`} aria-labelledby="inj-title">
      <header className="inj-head">
        <h2 id="inj-title">
          {t.title} <small className="inj-sub">{t.sub(snapshot.counts.attempt, snapshot.counts.weak)}</small>
        </h2>
        {snapshot.counts.weak > 0 && (
          <label className="inj-toggle">
            <input type="checkbox" checked={weak} onChange={(e) => setWeak(e.target.checked)} />
            {t.showWeak(snapshot.counts.weak)}
          </label>
        )}
      </header>
      <p className="inj-note">{t.note}</p>
      {notice && <p className="inj-status">{notice}</p>}
      {rows.length === 0 ? (
        (status === 'mock' || (status === 'live' && snapshot.ready)) && <p className="inj-empty">{t.empty}</p>
      ) : (
        <ol className="inj-list">
          {rows.map((r) => (
            <Row key={r.id} row={r} t={t} />
          ))}
        </ol>
      )}
      {allHref !== undefined && total > rows.length && (
        <a className="inj-all" href={allHref} onClick={onAll}>
          {t.all(total)}
        </a>
      )}
    </section>
  )
}

/** The panel, reading /api/injections (or the mock rows with `?mock=1`); with `max`, a few rows and a link to the rest. */
export function InjectionsPanel({ mock, className, max }: { readonly mock: boolean; readonly className?: string; readonly max?: number }) {
  const state = useInjections(mock)
  const t = INJECTION_STRINGS[useLang()]
  const toAll = (e: MouseEvent<HTMLAnchorElement>): void => {
    // a new tab or window keeps the browser's own behaviour
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate('injections')
  }
  const link = max === undefined ? {} : { allHref: hrefOf('injections', window.location.search), onAll: toAll }
  return <InjectionsView state={state} t={t} className={className} max={max} {...link} />
}
