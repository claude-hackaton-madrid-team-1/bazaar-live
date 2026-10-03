import { MotionConfig } from 'motion/react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { readConfig } from './config'
import { Stage } from './stage/Stage'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Header, Notice } from './ui/Header'
import { useLang, useStrings } from './ui/lang'
import { useRoute } from './ui/route'
import { StartGate } from './ui/StartGate'
import { Transcript } from './ui/Transcript'
import { unlockAudio } from './tts/remote'
import { unlockWebSpeech } from './tts/webspeech'
import { useShow } from './ui/useShow'

// The game screens are their own chunk: the show never loads them.
const GameApp = lazy(() => import('./game/ui/GameApp'))

/** The start gate's answer (with sound or not), kept while the visitor moves between screens. */
let gateChoice: boolean | null = null

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
  const [started, setStarted] = useState(gateChoice !== null)
  const { muted, setMuted } = speech

  // back from another screen: the gate was answered already, keep that answer
  useEffect(() => {
    if (gateChoice !== null) setMuted(!gateChoice)
  }, [setMuted])

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
        <Header state={state} speech={speech} mock={config.mock} />
        <Notice state={state} mock={config.mock} />
        <main className="main">
          <ErrorBoundary fallback={<div className="fallback material">{t.fallback}</div>}>
            <Stage state={state} />
          </ErrorBoundary>
          <Transcript entries={state.transcript} />
        </main>
      </div>
      {!started && (
        <StartGate
          onStart={(withSound) => {
            if (withSound) {
              unlockWebSpeech()
              unlockAudio()
            }
            gateChoice = withSound
            setStarted(true)
            setMuted(!withSound)
          }}
        />
      )}
    </MotionConfig>
  )
}
