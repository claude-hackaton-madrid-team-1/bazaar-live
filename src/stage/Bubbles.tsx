import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment } from 'react'
import type { AgentId } from '../model/events'
import type { Line } from '../show/beat'
import { verdictFamily, verdictHue } from '../show/jev'
import { useStrings } from '../ui/lang'

const TAG = /\[([a-z][a-z ]{0,30})\]/gi

/** Item-quality words get their quality colour (grey, green, blue, purple, orange), in both languages. */
const QUALITY = /(?<![\p{L}])(poco común|común|rara|épica|legendaria|uncommon|common|rare|epic|legendary)(?![\p{L}])/giu
const QUALITY_CLASS: Readonly<Record<string, string>> = {
  común: 'common', common: 'common', 'poco común': 'uncommon', uncommon: 'uncommon', rara: 'rare', rare: 'rare',
  épica: 'epic', epic: 'epic', legendaria: 'legendary', legendary: 'legendary',
}

/** A run of words with its quality words coloured. */
function Words({ text }: { readonly text: string }) {
  const parts = text.split(QUALITY)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={`quality ${QUALITY_CLASS[part.toLowerCase()] ?? ''}`}>
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/** Words with their expressive tags shown as small chips: "(laughs) Venga!". The voice never reads them. */
export function Spoken({ text }: { readonly text: string }) {
  const t = useStrings()
  const parts = text.split(TAG)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="tag-chip">
            {t.tags[part.toLowerCase()] ?? part}
          </span>
        ) : (
          <Words key={i} text={part} />
        ),
      )}
    </>
  )
}

/** The line being spoken, on a parchment scroll over the head of whoever says it. */
export function SpeechBubble({ line, id }: { readonly line: Line | null; readonly id: string }) {
  return (
    <AnimatePresence mode="wait">
      {line && (
        <motion.div
          key={id}
          className={`bubble ${line.speaker}`}
          initial={{ opacity: 0, scale: 0.7, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -8, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
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

/** Jev's verdict as a glowing orb: its colour is the verdict, a ring of sparks circles it, a meter lists the options. */
export function JevOrb({ jev }: { readonly jev: JevFx | null }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  return (
    <AnimatePresence>
      {jev && (
        <motion.div
          key={jev.n}
          className={`jev ${jev.agent}`}
          style={{ ['--hue' as string]: verdictHue(jev.verdict) }}
          initial={{ opacity: 0, scale: 0.3, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          role="status"
          aria-label={`${t.jevSr}: ${jev.verdict}`}
        >
          <div className="orb-wrap">
            <motion.div className="orb-halo" animate={reduce ? undefined : { scale: [1, 1.25, 1], opacity: [0.55, 0.9, 0.55] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} />
            <motion.div className="orb-sparks" animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}>
              <i />
              <i />
              <i />
            </motion.div>
            <motion.div className="orb" animate={reduce ? undefined : { y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
              <motion.span className="orb-swirl" animate={reduce ? undefined : { rotate: -360 }} transition={{ duration: 9, repeat: Infinity, ease: 'linear' }} />
            </motion.div>
          </div>
          <div className="jev-plaque">
            <span className="jev-title">{t.jevThinks}</span>
            <span className="jev-verdict">{jev.verdict === 'undecided' ? t.undecided : jev.verdict.replace(/_/g, ' ')}</span>
          </div>
          <Meter verdict={jev.verdict} />
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
