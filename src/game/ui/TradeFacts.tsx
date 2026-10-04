import { useLang } from '../../ui/lang.ts'
import { whoName } from '../humanize.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import type { TradeFacts as Facts, TradeStage } from '../views/trade-context.ts'
import { Badge } from './bits.tsx'
import './trade-facts.css'

const WORDS = {
  en: {
    seller: 'Seller', buyer: 'Buyer', target: 'intended', market: 'Market', owner: 'Venue owner', unknown: 'Not recorded', anyone: 'Any buyer', anySeller: 'Any seller',
    dealer: 'Direct dealer negotiation', offer: 'Offer', thread: 'Thread',
    pending: 'No settlement confirmed', settled: 'Cards and cash moved',
    stages: { planned: 'Planned', submitted: 'Submitted · outcome pending', listed: 'Listed · awaiting acceptance', accepted: 'Accepted · awaiting settlement', settled: 'Settled', failed: 'Failed / outcome unconfirmed', expired: 'Expired', rejected: 'Rejected', offered: 'Price offered', noDeal: 'No deal' },
  },
  es: {
    seller: 'Vendedor', buyer: 'Comprador', target: 'previsto', market: 'Mercado', owner: 'Dueño del mercado', unknown: 'No consta', anyone: 'Cualquier comprador', anySeller: 'Cualquier vendedor',
    dealer: 'Negociación directa con comerciante', offer: 'Oferta', thread: 'Conversación',
    pending: 'Liquidación sin confirmar', settled: 'Cromos y efectivo transferidos',
    stages: { planned: 'Planeado', submitted: 'Enviado · resultado pendiente', listed: 'Publicado · pendiente de aceptación', accepted: 'Aceptado · pendiente de liquidación', settled: 'Liquidado', failed: 'Falló / resultado sin confirmar', expired: 'Caducado', rejected: 'Rechazado', offered: 'Precio propuesto', noDeal: 'Sin acuerdo' },
  },
} satisfies Record<string, { seller: string; buyer: string; target: string; market: string; owner: string; unknown: string; anyone: string; anySeller: string; dealer: string; offer: string; thread: string; pending: string; settled: string; stages: Record<TradeStage, string> }>

/** No identity is deduced from venue ownership: owners facilitate other teams' trades. */
export function TradeFacts({ facts }: { facts: Facts }) {
  const lang = useLang()
  const w = WORDS[lang]
  const t = useGameStrings()
  const { state } = useGame()
  const venue = facts.venue ? state.venues.get(facts.venue) : undefined
  const party = (id: string | null, fallback: string) => {
    if (!id) return fallback
    const name = id === state.team ? state.name || whoName(t, id) : whoName(t, id)
    return name === id ? id : `${name} (${id})`
  }
  const seller = party(facts.seller, facts.openToAnyone ? w.anySeller : w.unknown)
  const buyer = party(facts.buyer, facts.openToAnyone ? w.anyone : w.unknown)
  return (
    <span className="trade-facts" data-stage={facts.stage}>
      <Badge tone={facts.stage === 'settled' ? 'good' : facts.stage === 'failed' || facts.stage === 'rejected' ? 'bad' : 'neutral'} title={facts.stage === 'settled' ? w.settled : w.pending}>{w.stages[facts.stage]}</Badge>
      <span className="trade-parties"><span>{w.seller}{facts.stage !== 'settled' && ` (${w.target})`}: <b>{seller}</b></span><span aria-hidden="true">→</span><span>{w.buyer}{facts.stage !== 'settled' && ` (${w.target})`}: <b>{buyer}</b></span></span>
      <span className="trade-venue">{w.market}: {facts.dealer ? w.dealer : venue ? `${venue.id === 'rastro' ? 'El Rastro' : venue.name} (${venue.id})` : facts.venue ?? w.unknown}{!facts.dealer && <span> · {w.owner}: {party(venue?.owner ?? null, facts.venue === 'rastro' ? 'Causa Prima' : w.unknown)}</span>}</span>
      {(facts.offerId != null || facts.threadId != null) && <span className="gm-muted">{facts.offerId != null && `${w.offer} #${facts.offerId}`}{facts.offerId != null && facts.threadId != null && ' · '}{facts.threadId != null && `${w.thread} #${facts.threadId}`}</span>}
    </span>
  )
}
