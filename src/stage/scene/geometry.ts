import { rng } from '../rng'

export interface Skyline {
  /** The silhouettes, one path. */
  readonly body: string
  /** Lit windows that stay on. */
  readonly lit: string
  /** Lit windows that flicker a little. */
  readonly twinkle: string
}

/** A row of rooftops (flat parapets, gables, slate spires, domes) standing on `baseY`, as three SVG paths. */
export function skyline(seed: number, baseY: number, hMin: number, hMax: number, width: number): Skyline {
  const r = rng(seed)
  let body = ''
  let lit = ''
  let twinkle = ''
  let x = -40
  while (x < width + 40) {
    const w = 70 + r() * 90
    const top = baseY - (hMin + r() * (hMax - hMin))
    const kind = r()
    body += `M${x.toFixed(0)} ${baseY}V${top.toFixed(0)}`
    if (kind < 0.25) body += `L${(x + w / 2).toFixed(0)} ${(top - w * 0.42).toFixed(0)}L${(x + w).toFixed(0)} ${top.toFixed(0)}`
    else if (kind < 0.4) body += `H${(x + w * 0.35).toFixed(0)}L${(x + w / 2).toFixed(0)} ${(top - w * 1.1).toFixed(0)}L${(x + w * 0.65).toFixed(0)} ${top.toFixed(0)}H${(x + w).toFixed(0)}`
    else if (kind < 0.5) body += `Q${(x + w / 2).toFixed(0)} ${(top - w * 0.8).toFixed(0)} ${(x + w).toFixed(0)} ${top.toFixed(0)}`
    else body += `H${(x + w).toFixed(0)}`
    body += `V${baseY}Z`
    const cols = Math.max(1, Math.floor(w / 28))
    const rows = Math.max(1, Math.floor((baseY - top) / 38))
    for (let c = 0; c < cols; c++) {
      for (let row = 0; row < rows; row++) {
        const roll = r()
        if (roll > 0.4) continue
        const wx = x + 10 + c * ((w - 20) / cols)
        const wy = top + 14 + row * 38
        const cell = `M${wx.toFixed(0)} ${wy.toFixed(0)}h8v13h-8z`
        if (roll < 0.14) twinkle += cell
        else lit += cell
      }
    }
    x += w - 4
  }
  return { body, lit, twinkle }
}

export interface Cobble {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly shade: number
}

/** Cobblestones in perspective: rows grow taller and stones wider towards the viewer. */
export function cobbles(seed: number, topY: number, bottomY: number, width: number): readonly Cobble[] {
  const r = rng(seed)
  const out: Cobble[] = []
  let y = topY
  let h = 7
  let row = 0
  while (y < bottomY) {
    const w = h * 2.6
    let x = -(row % 2) * (w / 2) - r() * 10
    while (x < width) {
      out.push({ x, y, w: w - 2, h: h - 1.5, shade: r() })
      x += w * (0.85 + r() * 0.3)
    }
    y += h
    h *= 1.13
    row++
  }
  return out
}

export interface Pennant {
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly tone: number
}

export interface Bunting {
  /** The rope, as one SVG path (a sagging curve). */
  readonly rope: string
  readonly pennants: readonly Pennant[]
}

/** A rope sagging between (x0, y0) and (x1, y1) with `count` pennants hanging along it. */
export function bunting(x0: number, y0: number, x1: number, y1: number, sag: number, count: number): Bunting {
  const cx = (x0 + x1) / 2
  const cy = Math.max(y0, y1) + sag * 2
  const at = (t: number) => {
    const u = 1 - t
    return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 }
  }
  const pennants = Array.from({ length: count }, (_, i): Pennant => {
    const t = (i + 0.5) / count
    const here = at(t)
    const next = at(Math.min(1, t + 0.01))
    return { x: here.x, y: here.y, angle: (Math.atan2(next.y - here.y, next.x - here.x) * 180) / Math.PI, tone: i % 4 }
  })
  return { rope: `M${x0} ${y0}Q${cx} ${cy} ${x1} ${y1}`, pennants }
}

export interface Star {
  readonly x: number
  readonly y: number
  readonly r: number
  readonly twinkle: boolean
  readonly delay: number
}

/** Stars in the upper sky; a few twinkle. */
export function stars(seed: number, count: number, width: number, maxY: number): readonly Star[] {
  const r = rng(seed)
  return Array.from({ length: count }, (_, i) => ({
    x: r() * width,
    y: r() * maxY,
    r: 0.7 + r() * 1.5,
    twinkle: i % 4 === 0,
    delay: r() * 4,
  }))
}

/** Cobblestones as three SVG paths by shade (dark, mid, light): one node each instead of hundreds. */
export function cobblePaths(seed: number, topY: number, bottomY: number, width: number): readonly [string, string, string] {
  const buckets: [string, string, string] = ['', '', '']
  for (const c of cobbles(seed, topY, bottomY, width)) {
    const bucket = c.shade < 0.34 ? 0 : c.shade < 0.7 ? 1 : 2
    const rx = Math.min(c.w, c.h) * 0.28
    buckets[bucket] += `M${(c.x + rx).toFixed(1)} ${c.y.toFixed(1)}h${(c.w - 2 * rx).toFixed(1)}q${rx.toFixed(1)} 0 ${rx.toFixed(1)} ${rx.toFixed(1)}v${(c.h - 2 * rx).toFixed(1)}q0 ${rx.toFixed(1)} -${rx.toFixed(1)} ${rx.toFixed(1)}h-${(c.w - 2 * rx).toFixed(1)}q-${rx.toFixed(1)} 0 -${rx.toFixed(1)} -${rx.toFixed(1)}v-${(c.h - 2 * rx).toFixed(1)}q0 -${rx.toFixed(1)} ${rx.toFixed(1)} -${rx.toFixed(1)}z`
  }
  return buckets
}

/** A band from `x0` to `x1`, `height` tall at the top, with a scalloped lower edge of `depth` and period `step`. */
export function scallopedBand(x0: number, x1: number, height: number, depth: number, step: number): string {
  const count = Math.max(1, Math.round((x1 - x0) / step))
  const w = (x1 - x0) / count
  let d = `M${x0} 0H${x1}V${height}`
  for (let i = 0; i < count; i++) d += `q${-w / 2} ${depth} ${-w} 0`
  return `${d}Z`
}
