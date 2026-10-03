/**
 * A voice as an orb of light (the voice-agent pattern: one orb per voice, idle / talking): the SELLER
 * warm, the BUYER cool, the dealers smaller. It breathes when idle; talking brightens it, sends rings
 * out and moves the bars. A pose is light, not limbs: greet lifts it, haggle sways it, reach leans it
 * toward the board, triumph blooms, grumble dims it and shakes once. Every move is CSS (voice.css), so
 * Reduce Motion holds each state still without a single running animation.
 */
import type { ReactNode } from 'react'

export type Role = 'seller' | 'buyer' | 'abuela' | 'chato'
export type Pose = 'idle' | 'greet' | 'haggle' | 'reach' | 'triumph' | 'grumble'

/** The bar visualizer: five capsules that rest as dots and move while the voice speaks. */
export function Bars({ talking }: { readonly talking: boolean }) {
  return (
    <span className="bars" data-talking={talking || undefined} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

interface VoiceProps {
  readonly role: Role
  readonly pose?: Pose
  readonly talking?: boolean
  readonly className?: string
  /** The orb's accessible name. */
  readonly label: string
  /** What hangs under the orb (a nameplate). */
  readonly children?: ReactNode
}

export function Voice({ role, pose = 'idle', talking = false, className, label, children }: VoiceProps) {
  return (
    <div className={`voice ${className ?? ''}`} data-voice={role} data-pose={pose} data-talking={talking || undefined}>
      <div className="voice-body">
        <span className="voice-halo" aria-hidden="true" />
        <span className="ripples" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <div className="orb" role="img" aria-label={label}>
          <span className="orb-core" />
          <span className="orb-glow" />
          <span className="orb-dim" />
          <span className="orb-gloss" />
        </div>
      </div>
      <span className="voice-pool" aria-hidden="true" />
      {children}
    </div>
  )
}
