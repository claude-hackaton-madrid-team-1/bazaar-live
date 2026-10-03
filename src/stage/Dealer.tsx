import { AnimatePresence, motion } from 'motion/react'
import type { DealerId } from '../show/beat'
import { useStrings } from '../ui/langContext'
import { Merchant, type Pose } from './Merchant'

const POSE: Readonly<Record<string, Pose>> = { open: 'greet', bid: 'haggle', accept: 'triumph', walk: 'grumble' }

/**
 * A dealer steps up behind the counter for dealer_* moves, as a full merchant: Abuela Carmen with her
 * lantern, or El Chato in his flat cap. The move sets the gesture: greet, haggle, triumph, or grumble
 * and turn away.
 */
export function Dealer({ dealer, speaking }: { readonly dealer: { readonly id: DealerId; readonly move: string } | null; readonly speaking: boolean }) {
  const t = useStrings()
  return (
    <AnimatePresence>
      {dealer && (
        <motion.div
          key={dealer.id}
          className={`dealer ${dealer.id}`}
          initial={{ y: '40%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={dealer.move === 'walk' ? { x: dealer.id === 'chato' ? '60%' : '-60%', opacity: 0, transition: { duration: 0.6 } } : { y: '40%', opacity: 0, transition: { duration: 0.35 } }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          aria-label={`${t.dealers[dealer.id]}: ${t.moves[dealer.move] ?? dealer.move}`}
        >
          <Merchant role={dealer.id === 'chato' ? 'chato' : 'abuela'} pose={POSE[dealer.move] ?? 'idle'} talking={speaking} label={t.dealers[dealer.id]} />
          <div className="dealer-plaque">
            <span className="dealer-name">{t.dealers[dealer.id]}</span>
            <span className="dealer-move">{t.moves[dealer.move] ?? dealer.move}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
