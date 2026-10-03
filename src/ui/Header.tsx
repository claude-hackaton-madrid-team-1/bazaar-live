import { motion, useReducedMotion } from 'motion/react'
import { TTS_CHOICES, type TtsChoice } from '../config'
import { AGENTS, type AgentHealth, type AgentId } from '../model/events'
import type { FeedStatus } from '../net/feed'
import type { ShowState } from '../show/engine'
import { useLang, useStrings } from './langContext'
import { modeOf, type Mode } from './mode'
import type { SpeechControls } from './useShow'


function ModeBadge({ agent, health, feed, mock }: { agent: AgentId; health: AgentHealth | null; feed: FeedStatus; mock: boolean }) {
  const mode = modeOf(health, feed)
  const t = useStrings()
  const reduce = useReducedMotion()
  const connecting = feed === 'connecting' || feed === 'reconnecting'
  return (
    <span className={`badge ${mode}`} title={`${agent}: ${mode}${connecting ? ` (feed ${feed})` : ''}`}>
      {mode === 'live' && !reduce ? (
        <motion.span className="dot" animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
      ) : (
        <span className="dot" />
      )}
      {mock && `${t.mock} · `}
      {t.modes[mode satisfies Mode]}
      <span className="who">{t.who[agent]}</span>
      {connecting && <span aria-label="reconnecting">⟳</span>}
    </span>
  )
}

function Heartbeat({ state }: { state: ShowState }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  const beats = state.heartbeat.taker + state.heartbeat.maker
  const tick = state.ticks.taker ?? state.ticks.maker ?? state.health.taker?.tick ?? state.health.maker?.serverTick ?? null
  return (
    <span className="heart" aria-label={tick === null ? t.noTick : `${t.tick} ${tick}`}>
      <motion.svg
        key={beats}
        viewBox="0 0 24 24"
        aria-hidden="true"
        initial={reduce ? { opacity: 0.4 } : { scale: 1 }}
        animate={reduce ? { opacity: 1 } : { scale: [1, 1.45, 1, 1.2, 1] }}
        transition={{ duration: 0.8 }}
      >
        <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4 6.4 4c2.2 0 3.6 1.3 4.6 2.7C12 5.3 13.4 4 15.6 4c4.1 0 6 4.4 4.4 7.7C19.5 16.4 12 21 12 21z" />
      </motion.svg>
      {t.tick} {tick ?? '—'}
    </span>
  )
}

export function Header({ state, speech, mock }: { state: ShowState; speech: SpeechControls; mock: boolean }) {
  const t = useStrings()
  const unavailable = (c: TtsChoice) => (c === 'elevenlabs' || c === 'gemini') && !speech.available.includes(c)
  return (
    <header className="header">
      <div className="brand">
        <h1>
          Bazaar <span>Live</span>
        </h1>
        <small>{t.brandTag}</small>
      </div>
      <div className="badges" aria-label="Agent modes">
        {AGENTS.map((a) => (
          <ModeBadge key={a} agent={a} health={state.health[a]} feed={state.feeds[a]} mock={mock} />
        ))}
        <Heartbeat state={state} />
      </div>
      <div className="controls">
        <label className="sr-only" htmlFor="voice">
          {t.voiceLabel}
        </label>
        <select
          id="voice"
          className="control"
          value={speech.choice}
          onChange={(e) => speech.setChoice(e.target.value as TtsChoice)}
          title={speech.lastError ? `Last voice error: ${speech.lastError}` : `Speaking with: ${speech.active}`}
        >
          {TTS_CHOICES.map((c) => (
            <option key={c} value={c} disabled={unavailable(c)}>
              {t.voices[c]}
              {unavailable(c) ? ` (${t.noKey})` : ''}
            </option>
          ))}
        </select>
        <button type="button" className="control" aria-pressed={speech.muted} aria-keyshortcuts="M" onClick={() => speech.setMuted(!speech.muted)}>
          <span aria-hidden="true">{speech.muted ? '🔇' : '🔊'}</span>
          {speech.muted ? t.muted : t.soundOn}
          <kbd>M</kbd>
        </button>
      </div>
    </header>
  )
}

function madridTime(iso: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Doors closed or both feeds down: say so instead of an empty stage. */
export function Notice({ state, mock }: { state: ShowState; mock: boolean }) {
  const t = useStrings()
  const lang = useLang()
  if (mock) return <div className="notice">{t.mockNotice}</div>
  const closed = AGENTS.map((a) => state.health[a]).find((h) => h?.doors === 'closed')
  if (closed) {
    return (
      <div className="notice">
        {t.doorsClosed(closed.nextOpens ? madridTime(closed.nextOpens, lang) : null)} <a href="?mock=1">{t.tryMock}</a>.
      </div>
    )
  }
  const down = AGENTS.every((a) => state.feeds[a] === 'reconnecting')
  if (down) return <div className="notice">{t.cantReach} <a href="?mock=1">{t.tryMock}</a>.</div>
  return null
}
