/**
 * The Duels screen's live chat: one duel as a conversation (views/duelChat.ts), read the way the show's transcript
 * reads: who spoke, what they offered, the tick once per turn, and the log follows the newest line unless the
 * reader scrolled up. A duel is picked with `?duel=`; without it the chat follows the duel that moved last.
 * Our limit and whether their offer is inside it only show with GAME_VIEW_TOKEN (or in the mock game).
 */
import { useEffect, useMemo, useRef } from 'react'
import { setParam, useParam } from '../../ui/route'
import { useDuelStrings, type DuelStrings } from '../duelStrings.ts'
import { fmtP } from '../game.ts'
import type { Duel } from '../state.ts'
import { useGame } from '../store.ts'
import { chatDuels, duelChat, type ChatLine } from '../views/duelChat.ts'
import { Badge, Empty, Panel } from './bits.tsx'
import { useLimitsVisible } from './limits.ts'
import './duel-chat.css'

const pct = (share: number | null) => (share == null ? null : `${Math.round(share * 100)} %`)

/** The tick a line belongs to, for the once-per-turn tick and the hairline between turns. */
const tickOf = (l: ChatLine): number | null => (l.kind === 'wait' ? l.fromTick : l.tick)

/** The indexes of the lines that open a new tick: the tick shows once per turn, not on every line of it. */
function turnStarts(lines: readonly ChatLine[]): ReadonlySet<number> {
  const starts = new Set<number>()
  let tick: number | null = null
  lines.forEach((l, i) => {
    const at = tickOf(l)
    if (at == null) return
    if (at !== tick) starts.add(i)
    tick = at
  })
  return starts
}

function lineWho(l: ChatLine, rival: string, t: DuelStrings): { who: 'us' | 'them' | 'sys'; name: string | null } {
  if (l.kind === 'msg') return l.from === 'us' ? { who: 'us', name: t.chat.us } : { who: 'them', name: rival }
  if (l.kind === 'accept' || l.kind === 'refused' || l.kind === 'wait') return { who: 'us', name: t.chat.us }
  return { who: 'sys', name: null }
}

function Said({ l, d, t }: { l: ChatLine; d: Duel; t: DuelStrings }) {
  switch (l.kind) {
    case 'start':
      return <>{t.chat.start(l.side, l.item ?? '?', l.rival ?? '?', l.limit == null ? null : fmtP(l.limit), l.deadlineTick, pct(l.decay))}</>
    case 'msg':
      return (
        <>
          <b className="dc-offer">{t.chat.offer(l.price == null ? null : fmtP(l.price), l.days)}</b>
          {l.inside != null && <Badge tone={l.inside ? 'good' : 'bad'}>{l.inside ? t.chat.inside : t.chat.outside}</Badge>}
          {l.jev && <Badge tone="neutral">{t.chat.jev(l.jev)}</Badge>}
          {l.round && <span className="dc-round">{t.chat.round(l.round.n, pct(l.round.taken))}</span>}
        </>
      )
    case 'wait':
      return <span className="dc-quiet">{t.chat.wait(l.ticks)}</span>
    case 'accept':
      return (
        <>
          <b>{t.chat.accept(l.done)}</b>
          {l.jev && <Badge tone="neutral">{t.chat.jev(l.jev)}</Badge>}
        </>
      )
    case 'refused':
      return <span className="gm-bad">{t.chat.refused(l.action, l.error ?? l.rule)}</span>
    case 'end':
      return l.deal ? (
        <b className="dc-deal">✔ {t.chat.deal(l.price == null ? null : fmtP(l.price), l.rounds, l.gain == null ? null : fmtP(l.gain))}</b>
      ) : (
        <b className="gm-bad">✖ {t.chat.noDeal(l.rounds ?? d.finalRounds)}</b>
      )
  }
}

function Picker({ duels, current }: { duels: Duel[]; current: Duel | null }) {
  const t = useDuelStrings()
  const picked = useParam('duel')
  return (
    <div className="dc-picker" role="group" aria-label={t.chat.pick}>
      {picked != null && (
        <button type="button" className="gm-btn dc-follow" onClick={() => setParam('duel', null)}>
          ↧ {t.chat.follow}
        </button>
      )}
      {duels.map((d) => (
        <button key={d.id} type="button" className="dc-chip" aria-pressed={current?.id === d.id} data-live={d.status === 'open' || undefined} onClick={() => setParam('duel', String(d.id))}>
          <span className="dc-chip-dot" aria-hidden="true" />#{d.id} · {d.rival ?? '?'}
          <span className="gm-muted"> · {d.status === 'open' ? t.chat.live : t.chat.ended}</span>
        </button>
      ))}
    </div>
  )
}

export function DuelChat() {
  const { state, version } = useGame()
  const t = useDuelStrings()
  const limits = useLimitsVisible()
  const picked = useParam('duel')
  const duels = useMemo(
    () => chatDuels(state.duels),
    // the state is mutated in place: the version is what changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, version],
  )
  const chosen = picked == null ? undefined : state.duels[Number(picked)]
  const current = chosen ?? duels[0] ?? null
  const lines = useMemo(
    () => (current ? duelChat(current, state.agents.decisions.duels, { limits }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, state, version, limits],
  )
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lines])
  const onScroll = () => {
    const el = list.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }
  const turns = turnStarts(lines)
  return (
    <Panel className="dc" title={t.chat.title} sub={t.chat.sub}>
      {duels.length === 0 || !current ? (
        <Empty>{t.chat.empty}</Empty>
      ) : (
        <>
          <Picker duels={duels} current={current} />
          <div ref={list} className="dc-scroll" role="log" aria-live="polite" aria-relevant="additions" onScroll={onScroll} tabIndex={0}>
            <ol>
              {lines.map((l, i) => {
                const tick = tickOf(l)
                const starts = turns.has(i)
                const { who, name } = lineWho(l, current.rival ?? '?', t)
                return (
                  <li key={`${current.id}:${i}`} className={`dc-line${starts ? ' dc-turn' : ''}`} data-who={who} data-kind={l.kind}>
                    {name && <span className="dc-who">{name}</span>}
                    <p className="dc-said">
                      <Said l={l} d={current} t={t} />
                    </p>
                    {starts && <span className="dc-tick">{tick}</span>}
                  </li>
                )
              })}
            </ol>
          </div>
        </>
      )}
    </Panel>
  )
}
