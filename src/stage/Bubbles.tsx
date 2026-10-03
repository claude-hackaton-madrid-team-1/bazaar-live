import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Fragment } from 'react'
import type { AgentId } from '../model/events'
import type { Line } from '../show/beat'
import { verdictFamily, verdictHue } from '../show/jev'
import { useDealerNames } from '../net/dealers'
import { useStrings } from '../ui/lang'
import { speakerName } from '../ui/speakers'
import { appear, EASE_OUT } from './calm'

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

/** The line being spoken, as a Liquid Glass caption on the side of whoever says it, marked with their light. */
export function SpeechBubble({ line, id }: { readonly line: Line | null; readonly id: string }) {
  const t = useStrings()
  const names = useDealerNames()
  const reduce = useReducedMotion()
  return (
    <AnimatePresence mode="wait">
      {line && (
        <motion.div
          key={id}
          className="caption glass"
          data-voice={line.speaker}
          {...appear(reduce, {
            initial: { opacity: 0, y: 10, scale: 0.985 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
            transition: { duration: 0.36, ease: EASE_OUT },
          })}
          aria-hidden="true"
        >
          <span className="caption-who">
            <i className="caption-dot" />
            {speakerName(t, line.speaker, line.dealer, names)}
          </span>
          <span className="caption-text">
            <Spoken text={line.text} />
          </span>
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

/** Jev's verdict on a small glass card: a violet orb tinted by the verdict, the word, and a meter of the options. */
export function JevOrb({ jev }: { readonly jev: JevFx | null }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  return (
    <AnimatePresence>
      {jev && (
        <motion.div
          key={jev.n}
          className={`jev glass ${jev.agent}`}
          style={{ ['--hue' as string]: verdictHue(jev.verdict) }}
          {...appear(reduce, {
            initial: { opacity: 0, y: -8, scale: 0.97 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, scale: 0.98, transition: { duration: 0.2 } },
            transition: { duration: 0.42, ease: EASE_OUT },
          })}
          role="status"
          aria-label={`${t.jevSr}: ${jev.verdict}`}
        >
          <div className="jev-head">
            <span className="jev-orb" aria-hidden="true" />
            <span className="jev-words">
              <span className="jev-title">{t.jevThinks}</span>
              <span className="jev-verdict">{jev.verdict === 'undecided' ? t.undecided : jev.verdict.replace(/_/g, ' ')}</span>
            </span>
          </div>
          <Meter verdict={jev.verdict} reduce={reduce} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The options Jev weighed, as a segmented capsule: the one it picked fills with the verdict's light. */
function Meter({ verdict, reduce }: { readonly verdict: string; readonly reduce: boolean | null }) {
  const family = verdictFamily(verdict)
  const chosen = family.indexOf(verdict.toLowerCase())
  return (
    <div className="meter" aria-hidden="true" style={{ ['--n' as string]: family.length }}>
      {family.map((option, i) => (
        <span key={option} className="meter-seg">
          <motion.span
            className="meter-fill"
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: i === chosen ? 1 : 0 }}
            transition={reduce ? { duration: 0 } : { delay: 0.2 + i * 0.1, duration: 0.5, ease: EASE_OUT }}
          />
        </span>
      ))}
      {family.map((option, i) => (
        <span key={option} className={i === chosen ? 'meter-label on' : 'meter-label'}>
          {option.replace(/_/g, ' ')}
        </span>
      ))}
    </div>
  )
}
