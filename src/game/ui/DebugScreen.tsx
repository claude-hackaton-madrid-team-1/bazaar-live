import { useMemo, useState } from 'react'
import { readConfig } from '../../config'
import { InjectionsPanel } from '../../ui/InjectionsPanel'
import { useGameStrings } from '../strings.ts'
import { useGame } from '../store.ts'
import { debugRows, FAMILIES, streamStats, type DebugRow, type Family, type Source, type StreamStats as Stats } from '../views/debug.ts'
import { Badge, Empty, Panel, Seg } from './bits.tsx'

type FilterState = { source: Source; families: Family[]; query: string; unknownOnly: boolean }

const LIMIT = 300

function StreamStats({ stats }: { stats: Stats }) {
  const t = useGameStrings()
  const peak = Math.max(1, ...stats.perTick.map((p) => p.count))
  const total = stats.perTick.reduce((n, p) => n + p.count, 0)
  const avg = stats.perTick.length ? total / stats.perTick.length : 0
  return (
    <dl className="gm-dstats">
      <div>
        <dt className="eyebrow">{t.debug.stats.window}</dt>
        <dd>{stats.window}</dd>
      </div>
      <div>
        <dt className="eyebrow">{t.debug.stats.mine}</dt>
        <dd>{stats.mine}</dd>
      </div>
      <div>
        <dt className="eyebrow">{t.debug.stats.last}</dt>
        <dd>{stats.lastId == null ? '—' : `#${stats.lastId}`}</dd>
      </div>
      <div>
        <dt className="eyebrow">{t.debug.stats.perTick}</dt>
        <dd title={stats.perTick.map((p) => `t${p.tick}: ${p.count}`).join('\n')}>
          <span className="gm-bars-mini" aria-hidden="true">
            {stats.perTick.map((p) => (
              <i key={p.tick} style={{ height: `${Math.round((p.count / peak) * 100)}%` }} />
            ))}
          </span>
          {t.debug.perTick(avg.toFixed(1), stats.perTick.at(-1)?.count ?? 0)}
        </dd>
      </div>
      <div>
        <dt className="eyebrow">{t.debug.stats.unknown}</dt>
        <dd className={stats.unknown ? 'gm-warn' : undefined}>{stats.unknown}</dd>
      </div>
      <div className="gm-dstats-types">
        <dt className="eyebrow">{t.debug.stats.types}</dt>
        {stats.byType.map(([type, n]) => (
          <dd key={type}>
            {type} {n}
          </dd>
        ))}
      </div>
    </dl>
  )
}

function Filters({ value, counts, onChange }: { value: FilterState; counts: Partial<Record<Family, number>>; onChange: (next: FilterState) => void }) {
  const t = useGameStrings()
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch })
  const toggle = (f: Family) => set({ families: value.families.includes(f) ? value.families.filter((x) => x !== f) : [...value.families, f] })
  return (
    <div className="gm-filters">
      <Seg
        label={t.debug.source}
        value={value.source}
        options={[
          ['ours', t.debug.sources.ours],
          ['market', t.debug.sources.market],
          ['all', t.debug.sources.all],
        ]}
        onChange={(source) => set({ source })}
      />
      <div className="gm-chips" role="group" aria-label={t.debug.family}>
        {FAMILIES.map((f) => (
          <button key={f} type="button" className="gm-chip" data-family={f} aria-pressed={value.families.includes(f)} onClick={() => toggle(f)}>
            {f}
            <b>{counts[f] ?? 0}</b>
          </button>
        ))}
        {value.families.length > 0 && (
          <button type="button" className="gm-btn" onClick={() => set({ families: [] })}>
            {t.debug.clear}
          </button>
        )}
      </div>
      <input type="search" className="gm-search" placeholder={t.debug.search} aria-label={t.debug.search} value={value.query} onChange={(e) => set({ query: e.target.value })} />
      <label className="gm-toggle">
        <input type="checkbox" checked={value.unknownOnly} onChange={(e) => set({ unknownOnly: e.target.checked })} />
        {t.debug.unknownOnly}
      </label>
    </div>
  )
}

function EventTable({ rows, selected, onSelect }: { rows: DebugRow[]; selected: number | null; onSelect: (id: number) => void }) {
  const t = useGameStrings()
  if (!rows.length) return <Empty>{t.debug.noEvents}</Empty>
  return (
    <div className="gm-scroll gm-scroll-tall">
      <table className="gm-table gm-events">
        <thead>
          <tr>
            {t.debug.head.map((h, i) => (
              <th key={h} className={i < 2 ? 'gm-r' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-ours={r.ours || undefined}
              aria-selected={selected === r.id || undefined}
              tabIndex={0}
              onClick={() => onSelect(r.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(r.id)
                }
              }}
            >
              <td className="gm-r">#{r.id}</td>
              <td className="gm-r">{r.tick ?? '—'}</td>
              <td>
                <span className="gm-type" data-family={r.family} title={r.known ? r.family : t.debug.notKnown}>
                  {r.type}
                </span>
              </td>
              <td>{r.actor || <span className="gm-muted">—</span>}</td>
              <td className="gm-muted">{r.scope || '—'}</td>
              <td>{r.ours ? <Badge tone="us">{t.badge.ours}</Badge> : <Badge>{t.badge.market}</Badge>}</td>
              <td className="gm-summary" title={r.summary}>
                {r.summary}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DebugScreen() {
  const store = useGame()
  const t = useGameStrings()
  const { state, version } = store
  const [filters, setFilters] = useState<FilterState>({ source: 'all', families: [], query: '', unknownOnly: false })
  // the state is mutated in place: the version is what changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => debugRows(state, { ...filters, limit: LIMIT }), [state, version, filters])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stats = useMemo(() => streamStats(state), [state, version])
  const shown = result.rows.length < result.matched ? t.debug.of(result.rows.length, result.matched) : `${result.matched}`
  return (
    <>
      <Panel title={t.debug.stream} sub={t.debug.sub(shown, result.scanned, filters.source === 'ours')}>
        <StreamStats stats={stats} />
        <Filters value={filters} counts={result.families} onChange={setFilters} />
        <EventTable rows={result.rows} selected={store.selected} onSelect={(id) => store.select(id)} />
      </Panel>
      <InjectionsPanel mock={readConfig(window.location.search).mock} />
    </>
  )
}
