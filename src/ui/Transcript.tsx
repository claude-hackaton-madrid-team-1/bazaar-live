import { useEffect, useRef } from 'react'
import type { TranscriptEntry } from '../show/engine'
import { Spoken } from '../stage/Bubbles'

const NAMES: Readonly<Record<TranscriptEntry['speaker'], string>> = {
  buyer: 'Buyer',
  seller: 'Seller',
  abuela: 'Abuela',
  chato: 'El Chato',
  narrator: 'Narrator',
}

/** The captions: every line, in order, with replayed and skipped lines dimmed. */
export function Transcript({ entries }: { readonly entries: readonly TranscriptEntry[] }) {
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
        Transcript <small>captions</small>
      </h2>
      <ol ref={list} role="log" aria-live="polite" aria-relevant="additions" onScroll={onScroll} tabIndex={0}>
        {entries.length === 0 && <li className="empty">Waiting for the first move…</li>}
        {entries.map((e) => (
          <li key={e.id} className={e.kind}>
            <span className="tick">{e.tick ?? ''}</span>
            <span>
              <span className={`who ${e.speaker}`}>{NAMES[e.speaker]}</span>
              {e.kind === 'skipped' && <span className="sr-only"> (skipped)</span>}
              <br />
              <Spoken text={e.text} />
            </span>
          </li>
        ))}
      </ol>
    </aside>
  )
}
