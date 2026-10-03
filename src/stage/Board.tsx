import { AnimatePresence, motion } from 'motion/react'
import type { BoardCard } from '../show/engine'

const HOOD_COLORS: Readonly<Record<string, string>> = {
  LAV: '#e76f51',
  MAL: '#9b5de5',
  LAT: '#f4a261',
  SAL: '#2a9d8f',
  RET: '#52b788',
  CHA: '#457b9d',
}

const HOODS: Readonly<Record<string, string>> = {
  LAV: 'Lavapiés',
  MAL: 'Malasaña',
  LAT: 'La Latina',
  SAL: 'Salamanca',
  RET: 'El Retiro',
  CHA: 'Chamberí',
}

function setOf(ref: string): string {
  return ref.slice(0, 3).toUpperCase()
}

/** A price tag whose number rolls to the new value and flashes on every reprice. */
export function PriceTag({ price, version }: { readonly price: number | null; readonly version: number }) {
  const label = price === null ? '¿?' : `${price} P`
  return (
    <motion.div
      className="price-tag"
      key={version}
      initial={version > 0 ? { scale: 1.35, backgroundColor: '#ffd166' } : false}
      animate={{ scale: 1, backgroundColor: '#f6bd60' }}
      transition={{ type: 'spring', stiffness: 400, damping: 12 }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={label}
          initial={{ y: '-110%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '110%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  )
}

function OfferCard({ card }: { readonly card: BoardCard }) {
  const set = setOf(card.ref)
  return (
    <motion.div
      layout
      className={`card ${card.side}`}
      initial={{ x: '-260%', y: '60%', rotate: -25, scale: 0.5, opacity: 0 }}
      animate={{ x: 0, y: 0, rotate: card.side === 'bid' ? 2 : -2, scale: 1, opacity: 1 }}
      exit={{ x: '-260%', y: '-40%', rotate: 30, scale: 0.4, opacity: 0, transition: { duration: 0.5 } }}
      transition={{ type: 'spring', stiffness: 120, damping: 15 }}
      aria-label={`${card.side === 'bid' ? 'Bid for' : 'Ask for'} ${card.ref}, ${card.price ?? 'price private'} primas`}
    >
      <span className="pin" />
      <div className="band" style={{ background: HOOD_COLORS[set] ?? '#8d99ae' }} />
      <div className="ref">{card.ref}</div>
      <div className="hood">{card.side === 'bid' ? 'WANTED · ' : ''}{HOODS[set] ?? 'Madrid'}</div>
      <PriceTag price={card.price} version={card.version} />
    </motion.div>
  )
}

export function Board({ cards }: { readonly cards: readonly BoardCard[] }) {
  return (
    <div className="board" aria-label="Our offers on the board">
      <AnimatePresence mode="popLayout">
        {cards.map((card) => (
          <OfferCard key={card.key} card={card} />
        ))}
      </AnimatePresence>
      {cards.length === 0 && <div className="board-empty">The board is empty… for now.</div>}
    </div>
  )
}
