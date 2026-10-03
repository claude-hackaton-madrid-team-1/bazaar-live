/**
 * Expressive tags in the show's dialogue, and how each TTS provider receives them.
 *
 * Lines are written once with square-bracket tags (`[laughs] Venga!`). ElevenLabs v4 reads those
 * tags as they are (its docs list `[laughs]`, `[whispers]`, `[sarcastic]`, `[sighs]`...). Gemini 3.8
 * TTS reads the text verbatim, so a sustained delivery goes to its `speech_metadata.style` field and a
 * momentary sound goes inline in angle brackets (`<laugh>`). Web Speech cannot act: tags are stripped.
 *
 * Imported by the browser bundle and by the Node proxy (server/), so it has no imports of its own.
 */

export const SPEAKERS = ['buyer', 'seller', 'abuela', 'chato', 'narrator'] as const
export type Speaker = (typeof SPEAKERS)[number]

export function isSpeaker(value: unknown): value is Speaker {
  return typeof value === 'string' && (SPEAKERS as readonly string[]).includes(value)
}

/** A sound at one point of the line: Gemini's inline vocal-burst tag for each. */
const MOMENTARY: Readonly<Record<string, string>> = {
  laughs: '<laugh>',
  chuckles: '<chuckle>',
  gasps: '<gasp>',
  sighs: '<sigh>',
  snorts: '<snort>',
}

/** A delivery that lasts the whole line: Gemini's `style` words for each. */
const SUSTAINED: Readonly<Record<string, string>> = {
  sarcastic: 'sarcastic',
  whispers: 'whispering',
  excited: 'excited',
  mischievously: 'mischievous',
  curious: 'curious',
}

export const KNOWN_TAGS: readonly string[] = [...Object.keys(MOMENTARY), ...Object.keys(SUSTAINED)]

const TAG = /\[([a-z][a-z ]{0,30})\]/gi
const SPACES = /\s{2,}/g

/** The words alone, for captions read aloud by Web Speech. */
export function stripTags(text: string): string {
  return text.replace(TAG, ' ').replace(SPACES, ' ').trim()
}

const ANGLE_TAG = /<\/?[a-z][a-z ]{0,30}>/gi
const STRAY_BRACKETS = /[[\]<>]/g

/**
 * What a voice that cannot act may read: no `[tag]`, no `<laugh>`, no stray bracket. Whatever a tag
 * said goes to deliveryOf() instead.
 */
export function speakable(text: string): string {
  return stripTags(text).replace(ANGLE_TAG, ' ').replace(STRAY_BRACKETS, ' ').replace(SPACES, ' ').trim()
}

/** How a line is delivered, as multipliers over a character's own rate, pitch and volume. */
export interface Delivery {
  readonly rate: number
  readonly pitch: number
  readonly volume: number
}

const NEUTRAL: Delivery = { rate: 1, pitch: 1, volume: 1 }

/** What a tag asks of a voice that cannot act: a little speed, pitch or volume, never words. */
const DELIVERY: Readonly<Record<string, Partial<Delivery>>> = {
  excited: { rate: 1.1, pitch: 1.1 },
  laughs: { rate: 1.05, pitch: 1.08 },
  chuckles: { rate: 1.02, pitch: 1.04 },
  gasps: { rate: 1.08, pitch: 1.12 },
  sarcastic: { rate: 0.94, pitch: 0.92 },
  sighs: { rate: 0.88, pitch: 0.94, volume: 0.9 },
  whispers: { rate: 0.94, pitch: 0.98, volume: 0.55 },
  snorts: { rate: 1, pitch: 0.88 },
  mischievously: { rate: 0.97, pitch: 1.06 },
  curious: { rate: 1, pitch: 1.07 },
}

const RATE_RANGE = [0.6, 1.6] as const
const PITCH_RANGE = [0.4, 1.8] as const
const clamp = (n: number, [lo, hi]: readonly [number, number]): number => Math.min(hi, Math.max(lo, n))

/** The delivery the tags of a line ask for (the strongest volume cut wins; rate and pitch combine). */
export function deliveryOf(text: string): Delivery {
  return tagsOf(text).reduce<Delivery>((acc, tag) => {
    const d = DELIVERY[tag]
    if (!d) return acc
    return {
      rate: clamp(acc.rate * (d.rate ?? 1), RATE_RANGE),
      pitch: clamp(acc.pitch * (d.pitch ?? 1), PITCH_RANGE),
      volume: Math.min(acc.volume, d.volume ?? 1),
    }
  }, NEUTRAL)
}

/** The tags in a line, lower-cased, in order. */
export function tagsOf(text: string): string[] {
  return [...text.matchAll(TAG)].map((m) => (m[1] ?? '').toLowerCase())
}

/** ElevenLabs v4: square-bracket audio tags pass through; whitespace is tidied. */
export function forElevenLabs(text: string): string {
  return text.replace(SPACES, ' ').trim()
}

export interface GeminiLine {
  text: string
  /** Sustained delivery for `speech_metadata.style`, or '' when the line has none. */
  style: string
}

/** Gemini 3.8 TTS: momentary tags inline as `<laugh>`, sustained ones moved to `style`. */
export function forGemini(text: string): GeminiLine {
  const styles: string[] = []
  const spoken = text.replace(TAG, (_match, raw: string) => {
    const tag = raw.toLowerCase()
    const momentary = MOMENTARY[tag]
    if (momentary) return momentary
    const sustained = SUSTAINED[tag] ?? tag
    if (!styles.includes(sustained)) styles.push(sustained)
    return ' '
  })
  return { text: spoken.replace(SPACES, ' ').trim(), style: styles.join(', ') }
}
