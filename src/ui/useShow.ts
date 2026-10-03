/** React glue: one speech queue, one engine, the data sources, and the state they produce. */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AGENTS } from '../model/events'
import { ENDPOINTS, POLL, type ShowConfig, type TtsChoice } from '../config'
import { MockPlayer } from '../mock/player'
import { EventFeed } from '../net/feed'
import { fetchHealth, fetchState } from '../net/http'
import { ShowEngine, type ShowState } from '../show/engine'
import { SpeechQueue } from '../tts/queue'
import { fetchRemoteProviders, type RemoteName } from '../tts/remote'
import { providerFactory, resolveChoice } from '../tts/select'
import type { ProviderName } from '../tts/types'
import { createWebSpeech, webSpeechAvailable } from '../tts/webspeech'

export interface SpeechControls {
  readonly muted: boolean
  readonly setMuted: (muted: boolean) => void
  readonly choice: TtsChoice
  readonly setChoice: (choice: TtsChoice) => void
  readonly available: readonly RemoteName[]
  readonly active: ProviderName | 'off'
  readonly lastError: string | null
}

export function useShow(config: ShowConfig): { state: ShowState; speech: SpeechControls } {
  const [lastError, setLastError] = useState<string | null>(null)
  const hasWebSpeech = useMemo(() => webSpeechAvailable(), [])
  const providerFor = useMemo(() => providerFactory(hasWebSpeech ? createWebSpeech() : null), [hasWebSpeech])
  const queue = useMemo(
    () =>
      new SpeechQueue({
        provider: providerFor('webspeech'),
        fallback: providerFor('webspeech'),
        onError: (error, _u, provider) => setLastError(`${provider}: ${error instanceof Error ? error.message : String(error)}`),
      }),
    [providerFor],
  )
  const engine = useMemo(() => new ShowEngine({ speech: queue }), [queue])
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot)

  const [muted, setMuted] = useState(true)
  const [choice, setChoice] = useState<TtsChoice>(config.tts)
  const [available, setAvailable] = useState<readonly RemoteName[]>([])
  const active = resolveChoice(choice, available, hasWebSpeech)

  useEffect(() => {
    let alive = true
    void fetchRemoteProviders().then((list) => alive && setAvailable(list))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => queue.setProvider(providerFor(active)), [queue, providerFor, active])
  useEffect(() => queue.setMuted(muted || active === 'off'), [queue, muted, active])
  useEffect(() => {
    engine.start()
    return () => engine.stop()
  }, [engine])
  useSources(engine, config)

  return { state, speech: { muted, setMuted, choice, setChoice, available, active, lastError } }
}

function useSources(engine: ShowEngine, config: ShowConfig): void {
  const { mock, speed, mockMode } = config
  useEffect(() => {
    if (mock) {
      const refresh = () => AGENTS.forEach((a) => engine.setHealth(a, player.health(a)))
      const player = new MockPlayer({ speed, mode: mockMode, onEvent: (e, replay) => engine.ingest(e, replay), onTick: refresh })
      AGENTS.forEach((a) => engine.setFeed(a, 'open'))
      refresh()
      engine.syncBoard(player.state('maker')?.openOffers ?? [])
      player.start()
      return () => player.stop()
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
          if (s?.openOffers) engine.syncBoard(s.openOffers)
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
  }, [engine, mock, speed, mockMode])
}
