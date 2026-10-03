/**
 * Feeds the show the real conversations: the live transcript from the server, or the synthetic one with
 * `?mock=1`. Each item becomes a beat in the show's selected language (`config.lang`) and goes to the
 * director like any other beat; history goes to the captions only.
 */
import { useEffect, useRef } from 'react'
import type { Lang } from '../../shared/lang.ts'
import type { TranscriptItem } from '../../shared/transcript.ts'
import type { ShowConfig } from '../config'
import { TranscriptFeed } from '../net/transcript'
import type { ShowEngine } from '../show/engine'
import { realBeat } from '../show/real'

export const TRANSCRIPT_URL = '/api/transcript'

export function useTranscript(engine: ShowEngine, config: ShowConfig): void {
  const { mock, speed, lang, speakQuotes } = config
  // The language is read when an item arrives, so a change of language applies to the next line.
  const langRef = useRef<Lang>(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])

  useEffect(() => {
    const play = (items: readonly TranscriptItem[], replay: boolean): void => {
      for (const item of items) {
        const beat = realBeat(item, langRef.current, { speakQuotes })
        if (beat) engine.ingestBeat(beat, replay)
      }
    }
    if (mock) {
      let player: { stop(): void } | null = null
      let cancelled = false
      void import('../mock/transcript').then(({ MockTranscriptPlayer }) => {
        if (cancelled) return
        const mockPlayer = new MockTranscriptPlayer({ speed, onItems: play })
        mockPlayer.start()
        player = mockPlayer
      })
      return () => {
        cancelled = true
        player?.stop()
      }
    }
    const feed = new TranscriptFeed({ url: TRANSCRIPT_URL, onItems: play })
    const online = () => feed.reconnectNow()
    feed.start()
    window.addEventListener('online', online)
    return () => {
      feed.stop()
      window.removeEventListener('online', online)
    }
  }, [engine, mock, speed, speakQuotes])
}
