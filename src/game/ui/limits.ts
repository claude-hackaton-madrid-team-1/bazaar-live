import { useParam } from '../../ui/route'
import { useGame } from '../store.ts'

/**
 * The page may show our private limits (caps, duel limits) only with GAME_VIEW_TOKEN, or in the made-up mock game.
 * The server already sends them only behind the token; this keeps them out of view when the page has none.
 */
export function useLimitsVisible(): boolean {
  const token = useParam('token')
  const { status } = useGame()
  return Boolean(token) || status === 'mock'
}
