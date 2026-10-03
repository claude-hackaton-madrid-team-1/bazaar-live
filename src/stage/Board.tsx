import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Ref } from 'react'
import type { BoardCard } from '../show/engine'
import { useStrings } from '../ui/lang'
import { appear, EASE_OUT } from './calm'
import { hoodColor, setOf } from './hoods'

/** A price capsule: the number rolls to the new value and the capsule glows once on every reprice. */
export function PriceTag({ price, version }: { readonly price: number | null; readonly version: number }) {
  const reduce = useReducedMotion()
  const label = price === null ? '¿?' : `${price} P`
  return (
    <span className="price-tag">
      {version > 0 && !reduce && (
        <motion.span key={version} className="price-glow" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.6, ease: 'easeOut' }} aria-hidden="true" />
      )}
      {reduce ? (
        <span className="price-num">{label}</span>
      ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={label}
            className="price-num"
            initial={{ y: '-100%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ duration: 0.42, ease: EASE_OUT }}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  )
}

function OfferCard({ card, ref }: { readonly card: BoardCard; readonly ref?: Ref<HTMLDivElement> }) {
  const t = useStrings()
  const reduce = useReducedMotion()
  return (
    <motion.div
      ref={ref}
      layout
      className={`card ${card.side}`}
      style={{ ['--hood' as string]: hoodColor(card.ref) }}
      {...appear(reduce, {
        initial: { opacity: 0, y: 12, scale: 0.96 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, scale: 0.94, transition: { duration: 0.24 } },
        transition: { duration: 0.5, ease: EASE_OUT },
      })}
      aria-label={`${card.side === 'bid' ? t.bidFor : t.askFor} ${card.ref}, ${card.price ?? t.cardPrivate} ${t.primas}`}
    >
      <span className="card-ref">{card.ref}</span>
      <span className="card-hood">{t.hoods[setOf(card.ref)] ?? 'Madrid'}</span>
      {card.side === 'bid' && <span className="card-wanted">{t.wanted}</span>}
      <PriceTag price={card.price} version={card.version} />
    </motion.div>
  )
}

/** The board: a frosted tray between the two orbs, with our open offers as crisp tiles. */
export function Board({ cards }: { readonly cards: readonly BoardCard[] }) {
  const t = useStrings()
  return (
    <div className="board material" aria-label={t.boardLabel}>
      <AnimatePresence mode="popLayout">
        {cards.map((card) => (
          <OfferCard key={card.key} card={card} />
        ))}
      </AnimatePresence>
      {cards.length === 0 && <div className="board-empty">{t.boardEmpty}</div>}
    </div>
  )
}
