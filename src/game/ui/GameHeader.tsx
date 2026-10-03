import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { LANGS, type Lang } from '../../../shared/lang.ts'
import { setLang, useLang, useStrings } from '../../ui/lang'
import { Nav } from '../../ui/Nav'
import { fmtP } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame, useNow, type GameStatus } from '../store.ts'
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
        {team && (
          <span className="hdr-chip gm-team" title={s.team}>
            {team}
            {s.team && s.name && <span className="hdr-who">{s.team}</span>}
          </span>
        )}
        <Clock />
        <Kpi label={t.cash}>{s.team ? fmtP(s.cash) : '—'}</Kpi>
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
