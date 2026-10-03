import { AnimatePresence, motion } from 'motion/react'
import { Fragment } from 'react'
import type { AgentId } from '../model/events'
import type { Line } from '../show/beat'
import { verdictFamily } from '../show/jev'

const TAG = /\[([a-z][a-z ]{0,30})\]/gi

/** Words with their expressive tags shown as small chips: "(laughs) Venga!". */
export function Spoken({ text }: { readonly text: string }) {
  const parts = text.split(TAG)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="tag-chip">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** The line being spoken, over the head of whoever says it. */
export function SpeechBubble({ line, id }: { readonly line: Line | null; readonly id: string }) {
  return (
    <AnimatePresence mode="wait">
      {line && (
        <motion.div
          key={id}
          className={`bubble ${line.speaker}`}
          initial={{ opacity: 0, scale: 0.6, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -10, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 380, damping: 24 }}
          aria-hidden="true"
        >
          <Spoken text={line.text} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export interface JevFx {
  readonly n: number
  readonly verdict: string
  readonly agent: AgentId
}

/** Jev's thought bubble: the verdict, and a meter with the options it chose from. */
export function JevBubble({ jev }: { readonly jev: JevFx | null }) {
  return (
    <AnimatePresence>
      {jev && (
        <motion.div
          key={jev.n}
          className={`jev ${jev.agent}`}
          initial={{ opacity: 0, scale: 0.3, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          role="status"
          aria-label={`Jev thinks: ${jev.verdict}`}
        >
          <div className="jev-title">
            <span>🔮 Jev thinks…</span>
            <span className="jev-verdict">{jev.verdict === 'undecided' ? '¿?' : jev.verdict.replace(/_/g, ' ')}</span>
          </div>
          <Meter verdict={jev.verdict} />
          <span className="puff" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Meter({ verdict }: { readonly verdict: string }) {
  const family = verdictFamily(verdict)
  const chosen = family.indexOf(verdict.toLowerCase())
  return (
    <>
      <div className="meter" aria-hidden="true">
        {family.map((option, i) => (
          <div key={option} className="meter-seg">
            <motion.div
              className="meter-fill"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: i === chosen ? 1 : 0.12 }}
              transition={{ delay: 0.25 + i * 0.12, type: 'spring', stiffness: 140, damping: 16 }}
            />
          </div>
        ))}
      </div>
      <div className="meter-labels" aria-hidden="true">
        {family.map((option, i) => (
          <span key={option} className={i === chosen ? 'on' : undefined}>
            {option.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
    </>
  )
}
