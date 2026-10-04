import { useEffect, useRef, useState, type FormEvent } from 'react'
import { proposalOf, resultOf, type OperatorProposal, type OperatorResult, type OperatorSnapshot, record } from '../../../shared/operator.ts'
import { actionFacts, commandAction, finalTranscript, operatorRequest, recognitionConstructor, type Recognition } from '../operator.ts'
import { confirmClickCounts } from '../approvals.ts'
import { Panel } from './bits.tsx'

type View = { kind: 'empty' } | { kind: 'proposal'; value: OperatorProposal } | { kind: 'result'; value: OperatorResult }

/** Uses the existing human session. A microphone only fills the same reviewable command field. */
export function OperatorDesk({ csrf }: { csrf: string }) {
  const [snapshot, setSnapshot] = useState<OperatorSnapshot | null>(null)
  const [command, setCommand] = useState('')
  const [view, setView] = useState<View>({ kind: 'empty' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [listening, setListening] = useState(false)
  const lock = useRef(false)
  const recognition = useRef<Recognition | null>(null)
  const shownAt = useRef(0)
  const [pending, setPending] = useState<string | null>(null)
  const action = commandAction(command)
  const Speech = recognitionConstructor()
  useEffect(() => () => recognition.current?.abort(), [])

  const edit = (text: string) => {
    setCommand(text)
    setView({ kind: 'empty' })
    setMessage('')
  }
  const run = async (path: 'proposal' | 'review' | 'confirm' | 'status', body: unknown) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setMessage('')
    try {
      const answer = await operatorRequest(path, csrf, body)
      if (path === 'status') {
        if (!record(answer) || !Array.isArray(answer.facts) || !Array.isArray(answer.incidents) || typeof answer.evidence !== 'string') throw new Error('Operator status unavailable.')
        const facts: [string, string][] = answer.facts.filter((row): row is [string, string] => Array.isArray(row) && row.length === 2 && row.every((x) => typeof x === 'string'))
        setSnapshot({ facts, incidents: answer.incidents.filter((row): row is string => typeof row === 'string'), evidence: answer.evidence })
        return
      }
      const proposal = proposalOf(answer)
      const result = resultOf(answer)
      if (proposal) {
        setPending(proposal.proposal_id)
        shownAt.current = performance.now()
        setView({ kind: 'proposal', value: proposal })
      } else if (result) setView({ kind: 'result', value: result })
      else throw new Error('The server response was incomplete. Review the status before trying again.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connection lost. Review the status before trying again.')
      // A failed confirmation has an unknown outcome: never leave an active execution button behind.
      if (path === 'confirm') setView({ kind: 'empty' })
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const propose = (e: FormEvent) => {
    e.preventDefault()
    if (action) void run('proposal', { action })
  }
  const dictate = () => {
    if (listening) { recognition.current?.abort(); return }
    if (!Speech) return
    const listener = new Speech()
    recognition.current = listener
    listener.lang = 'en-GB'
    listener.continuous = false
    listener.interimResults = false
    listener.onresult = (event) => { const text = finalTranscript(event); if (text) edit(text) }
    listener.onerror = () => setMessage('Dictation unavailable. Type your command instead.')
    listener.onend = () => setListening(false)
    try { listener.start(); setListening(true) } catch { setMessage('Microphone unavailable. Type your command instead.') }
  }

  return (
    <Panel title="Operator desk" sub="Propose → review exact terms → approve and send">
      <p className="ap-lead gm-muted">Nothing is sent to the game until you approve the displayed action. Existing trading limits still apply.</p>
      <button type="button" className="gm-btn" disabled={busy} onClick={() => void run('status', {})}>Refresh private operator status</button>
      {snapshot && <div className="op-proposal"><dl className="ap-facts">{snapshot.facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p className="gm-muted">Snapshot at the tick shown. {snapshot.evidence}</p>{snapshot.incidents.map((incident, i) => <p key={i}>{incident}</p>)}</div>}
      <form className="op-command" onSubmit={propose}>
        <label className="ap-field" htmlFor="operator-command">Command
          <input id="operator-command" className="ap-input" value={command} maxLength={1200} placeholder="bid RET-02 8" onChange={(e) => edit(e.target.value)} disabled={busy || listening} autoComplete="off" />
        </label>
        <button className="gm-btn ap-primary" disabled={!action || busy || listening}>Review proposal</button>
        {Speech && <button type="button" className="gm-btn" onClick={dictate} disabled={busy}>{listening ? 'Stop dictation' : 'Dictate command'}</button>}
      </form>
      <details className="op-help"><summary>Commands and microphone</summary><p><code>bid RET-02 8</code> · <code>sell asset-id 20</code> · <code>accept 123</code> · <code>cancel 123</code> · <code>open t09</code> · <code>say 123 Your message</code> · <code>offer-buy 123 RET-02 8</code> · <code>offer-sell 123 asset-id 20</code> · <code>close 123</code></p><p>Listings use El Rastro and expire after 40 ticks. Dictation only edits the input. Your browser may send audio to its recognition service; typing works without microphone access.</p></details>
      {view.kind === 'proposal' && <div className="op-proposal">
        <div className="op-heading"><b>{view.value.summary}</b><span>{view.value.world} · {view.value.status}</span></div>
        <dl className="ap-facts">{actionFacts(view.value.action).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}<div><dt>Review window</dt><dd>Tick {view.value.created_tick}–{view.value.expires_tick}; checked again before sending</dd></div></dl>
        <p>{view.value.reason}</p>
        <button type="button" className="gm-btn ap-primary" disabled={busy || !view.value.allowed || !['proposed', 'approved'].includes(view.value.status)} onClick={(e) => {
          if (confirmClickCounts(e.detail, performance.now() - shownAt.current)) void run('confirm', { proposal_id: view.value.proposal_id, action: view.value.action })
        }}>Approve exact terms and send</button>
        <button type="button" className="gm-btn" disabled={busy} onClick={() => { setView({ kind: 'empty' }); setPending(null) }}>Discard</button>
      </div>}
      {view.kind === 'result' && <div className="op-proposal" role="status"><b>{view.value.status.replaceAll('_', ' ')}</b><p>{view.value.reason}</p><p className="gm-muted">{view.value.sent === null ? 'Outcome unknown. Check status; do not retry this action.' : view.value.sent ? 'Submitted to the game. A confirmed settlement is a separate event.' : 'No confirmed game submission.'}</p></div>}
      {message && <p className="ap-msg" data-tone="warn" role="alert">{message}</p>}
      {pending && <button type="button" className="gm-btn" disabled={busy} onClick={() => void run('review', { proposal_id: pending })}>Check proposal status</button>}
      {busy && <p role="status">Checking the game and the shared action budget…</p>}
    </Panel>
  )
}
