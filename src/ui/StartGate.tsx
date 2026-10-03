import { useEffect, useRef } from 'react'
import { useStrings } from './langContext'

/**
 * Browsers only let a page speak after a click. The gate asks once: with sound, or muted.
 */
export function StartGate({ onStart }: { readonly onStart: (withSound: boolean) => void }) {
  const t = useStrings()
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => primary.current?.focus(), [])
  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-card">
        <h2 id="gate-title">{t.gateTitle}</h2>
        <p>{t.gateText}</p>
        <div className="gate-actions">
          <button ref={primary} type="button" className="primary" onClick={() => onStart(true)}>
            {t.gateSound}
          </button>
          <button type="button" className="secondary" onClick={() => onStart(false)}>
            {t.gateMuted}
          </button>
        </div>
        <p>
          <small>{t.gateKey}</small>
        </p>
      </div>
    </div>
  )
}
