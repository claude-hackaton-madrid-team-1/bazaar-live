import { AnimatePresence, motion } from 'motion/react'
import type { ShowState } from '../show/engine'
import { Board, PriceTag } from './Board'
import { JevBubble, SpeechBubble } from './Bubbles'
import { Character, type Pose } from './Character'
import { Dealer } from './Dealer'
import { Deal, Fail, StopSign } from './Effects'

function poses(state: ShowState): { buyer: Pose; seller: Pose } {
  if (state.deal?.big) return { buyer: 'shake', seller: 'shake' }
  if (state.denied) return state.beat?.agent === 'taker' ? { buyer: 'shrug', seller: 'idle' } : { buyer: 'idle', seller: 'shrug' }
  if (state.fail) return state.beat?.agent === 'taker' ? { buyer: 'shrug', seller: 'idle' } : { buyer: 'idle', seller: 'shrug' }
  if (state.reach?.take) return { buyer: 'reach', seller: 'idle' }
  if (state.deal) return state.beat?.agent === 'taker' ? { buyer: 'cheer', seller: 'idle' } : { buyer: 'idle', seller: 'cheer' }
  const cue = state.beat?.cue.kind
  if (cue === 'post' || cue === 'reprice' || cue === 'cancel') return { buyer: 'idle', seller: 'reach' }
  return { buyer: 'idle', seller: 'idle' }
}

/** The card the buyer reaches for: it flies in from the other stalls; a denied grab drops it. */
function ReachCard({ reach }: { readonly reach: ShowState['reach'] }) {
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
          aria-label={`The buyer reaches for ${reach.ref}`}
        >
          <span>{reach.ref}</span>
          <PriceTag price={reach.price} version={0} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Stage({ state }: { readonly state: ShowState }) {
  const pose = poses(state)
  const speaker = state.line?.speaker
  const lineId = state.line && state.beat ? `${state.beat.id}:${state.beat.lines.indexOf(state.line)}` : 'none'
  return (
    <section className="stage" aria-label="The stall at El Rastro">
      <div className="awning" />
      <div className="sign">EL RASTRO · STALL Nº 1</div>
      <Board cards={state.board} />
      <JevBubble jev={state.jev} />
      <Character role="seller" talking={speaker === 'seller'} pose={pose.seller} />
      <Character role="buyer" talking={speaker === 'buyer'} pose={pose.buyer} />
      <div className="table" />
      <Dealer dealer={state.dealer} />
      <ReachCard reach={state.reach} />
      <SpeechBubble line={state.line} id={lineId} />
      <Deal deal={state.deal} />
      <StopSign n={state.denied?.n ?? null} />
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
