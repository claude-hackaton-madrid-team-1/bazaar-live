/**
 * `?mock=1`: plays src/mock/fixtures.json as if the agents were live, looping forever. Every event
 * goes through the same parser and allow-list as a real WS message. Each loop shifts ids and ticks so
 * the show sees a fresh afternoon, not duplicates.
 */
import type { AgentHealth, AgentId, AgentState, ShowEvent } from '../model/events'
import { parseEnvelope, parseHealth, parseState } from '../model/sanitize'
import fixtures from './fixtures.json'

interface Step {
  readonly at: number
  readonly event: Record<string, unknown>
}

interface Fixtures {
  readonly loopMs: number
  readonly ticksPerLoop: number
  readonly health: Readonly<Record<AgentId, unknown>>
  readonly state: Readonly<Record<AgentId, unknown>>
  readonly steps: readonly Step[]
}

const SCENE = fixtures as unknown as Fixtures
const ID_SHIFT = 1000

export interface MockOptions {
  readonly speed: number
  readonly mode: 'live' | 'dry'
  readonly onEvent: (event: ShowEvent, replay: boolean) => void
  readonly onTick?: (tick: number) => void
}

/** One fixture envelope as loop `n` of the scene, in the requested mode. */
export function shiftEnvelope(raw: Record<string, unknown>, loop: number, mode: 'live' | 'dry'): Record<string, unknown> {
  const payload = (raw.payload ?? {}) as Record<string, unknown>
  const tick = typeof raw.tick === 'number' ? raw.tick + loop * SCENE.ticksPerLoop : raw.tick
  const shifted: Record<string, unknown> = { ...payload }
  if (typeof payload.tick === 'number') shifted.tick = tick
  if (raw.type === 'agent.tick') shifted.mode = mode
  if (raw.type === 'agent.decision') shifted.dry_run = mode === 'dry'
  return { ...raw, id: (raw.id as number) - loop * ID_SHIFT, tick, payload: shifted }
}

export class MockPlayer {
  private readonly opts: MockOptions
  private timer: ReturnType<typeof setTimeout> | null = null
  private index = 0
  private loop = 0
  private loopStart = 0
  private tick: number

  constructor(options: MockOptions) {
    this.opts = options
    this.tick = parseHealth(SCENE.health.taker)?.tick ?? 0
  }

  start(): void {
    this.stop()
    this.loopStart = Date.now()
    this.schedule()
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  health(agent: AgentId): AgentHealth | null {
    const base = parseHealth(SCENE.health[agent])
    return base ? { ...base, mode: this.opts.mode, tick: this.tick, serverTick: this.tick } : null
  }

  state(agent: AgentId): AgentState | null {
    const base = parseState(SCENE.state[agent])
    return base ? { ...base, mode: this.opts.mode, tick: this.tick } : null
  }

  private schedule(): void {
    const step = SCENE.steps[this.index]
    if (!step) {
      this.index = 0
      this.loop += 1
      this.loopStart += SCENE.loopMs / this.opts.speed
      this.schedule()
      return
    }
    const due = this.loopStart + step.at / this.opts.speed
    this.timer = setTimeout(() => this.play(step), Math.max(0, due - Date.now()))
  }

  private play(step: Step): void {
    const event = parseEnvelope(shiftEnvelope(step.event, this.loop, this.opts.mode))
    if (event) {
      if (event.type === 'agent.tick' && event.tick !== null && event.tick !== this.tick) {
        this.tick = event.tick
        this.opts.onTick?.(event.tick)
      }
      this.opts.onEvent(event, false)
    }
    this.index += 1
    this.schedule()
  }
}

export const MOCK_STEPS = SCENE.steps
