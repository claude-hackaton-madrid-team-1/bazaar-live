import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo } from 'react'
import { errorWords } from '../show/words'

const COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#9b5de5', '#ffd166', '#52b788', '#457b9d']

/** Deterministic pseudo-random numbers per burst (mulberry32), so renders stay pure. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function Confetti({ n, big }: { readonly n: number; readonly big: boolean }) {
  const pieces = useMemo(() => {
    const r = rng(n * 7919)
    return Array.from({ length: big ? 44 : 16 }, (_, i) => ({
      id: i,
      x: (r() - 0.5) * (big ? 90 : 50),
      y: -(r() * (big ? 34 : 20) + 6),
      fall: r() * 30 + 22,
      rotate: (r() - 0.5) * 900,
      color: COLORS[i % COLORS.length],
      delay: r() * 0.12,
    }))
  }, [n, big])
  return (
    <>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="confetti"
          style={{ background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: `${p.x}cqw`, y: [`0cqw`, `${p.y}cqw`, `${p.y + p.fall}cqw`], opacity: [1, 1, 0], rotate: p.rotate }}
          transition={{ duration: 1.8, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </>
  )
}

export interface DealFx {
  readonly n: number
  readonly big: boolean
}

/** Handshake (+ stamp on a real trade) and confetti on every execution the game accepted. */
export function Deal({ deal }: { readonly deal: DealFx | null }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {deal && (
        <motion.div key={deal.n} className="fx" initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ duration: deal.big ? 2.6 : 1.6, times: [0, 0.8, 1] }} exit={{ opacity: 0 }}>
          {!reduce && <Confetti n={deal.n} big={deal.big} />}
          <motion.div
            className="handshake"
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: deal.big ? [0, 1.25, 1] : [0, 0.7, 0.6], rotate: [-20, 10, 0] }}
            transition={{ duration: 0.6 }}
          >
            <span aria-hidden="true">🤝</span>
            {deal.big && <span className="stamp">¡TRATO HECHO!</span>}
            <span className="sr-only">{deal.big ? 'Deal done' : 'Sent to the game'}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The red stop sign: a guardrail said no. */
export function StopSign({ n }: { readonly n: number | null }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {n !== null && (
        <motion.div key={n} className="fx" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 2.4, times: [0, 0.1, 0.8, 1] }} exit={{ opacity: 0 }}>
          <motion.div
            className="stop-sign"
            role="img"
            aria-label="Stop: a guardrail denied the move"
            initial={{ scale: 0.4 }}
            animate={reduce ? { scale: 1 } : { scale: [0.4, 1.1, 1], x: [0, -14, 14, -10, 10, -5, 5, 0] }}
            transition={{ duration: 0.9 }}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <polygon points="30,2 70,2 98,30 98,70 70,98 30,98 2,70 2,30" fill="#d62828" stroke="#fff" strokeWidth="5" />
              <text x="50" y="60" textAnchor="middle" fontSize="26" fontWeight="900" fill="#fff" fontFamily="system-ui, sans-serif">
                ALTO
              </text>
            </svg>
            <small>GUARDRAIL</small>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The game refused a request: a grey puff with the reason. */
export function Fail({ fail }: { readonly fail: { readonly n: number; readonly code: string } | null }) {
  return (
    <AnimatePresence>
      {fail && (
        <motion.div key={fail.n} className="fx" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: 2.4, times: [0, 0.1, 0.8, 1] }}>
          <motion.div className="fail" initial={{ y: 20, scale: 0.8 }} animate={{ y: 0, scale: 1 }}>
            💨 {errorWords(fail.code)}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
