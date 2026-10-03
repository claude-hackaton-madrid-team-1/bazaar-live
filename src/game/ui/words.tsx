/** The shared words as pieces of a screen: a time ago, an item. The plain words are in `../humanize.ts`. */
import { ago, itemOf, rivalOf } from '../humanize.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { nowTick } from '../views/decisions.ts'
import { RefChip } from './bits.tsx'

/** "3 min ago" from the newest tick we know; the tick itself on hover. */
export function Ago({ tick, from }: { tick: number; from?: number }) {
  const { state } = useGame()
  const t = useGameStrings()
  const a = ago(nowTick(state), tick, state.tickSeconds)
  const ticks = from != null && from !== tick ? `${t.tick} ${from}–${tick}` : `${t.tick} ${tick}`
  return <time title={ticks}>{t.hum.ago(a.ticks, a.seconds)}</time>
}

/** What a decision is about: a card as its named chip, a duel with its rival, a pack, or the text. */
export function ItemName({ item }: { item: string }) {
  const { state } = useGame()
  const t = useGameStrings()
  const i = itemOf(item, rivalOf(t, state))
  return i.kind === 'card' ? <RefChip topic={item} /> : <span className="gm-dec-item">{t.hum.item(i)}</span>
}
