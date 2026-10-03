/** The small pieces every game screen shares: a panel, an empty state, badges, a segmented control, event links. */
import type { ReactNode } from 'react'
import { fmtP, setOf } from '../game.ts'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { eventLabel } from '../views/agent.ts'
import { sparkEnd, sparkPath } from '../views/market.ts'

export function Panel({ title, sub, actions, children, className }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`gm-panel material${className ? ` ${className}` : ''}`}>
      <header className="gm-panel-head">
        <h2>
          {title}
          {sub != null && <span className="gm-sub">{sub}</span>}
        </h2>
        {actions && <div className="gm-actions">{actions}</div>}
      </header>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="gm-empty">{children}</p>
}

export type Tone = 'neutral' | 'us' | 'them' | 'good' | 'bad' | 'warn'

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className="gm-badge" data-tone={tone} title={title}>
      {children}
    </span>
  )
}

/** A segmented control: one choice of a few, each a pressed/unpressed button. */
export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="gm-seg" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** A link to the inspector: the event's id, or the given label. */
export function EventLink({ id, children }: { id: number | null | undefined; children?: ReactNode }) {
  const store = useGame()
  const t = useGameStrings()
  if (id == null) return <span className="gm-mono gm-muted">—</span>
  return (
    <button type="button" className="gm-eid" aria-pressed={store.selected === id} onClick={() => store.select(id)} title={t.inspector.inspect}>
      {/* The server's own events count down from -1: no number to show, the button still opens the inspector. */}
      {children ?? eventLabel(id) ?? '↗'}
    </button>
  )
}

/** A card code with its barrio's colour, and its name when there is one. */
export function CardRef({ code, name }: { code: string; name?: string }) {
  const set = setOf(code)
  return (
    <span className="gm-card" title={set ? `${set.name} · ${name ?? code}` : (name ?? code)}>
      <i className="gm-swatch" style={{ background: set?.color ?? 'var(--text-3)' }} />
      <b>{code}</b>
      {name && name !== code && <span className="gm-card-name">{name}</span>}
    </span>
  )
}

export function Sparkline({ values, w = 64, h = 18 }: { values: number[]; w?: number; h?: number }) {
  const d = sparkPath(values, w, h, 3)
  const end = sparkEnd(values, w, h, 3)
  if (!d || !end) return <span className="gm-muted">—</span>
  const label = `${values.length} · ${fmtP(Math.min(...values))} – ${fmtP(Math.max(...values))} · ${fmtP(values.at(-1))}`
  return (
    <svg className="gm-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label}>
      <title>{label}</title>
      <path d={d} />
      <circle cx={end.x} cy={end.y} r={2.5} />
    </svg>
  )
}

export function RefChip({ topic }: { topic: string }) {
  const set = setOf(topic)
  return (
    <span className="gm-ref" style={set ? { borderLeftColor: set.color } : undefined} title={set?.name ?? topic}>
      {topic}
    </span>
  )
}

export function Expiry({ left }: { left: number | null }) {
  const t = useGameStrings()
  if (left == null) return null
  if (left < 0) return <Badge tone="bad" title={t.badge.expiredTitle}>{t.badge.expired}</Badge>
  return (
    <Badge tone={left <= 1 ? 'warn' : 'neutral'} title={t.badge.expiresTitle}>
      ⏱ {left}t
    </Badge>
  )
}

export function Injection({ on }: { on: boolean }) {
  const t = useGameStrings()
  if (!on) return null
  return (
    <Badge tone="warn" title={t.badge.injectionTitle}>
      ⚠ {t.badge.injection}
    </Badge>
  )
}
