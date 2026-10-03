/**
 * Ended threads as the live game sent them (tick 565, Sat 3 Oct): seven Abuela threads selling SAL-01, none with a
 * thread.closed of ours in the feed, each scored `bad` with no price. Why each ended, and one row for the seven.
 */
import { assert, test } from 'vitest'
import { GAME_STRINGS } from '../strings.ts'
import { apply, createState, type GameEvent, type Payload, type State } from '../state.ts'
import { endedGroups, negRow, negRows } from './negotiations.ts'

let nextId = 1
const ev = (type: string, payload: Payload = {}, tick = 10): GameEvent => ({ id: nextId++, tick, t: 0.1, type, scope: 'public', actor: '', payload })

const fresh = (tick: number): State => {
  const s = createState()
  apply(s, ev('agent.hello', { team: 't01', name: 'Team 1' }))
  apply(s, ev('clock', { day: 'sat' }, tick))
  return s
}

/** Our ask for SAL-01 (we sell), and Abuela's bid, as the feed carries them. */
const ourAsk = (thread: number, price: number, tick: number) => ev('thread.message', {
  thread, kind: 'persona', team: 't01', with: 'abuela', sender: 't01', text: null,
  offer: { id: nextId, maker: 't01', to: 'abuela', give: { cash: 0, assets: [{ id: 41, ref: 'SAL-01' }], types: [] }, want: { cash: price, assets: [], types: [] }, created_tick: tick, expires_tick: tick + 4, final: false },
}, tick)

const herBid = (thread: number, price: number, tick: number, final = false) => ev('thread.message', {
  thread, kind: 'persona', team: 't01', with: 'abuela', sender: 'abuela', text: 'Ay, hijo',
  offer: { id: nextId, maker: 'abuela', to: 't01', give: { cash: price, assets: [], types: [] }, want: { cash: 0, assets: [], types: ['card:SAL-01'] }, created_tick: tick, expires_tick: tick + 4, final },
}, tick)

const scored = (thread: number, tick: number) => ev('agent.outcome', {
  target: 'dealer', subject: `thread:${thread}`, decision: null, agent: 'taker', item: null, counterparty: 'abuela', side: 'sell',
  price: null, value: null, label: 'bad', score: 0, surplus: null, jev: null, jevRight: null,
}, tick)

/** Thread 776: we asked 21 → 9, she bid 5 → 6 and named 6 as her final; no deal. */
const thread776 = (s: State, id = 776, t = 554) => {
  for (const e of [ourAsk(id, 21, t), herBid(id, 5, t), ourAsk(id, 15, t + 2), herBid(id, 6, t + 2), ourAsk(id, 9, t + 4), herBid(id, 6, t + 5, true), scored(id, t + 7)]) apply(s, e)
}

test('a thread whose last word was her final, on the wrong side of our last price, ended on that final', () => {
  const s = fresh(565)
  thread776(s)
  const r = negRow(s, s.threads[776]!)
  assert.deepEqual([r.status, r.state, r.ended?.how, r.ended?.theirs, r.ended?.ours], ['closed', 'lost', 'final', 6, 9])
  assert.deepInclude(r.verdict, { kind: 'lost', how: 'final', theirs: 6, ours: 9 })
  assert.equal(GAME_STRINGS.es.neg.verdict(r.verdict, 'sell'), 'Su oferta final de 6 P se quedó por debajo de nuestros 9 P.')
  assert.equal(GAME_STRINGS.en.neg.verdict(r.verdict, 'sell'), 'Their final 6 P stayed below our 9 P.')
})

test('a thread that went quiet until its last offer lapsed ended idle, not "closed without a deal"', () => {
  const s = fresh(570)
  for (const e of [ourAsk(782, 21, 560), herBid(782, 5, 560), scored(782, 566)]) apply(s, e)
  const r = negRow(s, s.threads[782]!)
  assert.deepEqual([r.status, r.ended?.how], ['closed', 'expired'])
})

test('the open count only holds live threads: six scored and lapsed threads and one live one read 1 live, 6 ended', () => {
  const s = fresh(565)
  for (const [i, id] of [732, 743, 751, 757, 770, 776].entries()) thread776(s, id, 509 + 7 * i)
  for (const e of [ourAsk(782, 21, 563), herBid(782, 5, 563)]) apply(s, e)
  const rows = negRows(s)
  assert.deepEqual(rows.filter((r) => r.status === 'open').map((r) => r.id), [782])
  assert.equal(rows.filter((r) => r.status === 'closed').length, 6)
})

test('repeated ended threads on the same dealer, item and side are one row with ×N, newest first', () => {
  const s = fresh(600)
  for (const [i, id] of [732, 743, 751].entries()) thread776(s, id, 509 + 7 * i)
  // a different item with the same dealer stays its own row
  for (const e of [ourAsk(760, 30, 540), herBid(760, 10, 540), scored(760, 546)]) apply(s, e)
  s.threads[760]!.topic = 'SAL-02'
  const groups = endedGroups(negRows(s))
  assert.deepEqual(groups.map((g) => [g.latest.id, g.rows.map((r) => r.id), g.deals]), [[760, [760], 0], [751, [751, 743, 732], 0]])
  assert.equal(GAME_STRINGS.es.neg.times(3), '×3')
})

test('a won thread is never folded into a group of lost ones on the same card: a deal keeps its own row', () => {
  const s = fresh(600)
  for (const e of [ourAsk(740, 12, 500), herBid(740, 12, 500), ev('settlement', { settlement: 9, parties: ['abuela', 't01'], price: 12, items: [{ id: 41, ref: 'SAL-01', frm: 't01', to: 'abuela' }] }, 501)]) apply(s, e)
  for (const [i, id] of [751, 760].entries()) thread776(s, id, 520 + 10 * i)
  const groups = endedGroups(negRows(s))
  assert.deepEqual(groups.map((g) => [g.latest.id, g.latest.state, g.rows.map((r) => r.id)]), [[760, 'lost', [760, 751]], [740, 'won', [740]]])
})

test('her final missed and then we walked: the row says why (her final), which is what the walk answered', () => {
  const s = fresh(565)
  thread776(s)
  apply(s, ev('agent.decision', {
    decision: 1, agent: 'taker', kind: 'dealer_walk', item: 'SAL-01', counterparty: 'abuela', price: null, value: null, status: 'done', verdict: 'allowed',
    rule: null, text: null, jev: null, jevValue: null, method: 'close_thread', error: null, outcome: null, surplus: null, jevRight: null,
  }, 560))
  assert.equal(negRow(s, s.threads[776]!).ended?.how, 'final')
})
