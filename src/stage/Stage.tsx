import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRef } from 'react'
import type { Line } from '../show/beat'
import type { ShowState } from '../show/engine'
import { useLang, useStrings } from '../ui/lang'
import { Board, PriceTag } from './Board'
import { JevOrb, SpeechBubble } from './Bubbles'
import { appear } from './calm'
import { Dealer } from './Dealer'
import { DealLight, DealToast, Fail, Guard } from './Effects'
import { Field } from './Field'
import { hoodColor } from './hoods'
import { poses } from './poses'
import { useParallax } from './useParallax'
import { Bars, Voice } from './Voice'
import './stage.css'
import './voice.css'
import './board.css'
import './overlay.css'

/** The card the buyer reaches for: it slides out of the board to the buyer's orb; a denied grab drops it. */
function ReachCard({ reach }: { readonly reach: ShowState['reach'] }) {
  const t = useStrings()
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {reach && (
        <motion.div
          key={reach.n}
          className={`reach-card ${reach.take ? 'take' : 'drop'}`}
          style={{ ['--hood' as string]: hoodColor(reach.ref) }}
          {...appear(
            reduce,
            {
              initial: { x: '-12cqw', y: '0cqw', opacity: 0, scale: 0.92 },
              animate: reach.take
                ? { x: '0cqw', y: '0cqw', opacity: 1, scale: 1 }
                : { x: ['-12cqw', '0cqw', '0cqw'], y: ['0cqw', '0cqw', '6cqw'], opacity: [0, 1, 0], scale: 1 },
              exit: { opacity: 0, scale: 0.9, transition: { duration: 0.25 } },
              transition: reach.take ? { type: 'spring', stiffness: 150, damping: 22 } : { duration: 1.6, times: [0, 0.45, 1], ease: 'easeInOut' },
            },
            reach.take ? { x: '0cqw', y: '0cqw', opacity: 1, scale: 1 } : { x: '0cqw', y: '1.5cqw', opacity: 0.6, scale: 1 },
          )}
          aria-label={`${t.reaches} ${reach.ref}`}
        >
          <span className="card-ref">{reach.ref}</span>
          <PriceTag price={reach.price} version={0} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Nameplate({ role, talking, status }: { readonly role: 'seller' | 'buyer' | 'sales'; readonly talking: boolean; readonly status?: string }) {
  const t = useStrings()
  const es = useLang() === 'es'
  return (
    <div className={`nameplate ${role}`} title={role === 'sales' ? (es ? 'Analiza el mercado y los rivales para proponer ofertas dirigidas, coordinadas con Maker.' : 'Analyses market and rival intelligence to propose targeted offers coordinated with Maker.') : undefined}>
      <Bars talking={talking} />
      {role === 'sales' ? 'Sales' : role === 'buyer' ? t.buyer : t.seller}{' '}
      <small>
        <span aria-hidden="true">· </span>
        {role === 'sales' ? status : role === 'buyer' ? t.taker : t.maker}
      </small>
    </div>
  )
}

/** Which side the caption sits on: under whoever speaks. */
function sideOf(speaker: Line['speaker'] | 'sales' | undefined): 'start' | 'end' | 'center' {
  return speaker === 'seller' ? 'start' : speaker === 'buyer' ? 'end' : 'center'
}

export function Stage({ state }: { readonly state: ShowState }) {
  const t = useStrings()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  useParallax(ref)
  const pose = poses(state)
  const es = useLang() === 'es'
  const salesTalking = state.line?.speaker === 'seller' && state.line.dealer === 'sales'
  const speaker = salesTalking ? 'sales' : state.line?.speaker
  const salesStatus = state.broadcastStatus === 'live' ? (es ? 'en directo' : 'live') : state.broadcastStatus === 'demo' ? 'demo' : state.broadcastStatus === 'locked' ? (es ? 'protegido' : 'locked') : (es ? 'esperando' : 'waiting')
  const lineId = state.line && state.beat ? `${state.beat.id}:${state.beat.lines.indexOf(state.line)}` : 'none'
  return (
    <section className="stage" ref={ref} aria-label={t.stageLabel} data-mood={state.beat?.mood} data-speaker={speaker}>
      <div className="room">
        <Field />
        <div className="sign">{t.sign}</div>
        <Board cards={state.board} />
        <DealLight deal={state.deal} />
        <Voice role="seller" className="lead" pose={salesTalking ? 'idle' : pose.seller} talking={speaker === 'seller'} label={t.seller}>
          <Nameplate role="seller" talking={speaker === 'seller'} />
        </Voice>
        <Voice role="buyer" className="lead" pose={pose.buyer} talking={speaker === 'buyer'} label={t.buyer}>
          <Nameplate role="buyer" talking={speaker === 'buyer'} />
        </Voice>
        <Voice role="sales" className="lead" pose={salesTalking ? (state.denied || state.fail ? 'grumble' : state.deal ? 'triumph' : 'haggle') : 'idle'} talking={salesTalking} label={es ? 'Agente de ventas' : 'Sales agent'}>
          <Nameplate role="sales" talking={salesTalking} status={salesStatus} />
        </Voice>
        <Dealer dealer={state.dealer} speaking={speaker !== undefined && speaker !== 'buyer' && speaker !== 'seller' && speaker !== 'sales' && speaker !== 'narrator'} />
        <ReachCard reach={state.reach} />
        <div className="toasts">
          <DealToast deal={state.deal} />
          <Guard n={state.denied?.n ?? null} />
          <Fail fail={state.fail} />
          <AnimatePresence>
            {state.beat?.note && state.line && (
              <motion.div key={state.beat.note} className="practice" {...appear(reduce, { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } })}>
                {state.beat.note}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <JevOrb jev={state.jev} />
        <div className="dock" data-side={sideOf(speaker)}>
          <SpeechBubble line={state.line} id={lineId} />
        </div>
      </div>
    </section>
  )
}
