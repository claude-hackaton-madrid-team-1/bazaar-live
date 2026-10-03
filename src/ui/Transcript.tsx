import { useEffect, useRef } from 'react'
import type { TranscriptEntry } from '../show/engine'
import { Spoken } from '../stage/Bubbles'
import { useStrings } from './lang'

function speakerName(t: ReturnType<typeof useStrings>, speaker: TranscriptEntry['speaker']): string {
  switch (speaker) {
    case 'buyer':
      return t.buyer.charAt(0) + t.buyer.slice(1).toLowerCase()
    case 'seller':
      return t.seller.charAt(0) + t.seller.slice(1).toLowerCase()
    case 'abuela':
      return t.dealers.abuela
    case 'chato':
      return t.dealers.chato
    case 'narrator':
      return t.narrator
  }
}

/** The captions: every line, in order, with replayed and skipped lines dimmed. */
export function Transcript({ entries }: { readonly entries: readonly TranscriptEntry[] }) {
  const t = useStrings()
  const list = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)

  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const onScroll = () => {
    const el = list.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <aside className="transcript" aria-labelledby="transcript-title">
      <h2 id="transcript-title">
        {t.transcript} <small>{t.captions}</small>
      </h2>
      <ol ref={list} role="log" aria-live="polite" aria-relevant="additions" onScroll={onScroll} tabIndex={0}>
        {entries.length === 0 && <li className="empty">{t.waiting}</li>}
        {entries.map((e) => (
          <li key={e.id} className={e.kind}>
            <span className="tick">{e.tick ?? ''}</span>
            <span>
              <span className={`who ${e.speaker}`}>{speakerName(t, e.speaker)}</span>
              {e.kind === 'skipped' && <span className="sr-only"> ({t.skipped})</span>}
              <br />
              <Spoken text={e.text} />
            </span>
          </li>
        ))}
      </ol>
    </aside>
  )
}
