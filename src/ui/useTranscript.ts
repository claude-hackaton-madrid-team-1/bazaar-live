import { parseBatch } from '../../shared/transcript-parse.ts'
/**
 * Feeds the show the real conversations: the live transcript from the server, or the synthetic one with
 * `?mock=1`. Each item becomes a beat in the show's selected language (`getLang()`) and goes to the
 * director like any other beat; history goes to the captions only.
 */
import { useEffect } from 'react'
import type { TranscriptItem } from '../../shared/transcript.ts'
import type { ShowConfig } from '../config'
import { TranscriptFeed } from '../net/transcript'
import type { ShowEngine } from '../show/engine'
import { realBeat } from '../show/real'
import { getLang } from './lang'

export const TRANSCRIPT_URL = '/api/transcript'

export function useTranscript(engine: ShowEngine, config: ShowConfig): void {
  const { mock, speed, speakQuotes, mockDoors, replay: recorded } = config

  useEffect(() => {
    const play = (items: readonly TranscriptItem[], replay: boolean): void => {
      for (const item of items) {
        // The language is read when an item arrives, so the selector applies to the next line.
        const beat = realBeat(item, getLang(), { speakQuotes })
        const alreadyCovered = engine.getSnapshot().broadcastStatus === 'live' && (item.kind === 'duel_replay' || item.kind === 'settlement')
        if (beat) engine.ingestBeat(beat, replay || alreadyCovered)
      }
    }
    if (recorded) {
      let stopped = false
      let timer: ReturnType<typeof setInterval> | undefined
      const controller = new AbortController()
      void fetch(TRANSCRIPT_URL, { signal: controller.signal, cache: 'no-store' }).then((res) => res.json()).then((raw: unknown) => {
        const batch = parseBatch(raw)
        if (!batch || stopped) return
        // Replay only actual captured messages, oldest first. Never fabricate missing offers or outcomes.
        const items = [...batch.items].sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0) || a.seq - b.seq).slice(-12)
        let index = 0
        timer = setInterval(() => {
          const item = items[index++]
          if (!item || stopped) { clearInterval(timer); return }
          play([item], false)
        }, 4000)
      }).catch(() => undefined)
      return () => { stopped = true; controller.abort(); clearInterval(timer) }
    }
    // The mock with the doors shut is a quiet stage: no conversations until it opens.
    if (mock && mockDoors === 'closed') return
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
  }, [engine, mock, speed, speakQuotes, mockDoors, recorded])
}
