import type { ShowState } from '../show/engine'
import type { Pose } from './Merchant'

const DEALER_POSE: Readonly<Record<string, Pose>> = { open: 'greet', bid: 'haggle', accept: 'triumph', walk: 'grumble' }

/** What each lead does for what the stage is showing: a deal lifts both, a refusal sulks, a dealer is haggled with. */
export function poses(state: ShowState): { buyer: Pose; seller: Pose } {
  const refused = state.denied ?? state.fail
  const buyerActs = state.beat?.agent === 'taker'
  if (state.deal?.big) return { buyer: 'triumph', seller: 'triumph' }
  if (refused) return buyerActs ? { buyer: 'grumble', seller: 'idle' } : { buyer: 'idle', seller: 'grumble' }
  if (state.reach?.take) return { buyer: 'reach', seller: 'idle' }
  if (state.deal) return buyerActs ? { buyer: 'triumph', seller: 'idle' } : { buyer: 'idle', seller: 'triumph' }
  if (state.dealer) return { buyer: DEALER_POSE[state.dealer.move] ?? 'idle', seller: 'idle' }
  const cue = state.beat?.cue.kind
  if (cue === 'post') return { buyer: 'idle', seller: 'reach' }
  if (cue === 'reprice') return { buyer: 'idle', seller: 'haggle' }
  return { buyer: 'idle', seller: 'idle' }
}

