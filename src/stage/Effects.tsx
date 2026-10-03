import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { errorWords } from '../show/words'
import { useLang, useStrings } from '../ui/lang'
import { rng } from './rng'

/** A gold coin in original SVG: a disc, a rim, a small sun. */
function Coin({ size }: { readonly size: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="#f2b544" stroke="#8a5f1a" strokeWidth="2" />
      <circle cx="20" cy="20" r="13" fill="none" stroke="#b8862b" strokeWidth="1.6" />
      <circle cx="20" cy="20" r="5" fill="#fff0a8" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d="M19 12h2l-1 -4z" fill="#fff0a8" transform={`rotate(${i * 45} 20 20)`} />
      ))}
      <path d="M8 14q4 -8 14 -9" stroke="#fff6c8" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.75" />
    </svg>
  )
}

/** Coins thrown up from the counter and falling back, each on its own arc. */
function CoinBurst({ n, big }: { readonly n: number; readonly big: boolean }) {
  const coins = useMemo(() => {
    const r = rng(n * 7919)
    return Array.from({ length: big ? 30 : 10 }, (_, i) => ({
      id: i,
      x: (r() - 0.5) * (big ? 78 : 40),
      up: 14 + r() * (big ? 30 : 16),
      fall: 30 + r() * 14,
      spin: (r() - 0.5) * 1080,
      size: 1.8 + r() * 1.5,
      delay: r() * 0.18,
    }))
  }, [n, big])
  return (
    <>
      {coins.map((c) => (
        <motion.span
          key={c.id}
          className="coin"
          style={{ width: `${c.size}cqw`, height: `${c.size}cqw` }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: `${c.x}cqw`, y: ['0cqw', `${-c.up}cqw`, `${c.fall - c.up}cqw`], opacity: [0, 1, 1, 0], rotate: c.spin }}
          transition={{ duration: 1.9, delay: c.delay, ease: 'easeOut', times: [0, 0.35, 1] }}
        >
          <Coin size={64} />
        </motion.span>
      ))}
    </>
  )
}

export interface DealFx {
  readonly n: number
  readonly big: boolean
}

/** A shower of gold coins and a ribbon on every execution the game accepted. */
export function Deal({ deal }: { readonly deal: DealFx | null }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  return (
    <AnimatePresence>
      {deal && (
        <motion.div key={deal.n} className="fx" initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: deal.big ? 2.8 : 1.8, times: [0, 0.8, 1] }} exit={{ opacity: 0 }}>
          {!reduce && <CoinBurst n={deal.n} big={deal.big} />}
          <motion.div
            className="deal-badge"
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: deal.big ? [0, 1.2, 1] : [0, 0.8, 0.7], rotate: [-12, 5, -3] }}
            transition={{ duration: 0.6 }}
          >
            <span className="deal-coins" aria-hidden="true">
              <Coin size={56} />
              <Coin size={44} />
              <Coin size={50} />
            </span>
            <span className="ribbon">{deal.big ? t.dealDone : t.dealSent}</span>
            <span className="sr-only">{deal.big ? t.dealDoneSr : t.dealSentSr}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Original rune strokes (not a real alphabet): twelve glyphs around the shield. */
const RUNES = ['M0 -7V7M-4 -3l4 -4l4 4', 'M-5 -7l10 14M5 -7l-10 14', 'M-5 -7h8l2 5l-10 4l10 5', 'M0 -8l6 8l-6 8l-6 -8z', 'M-5 7V-7l10 7l-10 7', 'M-5 -7h10M0 -7V7M-5 7h10', 'M-4 -7V7M4 -7V7M-4 0h8', 'M0 -8a6 8 0 1 0 0.1 0M0 -2v10', 'M-5 -3l5 -5l5 5M-5 5l5 -5l5 5', 'M-5 7l5 -14l5 14M-3 2h6', 'M-5 -7l10 7l-10 7M5 -7v14', 'M0 -8V8M-5 -4l5 4l5 -4'] as const

/** The rune shield: a guardrail said no. A glowing hex shield flares, its rune ring turns, and it shakes. */
export function RuneShield({ n }: { readonly n: number | null }) {
  const reduce = useReducedMotion()
  const t = useStrings()
  return (
    <AnimatePresence>
      {n !== null && (
        <motion.div key={n} className="fx" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 2.6, times: [0, 0.1, 0.8, 1] }} exit={{ opacity: 0 }}>
          <motion.div
            className="rune-shield"
            role="img"
            aria-label={t.guardrailSr}
            initial={{ scale: 0.4 }}
            animate={reduce ? { scale: 1 } : { scale: [0.4, 1.12, 1], x: [0, -12, 12, -9, 9, -4, 4, 0] }}
            transition={{ duration: 0.9 }}
          >
            <svg viewBox="-100 -100 200 200" aria-hidden="true">
              <defs>
                <radialGradient id="shield-core">
                  <stop offset="0" stopColor="#bff6ff" stopOpacity="0.95" />
                  <stop offset="0.55" stopColor="#4fb3e8" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#6a3fd6" stopOpacity="0.15" />
                </radialGradient>
              </defs>
              <circle r="96" fill="url(#shield-core)" opacity="0.5" className="pulse" />
              <motion.g animate={reduce ? undefined : { rotate: 360 }} transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}>
                {RUNES.map((d, i) => (
                  <g key={i} transform={`rotate(${i * 30}) translate(0 -80)`}>
                    <path d={d} fill="none" stroke="#d9f6ff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                ))}
              </motion.g>
              <path d="M0 -66L57 -33V33L0 66L-57 33V-33Z" fill="url(#shield-core)" stroke="#d9f6ff" strokeWidth="5" strokeLinejoin="round" />
              <path d="M0 -50L43 -25V25L0 50L-43 25V-25Z" fill="none" stroke="#7dd3fc" strokeWidth="2" opacity="0.8" />
              <path d="M0 -28V20M-18 -10H18M-12 20h24" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.92" />
            </svg>
            <small>{t.guardrail}</small>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The game refused a request: a puff of smoke with the reason, in the show's language. */
export function Fail({ fail }: { readonly fail: { readonly n: number; readonly code: string } | null }) {
  const lang = useLang()
  return (
    <AnimatePresence>
      {fail && (
        <motion.div key={fail.n} className="fx" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 2.6, times: [0, 0.1, 0.8, 1] }}>
          <motion.div className="fail" initial={{ y: 20, scale: 0.8 }} animate={{ y: 0, scale: 1 }}>
            <svg viewBox="0 0 80 40" className="puff-cloud" aria-hidden="true">
              <circle cx="20" cy="24" r="14" />
              <circle cx="38" cy="16" r="16" />
              <circle cx="58" cy="24" r="14" />
              <rect x="14" y="22" width="52" height="16" rx="8" />
            </svg>
            <span>{errorWords(fail.code, lang)}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
