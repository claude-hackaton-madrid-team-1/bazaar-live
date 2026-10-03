import { useEffect, useRef } from 'react'
import type { TranscriptEntry } from '../show/engine'
import { Spoken } from '../stage/Bubbles'
import { useStrings } from './lang'
import './transcript.css'

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

/** The lines that open a new tick: the tick shows once per turn, not on every line of it. */
function turnStarts(entries: readonly TranscriptEntry[]): ReadonlySet<string> {
  const starts = new Set<string>()
  let tick: number | null = null
  for (const e of entries) {
    if (e.tick === null) continue
    if (e.tick !== tick) starts.add(e.id)
    tick = e.tick
  }
  return starts
}

/** The captions: every line, in order, with replayed and skipped lines dimmed. */
export function Transcript({ entries }: { readonly entries: readonly TranscriptEntry[] }) {
  const t = useStrings()
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const last = entries.at(-1)
  const turns = turnStarts(entries)

  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const onScroll = () => {
    const el = list.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  return (
    <aside className="transcript material" aria-labelledby="transcript-title">
      <h2 id="transcript-title">
        {t.transcript}{' '}
        <small className="eyebrow">
          {/* takes the colour of whoever spoke last */}
          <span className={`signal ${last?.speaker ?? 'idle'}`} aria-hidden="true" />
          {t.captions}
        </small>
      </h2>
      {/* the scroll container is the live log; the list inside keeps its list semantics */}
      <div ref={list} className="scroll" role="log" aria-live="polite" aria-relevant="additions" onScroll={onScroll} tabIndex={0}>
        <ol>
          {entries.length === 0 && <li className="empty">{t.waiting}</li>}
          {entries.map((e) => (
            <li key={e.id} className={`line ${e.kind}${turns.has(e.id) ? ' turn' : ''}`}>
              <span className={`who ${e.speaker}`}>{speakerName(t, e.speaker)}</span>
              {e.kind === 'skipped' && <span className="sr-only"> ({t.skipped})</span>}
              <p className="said">
                <Spoken text={e.text} />
              </p>
              {turns.has(e.id) && (
                <span className="tick">
                  <span className="sr-only">{t.tick} </span>
                  {e.tick}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  )
}
