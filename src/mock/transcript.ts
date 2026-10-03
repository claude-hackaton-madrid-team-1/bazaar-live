/**
 * `?mock=1`: a synthetic transcript, so the real-conversation path shows without a database. Every
 * name, line and price here is made up (nothing is read from the game); the items go through the same
 * parser as a server batch. The scene mixes a Spanish and an English dealer quote on purpose: whichever
 * language the show is in, one of them is shown as text while a line in the selected language is spoken.
 */
import { parseItem } from '../../shared/transcript-parse.ts'
import { EMPTY_ITEM, type TranscriptItem } from '../../shared/transcript.ts'

interface Step {
  readonly at: number
  readonly item: Omit<TranscriptItem, 'seq'>
}

const base = EMPTY_ITEM

export const MOCK_LOOP_MS = 60_000

const OFFER = (by: 'us' | 'them', verb: 'bid' | 'ask', price: number, final = false) => ({ by, verb, price, item: 'LAV-08', final }) as const

export const MOCK_TRANSCRIPT: readonly Step[] = [
  { at: 1500, item: { ...base, id: 'o1', kind: 'thread_opened', who: 'us', counterpart: 'abuela', thread: 901, item: 'LAV-08' } },
  { at: 5000, item: { ...base, id: 'm1', kind: 'thread_line', who: 'us', counterpart: 'abuela', thread: 901, item: 'LAV-08', offer: OFFER('us', 'bid', 24) } },
  { at: 11_000, item: { ...base, id: 'm2', kind: 'thread_line', who: 'them', counterpart: 'abuela', thread: 901, item: 'LAV-08', text: 'Venga, mi niño. Te lo dejo en 31 primas, ni una menos.', offer: OFFER('them', 'ask', 31) } },
  { at: 18_000, item: { ...base, id: 'm3', kind: 'thread_line', who: 'us', counterpart: 'abuela', thread: 901, item: 'LAV-08', offer: OFFER('us', 'bid', 28) } },
  { at: 24_000, item: { ...base, id: 'm4', kind: 'thread_line', who: 'them', counterpart: 'abuela', thread: 901, item: 'LAV-08', text: "Your abuela would've moved more than one. I match what you move, nothing extra.", offer: OFFER('them', 'ask', 29, true) } },
  { at: 31_000, item: { ...base, id: 's1', kind: 'settlement', counterpart: 'abuela', item: 'LAV-08', price: 29 } },
  {
    at: 46_000,
    item: {
      ...base, id: 'dc1', kind: 'duel_replay', counterpart: 'Rival Noche', item: 'MAL-02', role: 'seller', status: 'deal', price: 55,
      lines: [
        { n: 1, speaker: 'them', tick: null, price: 40, days: 3, text: 'Cuarenta y no se hable más, que tengo prisa.' },
        { n: 2, speaker: 'us', tick: null, price: 70, days: 3, text: null },
        { n: 3, speaker: 'them', tick: null, price: 50, days: 2, text: 'Fifty, and you throw in the delivery.' },
        { n: 4, speaker: 'us', tick: null, price: 55, days: 2, text: null },
      ],
    },
  },
]

export interface MockTranscriptOptions {
  readonly speed: number
  readonly onItems: (items: readonly TranscriptItem[], replay: boolean) => void
}

export class MockTranscriptPlayer {
  private timer: ReturnType<typeof setTimeout> | null = null
  private index = 0
  private loop = 0
  private loopStart = 0
  private seq = 0
  private readonly o: MockTranscriptOptions

  constructor(options: MockTranscriptOptions) {
    this.o = options
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

  private schedule(): void {
    const step = MOCK_TRANSCRIPT[this.index]
    if (!step) {
      this.index = 0
      this.loop += 1
      this.loopStart += MOCK_LOOP_MS / this.o.speed
      this.schedule()
      return
    }
    this.timer = setTimeout(() => this.play(step), Math.max(0, this.loopStart + step.at / this.o.speed - Date.now()))
  }

  private play(step: Step): void {
    this.seq += 1
    // Each loop is a fresh afternoon: ids carry the loop, so the page's dedupe lets it play again.
    const item = parseItem({ ...step.item, id: `${step.item.id}~${this.loop}`, seq: this.seq })
    if (item) this.o.onItems([item], false)
    this.index += 1
    this.schedule()
  }
}
