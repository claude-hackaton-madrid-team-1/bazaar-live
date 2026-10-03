import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { LANGS, type Lang } from '../../../shared/lang.ts'
import { setLang, useLang, useStrings } from '../../ui/lang'
import { Nav } from '../../ui/Nav'
import { hrefOf, navigate } from '../../ui/route'
import { fmtP, signed } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame, useNow, type GameStatus } from '../store.ts'
import { ledger } from '../views/decisions.ts'
import { lastCashChange } from '../views/history.ts'
import { HealthStrip } from './HealthStrip.tsx'
import { MoneyChip } from './Money.tsx'
import '../../ui/header.css'

const LANG_NAME: Readonly<Record<Lang, string>> = { es: 'Castellano', en: 'English' }

/** The status chip's colour family: live green, mock grey, trouble amber, off red. */
const STATUS_TONE: Readonly<Record<GameStatus, string>> = {
  live: 'live',
  mock: 'mock',
  connecting: 'wait',
  reconnecting: 'wait',
  off: 'off',
  locked: 'off',
}

function LangToggle() {
  const lang = useLang()
  const t = useStrings()
  const reduce = useReducedMotion()
  return (
    <div className="hdr-seg" role="group" aria-label={t.langLabel}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={l === lang} title={LANG_NAME[l]} onClick={() => setLang(l)}>
          {l === lang && <motion.span layoutId="lang-thumb" className="hdr-seg-thumb" transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.36 }} />}
          <span className="hdr-seg-label">{l.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}

function Kpi({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="hdr-chip gm-kpi">
      <span className="gm-kpi-label">{label}</span>
      <span className="gm-kpi-num">{children}</span>
    </span>
  )
}

/**
 * Our cash, always in sight: in the header, larger than the other figures, with its last change; and, once
 * the header has scrolled away, as a pill in the corner (CashDock). Both open the Movements screen.
 */
function Cash({ dock = false }: { dock?: boolean }) {
  const store = useGame()
  const t = useGameStrings()
  const s = store.state
  const last = lastCashChange(s.history)
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate('history')
  }
  return (
    <a
      className={dock ? 'gm-cashdock glass' : 'hdr-chip gm-kpi gm-cash'}
      href={hrefOf('history', window.location.search)}
      onClick={go}
      title={last ? `${t.cashHint} · ${t.cashLast(signed(last.delta), last.tick)}` : t.cashHint}
    >
      <span className="gm-kpi-label">{t.cash}</span>
      <span className="gm-cash-num">{s.team ? fmtP(s.cash) : '—'}</span>
      {last && (
        <span className="gm-cash-delta" data-tone={last.delta > 0 ? 'in' : 'out'}>
          {last.delta > 0 ? '▲' : '▼'} {signed(last.delta)}
        </span>
      )}
    </a>
  )
}

/** The cash pill in the corner, shown only while the header (and its cash) is scrolled out of sight. */
export function CashDock() {
  const store = useGame()
  const [away, setAway] = useState(false)
  useEffect(() => {
    const header = document.querySelector('.gm-hdr')
    if (!header || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setAway(e ? !e.isIntersecting : false))
    io.observe(header)
    return () => io.disconnect()
  }, [])
  return away && store.state.team ? <Cash dock /> : null
}

/** Beside our cash: the floor and what the next buy may cost (the agents' ledger, once it came). */
function Room() {
  const store = useGame()
  const { state: s, version } = store
  // the state is mutated in place: the version is what changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const money = useMemo(() => (s.team ? (ledger(s)?.money ?? null) : null), [s, version])
  return money ? <MoneyChip money={money} /> : null
}

/** Day and tick, with a bar that fills until the next tick. */
function Clock() {
  const store = useGame()
  const t = useGameStrings()
  const now = useNow()
  const s = store.state
  const total = s.tickSeconds || 60
  const start = store.clockLeft ?? total
  const left = store.clockAt ? Math.max(0, start - (now - store.clockAt) / 1000) : total
  const fill = Math.min(100, Math.max(0, 100 * (1 - left / total)))
  return (
    <span className="hdr-chip gm-clock" title={t.secondsLeft(Math.ceil(left))}>
      {s.day && <span className="gm-kpi-label">{s.day}</span>}
      <span className="gm-kpi-label">{t.tick}</span>
      <span className="gm-kpi-num">{s.tick}</span>
      <span className="gm-tickbar" aria-hidden="true">
        <span style={{ width: `${fill}%` }} />
      </span>
    </span>
  )
}

export function GameHeader() {
  const store = useGame()
  const t = useGameStrings()
  const s = store.state
  const team = s.name || s.team
  return (
    <header className="hdr gm-hdr glass">
      <div className="hdr-brand">
        <span className="hdr-mark" aria-hidden="true">
          <i />
          <i />
        </span>
        <h1 className="hdr-word">
          Bazaar <span>Live</span>
        </h1>
        <small className="hdr-tag">{t.brandTag}</small>
      </div>
      <Nav />
      <div className="hdr-status">
        <span className="hdr-chip gm-status" data-tone={STATUS_TONE[store.status]} role="status">
          <span className="gm-dot" />
          {t.status[store.status]}
        </span>
        <HealthStrip />
        {store.source && store.status !== 'mock' && (
          <span className="hdr-chip gm-source" data-source={store.source} title={store.source === 'db' ? t.source.dbTitle : t.source.apiTitle}>
            {t.source[store.source]}
          </span>
        )}
        {team && (
          <span className="hdr-chip gm-team" title={s.team}>
            {team}
            {s.team && s.name && <span className="hdr-who">{s.team}</span>}
          </span>
        )}
        <Clock />
        <span className="gm-money-chips">
          <Cash />
          <Room />
        </span>
        <Kpi label={t.score}>{s.score.score ?? '—'}</Kpi>
        <Kpi label={t.rank}>{s.score.rank != null ? `#${s.score.rank}` : '—'}</Kpi>
      </div>
      <div className="hdr-controls">
        <LangToggle />
        <button type="button" className="hdr-mute gm-pause" aria-pressed={store.paused} title={t.pauseTitle} onClick={() => store.setPaused(!store.paused)}>
          <svg className="hdr-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {store.paused ? <path d="M8 5.5v13l10.5-6.5z" /> : <path d="M8.5 5.5v13M15.5 5.5v13" />}
          </svg>
          {store.paused ? t.resume : t.pause}
        </button>
      </div>
    </header>
  )
}

export function NoticeBar({ children }: { children: ReactNode }) {
  return (
    <div className="notice glass">
      <svg className="hdr-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5.5M12 7.75v.01" />
      </svg>
      <p>{children}</p>
    </div>
  )
}

/** Mock, no feed, a locked view, or a feed with no team: say so above the screen. */
export function GameNotice() {
  const store = useGame()
  const t = useGameStrings()
  if (store.status === 'mock') return <NoticeBar>{t.notice.mock}</NoticeBar>
  if (store.status === 'off') {
    const params = new URLSearchParams(window.location.search)
    params.set('mock', '1')
    return (
      <NoticeBar>
        {t.notice.off} <a href={`${window.location.pathname}?${params.toString()}`}>{t.notice.tryMock}</a>.
      </NoticeBar>
    )
  }
  if (store.status === 'locked') return <NoticeBar>{t.notice.locked}</NoticeBar>
  if (store.status === 'live' && !store.state.team && store.state.events.length > 0) return <NoticeBar>{t.notice.noTeam}</NoticeBar>
  return null
}
