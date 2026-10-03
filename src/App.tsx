import { MotionConfig } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { readConfig } from './config'
import { Stage } from './stage/Stage'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Header, Notice } from './ui/Header'
import { useLang, useStrings } from './ui/lang'
import { StartGate } from './ui/StartGate'
import { Transcript } from './ui/Transcript'
import { unlockAudio } from './tts/remote'
import { unlockWebSpeech } from './tts/webspeech'
import { useShow } from './ui/useShow'

export default function App() {
  const config = useMemo(() => readConfig(window.location.search), [])
  const lang = useLang()
  const t = useStrings()
  const { state, speech } = useShow(config)
  const [started, setStarted] = useState(false)
  const { muted, setMuted } = speech

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

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
          <ErrorBoundary fallback={<div className="fallback">{t.fallback}</div>}>
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
            setStarted(true)
            setMuted(!withSound)
          }}
        />
      )}
    </MotionConfig>
  )
}
