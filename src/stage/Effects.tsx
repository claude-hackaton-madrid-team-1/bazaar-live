import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { errorWords } from '../show/words'
import { useLang, useStrings } from '../ui/lang'
import { appear, EASE_OUT } from './calm'
import { AlertIcon, CheckIcon, ShieldIcon } from './icons'
import { rng } from './rng'

export interface DealFx {
  readonly n: number
  readonly big: boolean
  /** What the buyer paid, when the execution said (a public field); null otherwise. */
  readonly price: number | null
}

/** A toast rises into place over the board and stays while the beat lasts. */
const TOAST = {
  initial: { opacity: 0, y: 10, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.22 } },
  transition: { duration: 0.45, ease: EASE_OUT },
} as const

/** Specks of light rising off the board, in the two voices' colours, each on its own path. */
function Sparks({ n, big }: { readonly n: number; readonly big: boolean }) {
  const sparks = useMemo(() => {
    const r = rng(n * 7919)
    return Array.from({ length: big ? 18 : 8 }, (_, i) => ({
      id: i,
      x: (r() - 0.5) * (big ? 40 : 24),
      rise: 7 + r() * (big ? 14 : 8),
      size: 0.45 + r() * 0.6,
      delay: r() * 0.6,
      voice: i % 2 === 0 ? 'seller' : 'buyer',
    }))
  }, [n, big])
  return (
    <>
      {sparks.map((s) => (
        <motion.i
          key={s.id}
          className="spark"
          data-voice={s.voice}
          style={{ left: `calc(50% + ${s.x}cqw)`, width: `${s.size}cqw`, height: `${s.size}cqw` }}
          initial={{ y: '0cqw', opacity: 0, scale: 0.5 }}
          animate={{ y: `${-s.rise}cqw`, opacity: [0, 1, 0], scale: [0.5, 1, 0.7] }}
          transition={{ duration: 2, delay: s.delay, ease: 'easeOut' }}
        />
      ))}
    </>
  )
}

/** The light of a deal over the board: rising specks, and a sweep across the tray on a big one. Not drawn with Reduce Motion. */
export function DealLight({ deal }: { readonly deal: DealFx | null }) {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <AnimatePresence>
      {deal && (
        <motion.div key={deal.n} className="fx-light" aria-hidden="true" exit={{ opacity: 0, transition: { duration: 0.3 } }}>
          {deal.big && (
            <span className="sweep">
              <motion.i initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 1.6, ease: [0.65, 0, 0.35, 1] }} />
            </span>
          )}
          <Sparks n={deal.n} big={deal.big} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A deal the game accepted: a glass toast with a check (both orbs bloom on a big one, see poses). */
export function DealToast({ deal }: { readonly deal: DealFx | null }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  return (
    <AnimatePresence>
      {deal && (
        <motion.div key={deal.n} className={`toast glass deal ${deal.big ? 'big' : 'sent'}`} {...appear(reduce, TOAST)}>
          <CheckIcon />
          <span className="toast-text">{deal.big ? t.dealDone : t.dealSent}</span>
          {deal.big && deal.price !== null && (
            <span className="deal-price" aria-hidden="true">
              −{deal.price} P
            </span>
          )}
          <span className="sr-only">{deal.big ? t.dealDoneSr : t.dealSentSr}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A guardrail said no: a glass pill with a shield, and one ring of light pulsing out of it. */
export function Guard({ n }: { readonly n: number | null }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  return (
    <AnimatePresence>
      {n !== null && (
        <motion.div key={n} className="toast glass guard" role="img" aria-label={t.guardrailSr} {...appear(reduce, TOAST)}>
          <span className="guard-icon">
            {!reduce && <motion.span className="pulse" initial={{ scale: 1, opacity: 0.85 }} animate={{ scale: 2.6, opacity: 0 }} transition={{ duration: 1.2, delay: 0.15, ease: 'easeOut' }} />}
            <ShieldIcon />
          </span>
          <small>{t.guardrail}</small>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The game refused a request: a pill with the reason, in the show's language (the orb that asked shakes, see poses). */
export function Fail({ fail }: { readonly fail: { readonly n: number; readonly code: string } | null }) {
  const reduce = useReducedMotion()
  const lang = useLang()
  return (
    <AnimatePresence>
      {fail && (
        <motion.div key={fail.n} className="toast glass fail" {...appear(reduce, TOAST)}>
          <AlertIcon />
          <span className="toast-text">{errorWords(fail.code, lang)}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
