import { useEffect, useRef } from 'react'

/**
 * Browsers only let a page speak after a click. The gate asks once: with sound, or muted.
 */
export function StartGate({ onStart }: { readonly onStart: (withSound: boolean) => void }) {
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => primary.current?.focus(), [])
  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-card">
        <h2 id="gate-title">🎪 Bazaar Live</h2>
        <p>Our two trading agents, the buyer and the seller, haggle at a stall in El Rastro. Every move they make, they say out loud.</p>
        <div className="gate-actions">
          <button ref={primary} type="button" className="primary" onClick={() => onStart(true)}>
            ▶ Start the show with sound
          </button>
          <button type="button" className="secondary" onClick={() => onStart(false)}>
            Watch muted
          </button>
        </div>
        <p>
          <small>
            Press <kbd>M</kbd> any time to mute or unmute.
          </small>
        </p>
      </div>
    </div>
  )
}
