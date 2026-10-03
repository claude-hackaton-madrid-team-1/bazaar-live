import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { ShowState } from '../show/engine'
import { useStrings } from '../ui/lang'
import { Board, PriceTag } from './Board'
import { JevOrb, SpeechBubble } from './Bubbles'
import { Dealer } from './Dealer'
import { Deal, Fail, RuneShield } from './Effects'
import { Merchant } from './Merchant'
import { poses } from './poses'
import { BackdropFar, Counter, Foreground } from './scene/Backdrop'
import './stage.css'

/** The card the buyer reaches for: it flies in from the other stalls; a denied grab drops it. */
function ReachCard({ reach }: { readonly reach: ShowState['reach'] }) {
  const t = useStrings()
  return (
    <AnimatePresence>
      {reach && (
        <motion.div
          key={reach.n}
          className="reach-card"
          initial={{ x: '160%', y: '-120%', rotate: 25, opacity: 0 }}
          animate={reach.take ? { x: 0, y: 0, rotate: -8, opacity: 1 } : { x: ['160%', '0%', '0%'], y: ['-120%', '0%', '180%'], rotate: [25, -8, 40], opacity: [0, 1, 0] }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.3 } }}
          transition={reach.take ? { type: 'spring', stiffness: 140, damping: 16 } : { duration: 1.6, times: [0, 0.4, 1] }}
          aria-label={`${t.reaches} ${reach.ref}`}
        >
          <span>{reach.ref}</span>
          <PriceTag price={reach.price} version={0} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Nameplate({ role }: { readonly role: 'seller' | 'buyer' }) {
  const t = useStrings()
  return (
    <div className={`nameplate ${role}`}>
      {role === 'buyer' ? t.buyer : t.seller} <small>{role === 'buyer' ? t.taker : t.maker}</small>
    </div>
  )
}

/** Moves the layers a little with the pointer (CSS variables only: no React renders, no layout). */
function useParallax(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const set = (x: number, y: number) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--px', x.toFixed(3))
        el.style.setProperty('--py', y.toFixed(3))
      })
    }
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      set(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2)
    }
    const leave = () => set(0, 0)
    el.addEventListener('pointermove', move, { passive: true })
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [ref])
}

export function Stage({ state }: { readonly state: ShowState }) {
  const t = useStrings()
  const ref = useRef<HTMLElement>(null)
  useParallax(ref)
  const pose = poses(state)
  const speaker = state.line?.speaker
  const lineId = state.line && state.beat ? `${state.beat.id}:${state.beat.lines.indexOf(state.line)}` : 'none'
  return (
    <section className="stage" ref={ref} aria-label={t.stageLabel} data-mood={state.beat?.mood}>
      <BackdropFar />
      <div className="sign">{t.sign}</div>
      <Board cards={state.board} />
      <JevOrb jev={state.jev} />
      <Merchant role="seller" className="lead" pose={pose.seller} talking={speaker === 'seller'} label={t.seller} />
      <Merchant role="buyer" className="lead" flip pose={pose.buyer} talking={speaker === 'buyer'} label={t.buyer} />
      <Dealer dealer={state.dealer} speaking={speaker === 'abuela' || speaker === 'chato'} />
      <Counter />
      <Nameplate role="seller" />
      <Nameplate role="buyer" />
      <Foreground />
      <ReachCard reach={state.reach} />
      <SpeechBubble line={state.line} id={lineId} />
      <Deal deal={state.deal} />
      <RuneShield n={state.denied?.n ?? null} />
      <Fail fail={state.fail} />
      <AnimatePresence>
        {state.beat?.note && state.line && (
          <motion.div key={state.beat.note} className="practice" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {state.beat.note}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
