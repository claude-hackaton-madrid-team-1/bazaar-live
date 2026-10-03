import { motion, useReducedMotion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { TTS_PICKER, type TtsChoice } from '../config'
import { AGENTS, type AgentHealth, type AgentId } from '../model/events'
import type { FeedStatus } from '../net/feed'
import type { ShowState } from '../show/engine'
import { LANGS, type Lang } from '../../shared/lang.ts'
import { setLang, useLang, useStrings } from './lang'
import { Nav } from './Nav'
import { modeOf, rememberTargets, worldOf, type Mode, type Targets, type World } from './mode'
import type { SpeechControls } from './useShow'
import './header.css'

/** A 24-unit line icon: stroke, round caps, sized and coloured by its CSS. */
function Icon({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <svg className={`hdr-ico ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

const SPEAKER = <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />

function SpeakerOn() {
  return (
    <Icon>
      {SPEAKER}
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </Icon>
  )
}

function SpeakerOff({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      {SPEAKER}
      <path d="M16 10l4 4m0-4l-4 4" />
    </Icon>
  )
}

/** One glyph per world, so the state never rests on colour alone. */
const WORLD_ICON: Readonly<Record<World, ReactNode>> = {
  real: (
    <>
      <circle cx="12" cy="12" r="8" />
      <ellipse cx="12" cy="12" rx="3.5" ry="8" />
      <path d="M4 12h16" />
    </>
  ),
  simulator: (
    <>
      <path d="M12 3.75l7.25 4.1v8.3L12 20.25l-7.25-4.1v-8.3z" />
      <path d="M4.75 7.85L12 12l7.25-4.15M12 12v8.25" />
    </>
  ),
  mixed: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16z" className="hdr-ico-fill" />
    </>
  ),
  mock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.25" className="hdr-ico-fill" />
    </>
  ),
  unknown: <circle cx="12" cy="12" r="8" strokeDasharray="2.5 3.2" />,
}

function ModeBadge({ agent, health, feed, mock }: { agent: AgentId; health: AgentHealth | null; feed: FeedStatus; mock: boolean }) {
  const mode = modeOf(health, feed)
  const t = useStrings()
  const reduce = useReducedMotion()
  const connecting = feed === 'connecting' || feed === 'reconnecting'
  return (
    <span className="hdr-chip hdr-mode" data-mode={mode} title={`${agent}: ${mode}${connecting ? ` (feed ${feed})` : ''}`}>
      {mode === 'live' && !reduce ? (
        <motion.span className="hdr-dot" animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
      ) : (
        <span className="hdr-dot" />
      )}
      <span>
        {mock && <span className="hdr-mock">{`${t.mock} · `}</span>}
        {t.modes[mode satisfies Mode]}
      </span>{' '}
      <span className="hdr-who">{t.who[agent]}</span>
      {connecting && (
        <span className="hdr-spin" role="img" aria-label="reconnecting">
          <Icon>
            <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          </Icon>
        </span>
      )}
    </span>
  )
}

/** Always visible: which game the agents play in (the real one or the simulator), from their /health. */
function WorldBadge({ state, mock }: { state: ShowState; mock: boolean }) {
  const t = useStrings()
  // Each agent's target is remembered across a failed poll (it is fixed per deploy): one missed /health
  // must not turn MIXED into REAL.
  const [known, setKnown] = useState<Targets>({ taker: null, maker: null })
  const next = rememberTargets(known, state.health)
  if (next !== known) setKnown(next)
  const world = worldOf(next, mock)
  const detail = `${t.who.taker}: ${next.taker ? t.worlds[next.taker] : '?'} · ${t.who.maker}: ${next.maker ? t.worlds[next.maker] : '?'}`
  return (
    <span className="hdr-chip hdr-world" data-world={world} role="status" title={mock ? t.worlds.mock : detail}>
      <Icon>{WORLD_ICON[world]}</Icon>
      {t.worlds[world]}
    </span>
  )
}

function Heartbeat({ state }: { state: ShowState }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  const beats = state.heartbeat.taker + state.heartbeat.maker
  const tick = state.ticks.taker ?? state.ticks.maker ?? state.health.taker?.tick ?? state.health.maker?.serverTick ?? null
  return (
    <span className="hdr-chip hdr-beat" aria-label={tick === null ? t.noTick : `${t.tick} ${tick}`}>
      {/* each beat redraws the pulse line once (a fade under Reduce Motion) */}
      <motion.svg
        key={beats}
        className="hdr-ico"
        viewBox="0 0 24 24"
        aria-hidden="true"
        initial={reduce ? { opacity: 0.4 } : { opacity: 0.55 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <motion.path d="M2.5 12h4l2.5-6 5 12 2.5-6h5" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
      </motion.svg>
      <span className="hdr-beat-label">{t.tick}</span>
      <span className="hdr-beat-num">{tick ?? '—'}</span>
    </span>
  )
}

export function Header({ state, speech, mock }: { state: ShowState; speech: SpeechControls; mock: boolean }) {
  const t = useStrings()
  const unavailable = (c: TtsChoice) => (c === 'elevenlabs' || c === 'gemini') && !speech.available.includes(c)
  return (
    <header className="hdr glass">
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
      <div className="hdr-status" aria-label="Agent modes">
        <WorldBadge state={state} mock={mock} />
        {AGENTS.map((a) => (
          <ModeBadge key={a} agent={a} health={state.health[a]} feed={state.feeds[a]} mock={mock} />
        ))}
        {speech.elevenMissing && (
          <span className="hdr-chip hdr-novoice" role="status" title={t.noEleven}>
            <SpeakerOff />
            ElevenLabs
          </span>
        )}
        {speech.noVoiceFor && (
          <span className="hdr-chip hdr-novoice" role="status" title={t.noVoice}>
            <SpeakerOff />
            {speech.noVoiceFor.toUpperCase()}
          </span>
        )}
        <Heartbeat state={state} />
      </div>
      <div className="hdr-controls">
        <LangToggle />
        <span className="hdr-voice">
          <label className="sr-only" htmlFor="voice">
            {t.voiceLabel}
          </label>
          <select
            id="voice"
            value={speech.choice === 'auto' ? 'elevenlabs' : speech.choice}
            onChange={(e) => speech.setChoice(e.target.value as TtsChoice)}
            title={speech.lastError ? `Last voice error: ${speech.lastError}` : `Speaking with: ${speech.active}`}
          >
            {(TTS_PICKER.includes(speech.choice) || speech.choice === 'auto' ? TTS_PICKER : [...TTS_PICKER, speech.choice]).map((c) => (
              <option key={c} value={c} disabled={unavailable(c)}>
                {t.voices[c]}
                {unavailable(c) ? ` (${t.noKey})` : ''}
              </option>
            ))}
          </select>
          <Icon className="hdr-chev">
            <path d="M7 10l5 5 5-5" />
          </Icon>
        </span>
        <button type="button" className="hdr-mute" aria-pressed={speech.muted} aria-keyshortcuts="M" onClick={() => speech.setMuted(!speech.muted)}>
          {speech.muted ? <SpeakerOff className="hdr-off" /> : <SpeakerOn />}
          {/* both words share one cell, so the button keeps its width when it toggles */}
          <span className="hdr-mute-label">
            <span className={speech.muted ? undefined : 'hdr-idle'}>{t.muted}</span>
            <span className={speech.muted ? 'hdr-idle' : undefined}>{t.soundOn}</span>
          </span>
          <kbd>M</kbd>
        </button>
      </div>
    </header>
  )
}

const LANG_NAME: Readonly<Record<Lang, string>> = { es: 'Castellano', en: 'English' }

/** The ES / EN selector: a segmented control. Choosing re-picks the lines and the voices at once. */
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

function madridTime(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function NoticeBar({ children }: { children: ReactNode }) {
  return (
    <div className="notice glass">
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5.5M12 7.75v.01" />
      </Icon>
      <p>{children}</p>
    </div>
  )
}

/** Doors closed or both feeds down: say so instead of an empty stage. */
export function Notice({ state, mock }: { state: ShowState; mock: boolean }) {
  const t = useStrings()
  const lang = useLang()
  if (mock) return <NoticeBar>{t.mockNotice}</NoticeBar>
  const closed = AGENTS.map((a) => state.health[a]).find((h) => h?.doors === 'closed')
  if (closed) {
    return (
      <NoticeBar>
        {t.doorsClosed(closed.nextOpens ? madridTime(closed.nextOpens, lang) : null)} <a href="?mock=1">{t.tryMock}</a>.
      </NoticeBar>
    )
  }
  const down = AGENTS.every((a) => state.feeds[a] === 'reconnecting')
  if (down) {
    return (
      <NoticeBar>
        {t.cantReach} <a href="?mock=1">{t.tryMock}</a>.
      </NoticeBar>
    )
  }
  return null
}
