import { MotionConfig } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { readConfig } from './config'
import { Stage } from './stage/Stage'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Header, Notice } from './ui/Header'
import { InjectionsPanel } from './ui/InjectionsPanel'
import { useLang, useStrings } from './ui/lang'
import { useRoute } from './ui/route'
import { soundMemory } from './ui/soundChoice'
import { StartGate } from './ui/StartGate'
import { Transcript } from './ui/Transcript'
import { useShow } from './ui/useShow'

/** The show keeps the newest few injection attempts under the stage; every row is on /injections. */
const SHOW_ROWS = 5

// The game screens are their own chunk: the show never loads them.
const GameApp = lazy(() => import('./game/ui/GameApp'))

export default function App() {
  const route = useRoute()
  const lang = useLang()

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  if (route === 'show') return <ShowApp />
  return (
    <Suspense fallback={null}>
      <GameApp route={route} />
    </Suspense>
  )
}

/** The show: the buyer and the seller at the stall, out loud. */
function ShowApp() {
  const config = useMemo(() => readConfig(window.location.search), [])
  const t = useStrings()
  const { state, speech } = useShow(config)
  // answered already in this tab (back from another screen, or a reload): no gate, the same sound
  const [saved] = useState(() => soundMemory().recall())
  const [started, setStarted] = useState(saved !== null)
  const { muted, setMuted: setSpeechMuted } = speech

  // every answer after the gate too (M, the header's button) is remembered, so a reload keeps the latest
  const setMuted = useCallback(
    (next: boolean): void => {
      setSpeechMuted(next)
      soundMemory().remember(!next)
    },
    [setSpeechMuted],
  )

  // the remembered answer again; with sound after a reload, the players wait for the first tap (useShow)
  useEffect(() => {
    if (saved !== null) setMuted(!saved)
  }, [saved, setMuted])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || target?.closest('input, select, textarea')) return
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        setMuted(!muted)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [muted, setMuted])

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Header state={state} speech={{ ...speech, setMuted }} mock={config.mock} />
        <Notice state={state} mock={config.mock} />
        <main className="main">
          <ErrorBoundary fallback={<div className="fallback material">{t.fallback}</div>}>
            <Stage state={state} />
          </ErrorBoundary>
          <Transcript entries={state.transcript} />
        </main>
        {/* their words as plain text only; this panel never reaches the director or a voice */}
        <InjectionsPanel mock={config.mock} className="inj-show" max={SHOW_ROWS} />
      </div>
      {!started && (
        <StartGate
          onStart={(withSound) => {
            // inside the click: unmuting primes the players there
            setStarted(true)
            setMuted(!withSound)
          }}
        />
      )}
    </MotionConfig>
  )
}
