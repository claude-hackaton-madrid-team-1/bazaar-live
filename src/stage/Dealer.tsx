import { AnimatePresence, motion } from 'motion/react'
import type { DealerId } from '../show/beat'
import { DEALER_NAMES } from '../show/words'

/** Avatars as the organiser's /api/dealers describes them (colour and emoji). */
const LOOK: Readonly<Record<DealerId, { readonly color: string; readonly emoji: string }>> = {
  abuela: { color: '#E07A5F', emoji: '🧶' },
  chato: { color: '#5C6B73', emoji: '🧢' },
  other: { color: '#8d99ae', emoji: '🎩' },
}

const MOVES: Readonly<Record<string, string>> = {
  open: '¡Hola!',
  bid: 'haggling…',
  accept: '¡trato!',
  walk: 'walks away',
}

/** A dealer pops up from behind the table for dealer_* moves. */
export function Dealer({ dealer }: { readonly dealer: { readonly id: DealerId; readonly move: string } | null }) {
  return (
    <AnimatePresence>
      {dealer && (
        <motion.div
          key={dealer.id}
          className="dealer"
          initial={{ y: '120%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '120%', opacity: 0, transition: { duration: 0.35 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 16 }}
          aria-label={`${DEALER_NAMES[dealer.id]}: ${MOVES[dealer.move] ?? dealer.move}`}
        >
          <motion.div
            className="dealer-face"
            style={{ background: LOOK[dealer.id].color }}
            key={dealer.move}
            animate={dealer.move === 'walk' ? { rotate: [0, -12, 12, 0] } : { rotate: [0, 6, -6, 0], scale: [1, 1.08, 1] }}
            transition={{ duration: 0.6 }}
          >
            <span aria-hidden="true">{LOOK[dealer.id].emoji}</span>
          </motion.div>
          <div className="dealer-name">{DEALER_NAMES[dealer.id]}</div>
          <div className="dealer-move">{MOVES[dealer.move] ?? dealer.move}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
