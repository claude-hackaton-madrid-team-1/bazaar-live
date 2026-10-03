import { motion, useReducedMotion } from 'motion/react'
import { TTS_CHOICES, type TtsChoice } from '../config'
import { AGENTS, type AgentHealth, type AgentId } from '../model/events'
import type { FeedStatus } from '../net/feed'
import type { ShowState } from '../show/engine'
import { modeOf, type Mode } from './mode'
import type { SpeechControls } from './useShow'

const WHO: Readonly<Record<AgentId, string>> = { taker: 'buyer', maker: 'seller' }

const MODE_LABEL: Readonly<Record<Mode, string>> = { live: 'LIVE', dry: 'DRY RUN', offline: 'OFFLINE' }

function ModeBadge({ agent, health, feed, mock }: { agent: AgentId; health: AgentHealth | null; feed: FeedStatus; mock: boolean }) {
  const mode = modeOf(health, feed)
  const reduce = useReducedMotion()
  const connecting = feed === 'connecting' || feed === 'reconnecting'
  return (
    <span className={`badge ${mode}`} title={`${agent}: ${mode}${connecting ? ` (feed ${feed})` : ''}`}>
      {mode === 'live' && !reduce ? (
        <motion.span className="dot" animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
      ) : (
        <span className="dot" />
      )}
      {mock && 'MOCK · '}
      {MODE_LABEL[mode]}
      <span className="who">{WHO[agent]}</span>
      {connecting && <span aria-label="reconnecting">⟳</span>}
    </span>
  )
}

function Heartbeat({ state }: { state: ShowState }) {
  const reduce = useReducedMotion()
  const beats = state.heartbeat.taker + state.heartbeat.maker
  const tick = state.ticks.taker ?? state.ticks.maker ?? state.health.taker?.tick ?? state.health.maker?.serverTick ?? null
  return (
    <span className="heart" aria-label={tick === null ? 'No tick yet' : `Tick ${tick}`}>
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
      tick {tick ?? '—'}
    </span>
  )
}

const VOICE_LABEL: Readonly<Record<TtsChoice, string>> = {
  auto: 'Voice: auto',
  webspeech: 'Browser voice',
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  off: 'No voice',
}

export function Header({ state, speech, mock }: { state: ShowState; speech: SpeechControls; mock: boolean }) {
  const unavailable = (c: TtsChoice) => (c === 'elevenlabs' || c === 'gemini') && !speech.available.includes(c)
  return (
    <header className="header">
      <div className="brand">
        <h1>
          Bazaar <span>Live</span>
        </h1>
        <small>the buyer and the seller, talking out loud</small>
      </div>
      <div className="badges" aria-label="Agent modes">
        {AGENTS.map((a) => (
          <ModeBadge key={a} agent={a} health={state.health[a]} feed={state.feeds[a]} mock={mock} />
        ))}
        <Heartbeat state={state} />
      </div>
      <div className="controls">
        <label className="sr-only" htmlFor="voice">
          Voice provider
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
              {VOICE_LABEL[c]}
              {unavailable(c) ? ' (no key)' : ''}
            </option>
          ))}
        </select>
        <button type="button" className="control" aria-pressed={speech.muted} aria-keyshortcuts="M" onClick={() => speech.setMuted(!speech.muted)}>
          <span aria-hidden="true">{speech.muted ? '🔇' : '🔊'}</span>
          {speech.muted ? 'Muted' : 'Sound on'}
          <kbd>M</kbd>
        </button>
      </div>
    </header>
  )
}

function madridTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Doors closed or both feeds down: say so instead of an empty stage. */
export function Notice({ state, mock }: { state: ShowState; mock: boolean }) {
  if (mock) return <div className="notice">Mock mode: a recorded afternoon at the stall, on a loop. Drop <code>?mock=1</code> for the live agents.</div>
  const closed = AGENTS.map((a) => state.health[a]).find((h) => h?.doors === 'closed')
  if (closed) {
    return (
      <div className="notice">
        Doors closed{closed.nextOpens ? ` · the game reopens ${madridTime(closed.nextOpens)} (Madrid)` : ''}. Want a preview? Try <a href="?mock=1">?mock=1</a>.
      </div>
    )
  }
  const down = AGENTS.every((a) => state.feeds[a] === 'reconnecting')
  if (down) return <div className="notice">Can't reach the agents right now; retrying with backoff. Meanwhile: <a href="?mock=1">?mock=1</a>.</div>
  return null
}
