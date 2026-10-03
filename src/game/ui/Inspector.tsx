import { useEffect } from 'react'
import { isOurs } from '../state.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'

/** The clicked event's full JSON, in a glass sheet at the side. Escape closes it. */
export function Inspector() {
  const store = useGame()
  const t = useGameStrings()
  const id = store.selected
  useEffect(() => {
    if (id == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.select(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, store])
  if (id == null) return null
  const e = store.state.byId.get(id)
  return (
    <aside className="gm-inspector glass" aria-label={t.inspector.label}>
      <div className="gm-insp-head">
        <strong className="gm-mono">{e ? `#${e.id} ${e.type}` : `#${id} (${t.inspector.evicted})`}</strong>
        <span className="gm-insp-actions">
          {e && (
            <button type="button" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(e, null, 2))}>
              {t.inspector.copy}
            </button>
          )}
          <button type="button" aria-label={t.inspector.close} onClick={() => store.select(null)}>
            ✕
          </button>
        </span>
      </div>
      {e && (
        <>
          <div className="gm-insp-meta">
            tick {e.tick ?? '—'} · {e.actor || '—'} · {e.scope ?? '—'} · {isOurs(store.state, e) ? t.badge.ours : t.badge.market}
          </div>
          <pre>{JSON.stringify(e, null, 2)}</pre>
        </>
      )}
    </aside>
  )
}
