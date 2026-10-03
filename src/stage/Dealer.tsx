import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { DealerId } from '../show/beat'
import { useStrings } from '../ui/lang'
import { appear } from './calm'
import { DEALER_POSE } from './poses'
import { Bars, Voice } from './Voice'

/**
 * A dealer joins the room for dealer_* moves as a third, smaller orb that glides up from the floor:
 * Abuela Carmen in rose, El Chato in indigo. The move sets its light (greet, haggle, triumph, grumble)
 * and is written beside it; a dealer who walks away drifts off to its side.
 */
export function Dealer({ dealer, speaking }: { readonly dealer: { readonly id: DealerId; readonly move: string } | null; readonly speaking: boolean }) {
  const t = useStrings()
  const reduce = useReducedMotion()
  return (
    <AnimatePresence>
      {dealer && (
        <motion.div
          key={dealer.id}
          className="dealer"
          data-voice={dealer.id === 'chato' ? 'chato' : 'abuela'}
          {...appear(reduce, {
            initial: { y: '60%', opacity: 0 },
            animate: { y: '0%', opacity: 1 },
            exit:
              dealer.move === 'walk'
                ? { x: dealer.id === 'chato' ? '30%' : '-30%', opacity: 0, transition: { duration: 0.6 } }
                : { y: '40%', opacity: 0, transition: { duration: 0.3 } },
            transition: { type: 'spring', stiffness: 170, damping: 24 },
          })}
          aria-label={`${t.dealers[dealer.id]}: ${t.moves[dealer.move] ?? dealer.move}`}
        >
          <Voice role={dealer.id === 'chato' ? 'chato' : 'abuela'} className="small" pose={DEALER_POSE[dealer.move] ?? 'idle'} talking={speaking} label={t.dealers[dealer.id]} />
          <div className="dealer-plaque">
            <Bars talking={speaking} />
            <span className="dealer-name">{t.dealers[dealer.id]}</span>
            <span className="dealer-move">{t.moves[dealer.move] ?? dealer.move}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
