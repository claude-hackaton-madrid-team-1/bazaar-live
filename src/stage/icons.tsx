/** Line icons drawn for the stage: 24-unit grid, rounded caps, colour from currentColor. */
import type { ReactNode } from 'react'

function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A check in a filled disc: a deal the game accepted. */
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-check">
      <circle cx="12" cy="12" r="10" fill="var(--ok)" />
      <path d="M7.5 12.4l3 3 6-6.6" fill="none" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A shield with a bar across it: a guardrail stopped the move. */
export function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3l7 2.8v5.4c0 4.3-2.9 7.9-7 9.3-4.1-1.4-7-5-7-9.3V5.8z" />
      <path d="M8.8 12h6.4" />
    </Icon>
  )
}

/** A circle with a mark: the game refused a request. */
export function AlertIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.6v5.2" />
      <path d="M12 16.3v.1" />
    </Icon>
  )
}
