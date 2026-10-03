import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useStrings } from './lang'
import './gate.css'

/** The hint with its key drawn as a key: the first standalone "M" becomes a <kbd>. */
function withKey(text: string, key: string): ReactNode {
  const at = text.search(new RegExp(`\\b${key}\\b`))
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <kbd>{key}</kbd>
      {text.slice(at + key.length)}
    </>
  )
}

/**
 * Browsers only let a page speak after a click. The gate asks once: with sound, or muted.
 */
export function StartGate({ onStart }: { readonly onStart: (withSound: boolean) => void }) {
  const t = useStrings()
  const reduce = useReducedMotion()
  const primary = useRef<HTMLButtonElement>(null)
  const secondary = useRef<HTMLButtonElement>(null)
  useEffect(() => primary.current?.focus(), [])

  // Tab cycles between the two choices: the page behind waits until one is made.
  const keepFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const first = primary.current
    const last = secondary.current
    if (e.key !== 'Tab' || !first || !last) return
    const active = document.activeElement
    const edge = e.shiftKey ? first : last
    if (active !== first && active !== last) {
      e.preventDefault()
      first.focus()
    } else if (active === edge) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    }
  }

  return (
    <motion.div
      className="gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-title"
      aria-describedby="gate-text"
      onKeyDown={keepFocus}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.28 }}
    >
      <motion.div
        className="gate-card glass"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: reduce ? 0.2 : 0.48, ease: [0.22, 1, 0.36, 1], delay: reduce ? 0 : 0.06 }}
      >
        <span className="gate-mark" aria-hidden="true">
          <i />
          <i />
        </span>
        <h2 id="gate-title">{t.gateTitle}</h2>
        <p id="gate-text">{t.gateText}</p>
        <div className="gate-actions">
          <button ref={primary} type="button" className="gate-primary" onClick={() => onStart(true)}>
            {t.gateSound}
          </button>
          <button ref={secondary} type="button" className="gate-secondary" onClick={() => onStart(false)}>
            {t.gateMuted}
          </button>
        </div>
        <p className="gate-hint">{withKey(t.gateKey, 'M')}</p>
      </motion.div>
    </motion.div>
  )
}
