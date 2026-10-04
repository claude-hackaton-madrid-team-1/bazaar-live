import { actionOf, record, type OperatorAction } from '../../shared/operator.ts'

/** Deliberately small command grammar: dictation edits text, never executes an action. */
export function commandAction(command: string): OperatorAction | null {
  const [verb, target, amount, ...tail] = command.trim().split(/\s+/)
  if (!verb || !target) return null
  const price = Number(amount)
  switch (verb.toLowerCase()) {
    case 'offer-buy':
    case 'offer-sell': return tail.length !== 1 ? null : actionOf({ kind: 'team_offer', side: verb.toLowerCase() === 'offer-buy' ? 'buy' : 'sell', thread_id: Number(target), target: amount, price: Number(tail[0]), text: '' })
    case 'bid': return tail.length ? null : actionOf({ kind: 'sell_bid', ref: target.toUpperCase(), price, venue: 'rastro', expires: 40 })
    case 'sell': return tail.length ? null : actionOf({ kind: 'sell_list', target, price, venue: 'rastro', expires: 40 })
    case 'accept': return amount ? null : actionOf({ kind: 'offer_accept', offer_id: Number(target) })
    case 'cancel': return amount ? null : actionOf({ kind: 'sell_cancel', offer_id: Number(target) })
    case 'open': return amount ? null : actionOf({ kind: 'team_open', team_id: target.toLowerCase(), venue: 'rastro' })
    case 'close': return amount ? null : actionOf({ kind: 'team_close', thread_id: Number(target) })
    case 'say': return actionOf({ kind: 'team_say', thread_id: Number(target), text: [amount, ...tail].filter(Boolean).join(' ') })
    default: return null
  }
}

export function actionFacts(action: OperatorAction): readonly [string, string][] {
  const values: [string, string][] = [['Action', action.kind.replaceAll('_', ' ')]]
  for (const [name, value] of Object.entries(action)) {
    if (name !== 'kind') values.push([name.replaceAll('_', ' '), String(value)])
  }
  return values
}

/** Unknown outcomes never retry themselves. The operator reviews before issuing another command. */
export async function operatorRequest(path: 'proposal' | 'review' | 'confirm' | 'status', csrf: string, body: unknown): Promise<unknown> {
  const res = await fetch(`/api/approver/${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(res.status === 401 ? 'Session expired. Unlock the operator desk again.' : 'The request could not be confirmed. Review its status before trying again.')
  return res.json()
}

interface RecognitionResultEvent { results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }
export interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  abort(): void
}
interface RecognitionConstructor { new(): Recognition }
declare global { interface Window { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor } }
export function recognitionConstructor(): RecognitionConstructor | null {
  return typeof window === 'undefined' ? null : window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function finalTranscript(event: unknown): string | null {
  if (!record(event) || !record(event.results)) return null
  const first = event.results[0]
  if (!record(first) || first.isFinal !== true || !record(first[0]) || typeof first[0].transcript !== 'string') return null
  return first[0].transcript.slice(0, 1200)
}
