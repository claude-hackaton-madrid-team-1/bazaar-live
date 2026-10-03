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
