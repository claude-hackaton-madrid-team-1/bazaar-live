/** React glue: one speech queue, one engine, the data sources, and the state they produce. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AGENTS } from '../model/events'
import { ENDPOINTS, POLL, type ShowConfig, type TtsChoice } from '../config'
import { EventFeed } from '../net/feed'
import { fetchHealth, fetchState } from '../net/http'
import { ShowEngine, type ShowState } from '../show/engine'
import { SpeechQueue } from '../tts/queue'
import { fetchRemoteProviders, unlockAudio, type RemoteName } from '../tts/remote'
import { providerFactory, resolveChoice } from '../tts/select'
import type { ProviderName } from '../tts/types'
import { createWebSpeech, hasVoiceFor, unlockWebSpeech, webSpeechAvailable } from '../tts/webspeech'
import type { Lang } from '../../shared/lang.ts'
import { getLang, subscribeLang, useLang } from './lang'
import { hasUserGesture } from './soundChoice'
import { useTranscript } from './useTranscript'
import { GameFeed } from '../game/feed'
import { EMPTY_OFFERS, OffersTracker, type OffersView } from './offers'
import type { GameEvent } from '../game/state'

export interface SpeechControls {
  readonly muted: boolean
  readonly setMuted: (muted: boolean) => void
  readonly choice: TtsChoice
  readonly setChoice: (choice: TtsChoice) => void
  readonly available: readonly RemoteName[]
  readonly active: ProviderName | 'off'
  readonly lastError: string | null
  /** The server has no ElevenLabs key: the show plays with captions only (no browser voice stands in). */
  readonly elevenMissing: boolean
  /** The language the browser has no voice for, when speaking with the browser's voices (the text is shown, not spoken). */
  readonly noVoiceFor: Lang | null
}

export function useShow(config: ShowConfig): { state: ShowState; speech: SpeechControls; offers: OffersView } {
  const [lastError, setLastError] = useState<string | null>(null)
  const hasWebSpeech = useMemo(() => webSpeechAvailable(), [])
  const providerFor = useMemo(() => providerFactory(hasWebSpeech ? createWebSpeech() : null), [hasWebSpeech])
  const queue = useMemo(
    () =>
      new SpeechQueue({
        provider: providerFor('off'),
        currentLang: getLang,
        onError: (error, _u, provider) => setLastError(`${provider}: ${error instanceof Error ? error.message : String(error)}`),
      }),
    [providerFor],
  )
  const engine = useMemo(() => new ShowEngine({ speech: queue, lang: getLang(), idleAfterMs: config.replay ? 600_000 : config.idleSeconds === null ? undefined : config.idleSeconds * 1000 }), [queue, config.idleSeconds, config.replay])
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  const [muted, setMutedState] = useState(true)
  // Sound asked for before this page had a tap (a reload that remembered "with sound"): the browser would
  // refuse every line, so the players stay quiet until the first tap or key anywhere.
  const [waitingForTap, setWaitingForTap] = useState(false)
  // A browser lets a page play audio only after a tap: every unmute is one, so prime the players there.
  const setMuted = useCallback((next: boolean): void => {
    if (!next) {
      if (hasUserGesture(navigator) === false) setWaitingForTap(true)
      else {
        unlockAudio()
        unlockWebSpeech()
      }
    }
    setMutedState(next)
  }, [])
  useEffect(() => {
    if (!waitingForTap) return
    // Capture: this runs before the M key and the header's button. A touch grants the tap on pointerup,
    // and Escape never does: until the browser says so, keep waiting for the next one.
    const events = ['pointerdown', 'pointerup', 'keydown'] as const
    const onTap = (): void => {
      if (hasUserGesture(navigator) === false) return
      unlockAudio()
      unlockWebSpeech()
      setWaitingForTap(false)
    }
    events.forEach((e) => window.addEventListener(e, onTap, true))
    return () => events.forEach((e) => window.removeEventListener(e, onTap, true))
  }, [waitingForTap])
  const [choice, setChoice] = useState<TtsChoice>(config.tts)
  // null until the server has answered which voices it has (so the header does not cry wolf at start).
  const [available, setAvailable] = useState<readonly RemoteName[] | null>(null)
  const active = resolveChoice(choice, available ?? [], hasWebSpeech)
  const elevenMissing = available !== null && choice !== 'off' && active === 'off' && (choice === 'auto' || choice === 'elevenlabs')

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // An empty answer may be a failed request (a deploy in progress), not a missing key: ask again a few times.
    const ask = (attempt: number): void => {
      void fetchRemoteProviders().then((list) => {
        if (!alive) return
        setAvailable(list)
        if (list.length === 0 && attempt < 3) timer = setTimeout(() => ask(attempt + 1), 4000 * (attempt + 1))
      })
    }
    ask(0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  useEffect(() => queue.setProvider(providerFor(active)), [queue, providerFor, active])
  useEffect(() => queue.setMuted(muted || waitingForTap || active === 'off'), [queue, muted, waitingForTap, active])
  // The selector changes the language: the engine re-picks banks and drops what is queued in the old one.
  useEffect(() => {
    engine.setLang(getLang())
    return subscribeLang((l) => engine.setLang(l))
  }, [engine])
  const noVoiceFor = useMissingVoice(hasWebSpeech && active === 'webspeech')
  useEffect(() => {
    engine.start()
    return () => engine.stop()
  }, [engine])
  useSources(engine, config)
  useTranscript(engine, config)
  const [offers, setOffers] = useState<OffersView>(EMPTY_OFFERS)
  const tracker = useMemo(() => new OffersTracker(), [])
  const receiveOffers = useCallback((events: readonly GameEvent[], replay: boolean) => setOffers(tracker.receive(events, replay)), [tracker])
  useBroadcast(engine, config, receiveOffers)

  return { state, offers, speech: { muted, setMuted, choice, setChoice, available: available ?? [], active, lastError, noVoiceFor, elevenMissing } }
}

/** Rich live activity stays on the existing token-protected game stream. */
function useBroadcast(engine: ShowEngine, config: ShowConfig, receiveOffers: (events: readonly GameEvent[], replay: boolean) => void): void {
  useEffect(() => {
    if (config.replay) return
    const receive = (events: readonly GameEvent[], replay: boolean) => { engine.ingestGame(events, replay); receiveOffers(events, replay) }
    if (config.mock) {
      engine.setBroadcastStatus('demo')
      let stopped = false
      let timer: ReturnType<typeof setInterval> | undefined
      void import('../game/mock').then(({ MockGame }) => {
        if (stopped || config.mockDoors === 'closed') return
        const game = new MockGame(7)
        receive(game.step(), true)
        timer = setInterval(() => receive(game.step(), false), 4000 / config.speed)
      })
      return () => { stopped = true; clearInterval(timer) }
    }
    const token = new URLSearchParams(window.location.search).get('token')
    if (!token) { engine.setBroadcastStatus('locked'); return }
    const feed = new GameFeed({ url: '/api/game', token, requireToken: true, onEvents: receive, onStatus: (status) => engine.setBroadcastStatus(status) })
    feed.start()
    return () => feed.stop()
  }, [engine, config.mock, config.replay, config.speed, config.mockDoors, receiveOffers])
}

/** The language the browser has no voice for (so the show only shows its text), or null. Voices load late: it listens. */
function useMissingVoice(watching: boolean): Lang | null {
  const lang = useLang()
  const [missing, setMissing] = useState<Lang | null>(null)
  useEffect(() => {
    if (!watching) return
    const check = () => setMissing(hasVoiceFor(lang) ? null : lang)
    check()
    window.speechSynthesis.addEventListener('voiceschanged', check)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', check)
  }, [watching, lang])
  return watching ? missing : null
}

function useSources(engine: ShowEngine, config: ShowConfig): void {
  const { mock, speed, mockMode, mockDoors, replay } = config
  useEffect(() => {
    if (replay) return
    if (mock) {
      // The fixtures load only with ?mock=1: a normal visit never downloads them.
      let player: { stop(): void } | null = null
      let cancelled = false
      void import('../mock/player').then(({ MockPlayer }) => {
        if (cancelled) return
        const mockPlayer = new MockPlayer({ speed, mode: mockMode, doors: mockDoors, onEvent: (e, replay) => engine.ingest(e, replay), onTick: () => refresh() })
        const refresh = () => AGENTS.forEach((a) => engine.setHealth(a, mockPlayer.health(a)))
        AGENTS.forEach((a) => engine.setFeed(a, 'open'))
        refresh()
        const state = mockPlayer.state('maker')
        engine.syncBoard(state?.openOffers ?? [], state?.tick ?? null)
        mockPlayer.start()
        player = mockPlayer
      })
      return () => {
        cancelled = true
        player?.stop()
      }
    }

    const feeds = AGENTS.map(
      (agent) =>
        new EventFeed({
          url: ENDPOINTS[agent].ws,
          agent,
          onEvent: (e, replay) => engine.ingest(e, replay),
          onStatus: (status) => engine.setFeed(agent, status),
        }),
    )
    feeds.forEach((f) => f.start())
    const pollHealth = () =>
      AGENTS.forEach((agent) => {
        fetchHealth(ENDPOINTS[agent].http).then(
          (h) => engine.setHealth(agent, h),
          () => engine.setHealth(agent, null),
        )
      })
    const pollBoard = () => {
      fetchState(ENDPOINTS.maker.http).then(
        (s) => {
          if (s?.openOffers) engine.syncBoard(s.openOffers, s.tick)
        },
        () => undefined,
      )
    }
    const online = () => feeds.forEach((f) => f.reconnectNow())
    pollHealth()
    pollBoard()
    const healthTimer = setInterval(pollHealth, POLL.healthMs)
    const boardTimer = setInterval(pollBoard, POLL.stateMs)
    window.addEventListener('online', online)
    return () => {
      feeds.forEach((f) => f.stop())
      clearInterval(healthTimer)
      clearInterval(boardTimer)
      window.removeEventListener('online', online)
    }
  }, [engine, mock, speed, mockMode, mockDoors, replay])
}
