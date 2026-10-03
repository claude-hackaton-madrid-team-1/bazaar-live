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

export const SPEAKERS = ['buyer', 'seller', 'abuela', 'chato', 'pilar', 'guest1', 'guest2', 'guest3', 'narrator'] as const
export type Speaker = (typeof SPEAKERS)[number]

/** The dealers we know by id: each has its own voice and caption. */
export const KNOWN_DEALERS = ['abuela', 'chato', 'pilar'] as const
export type KnownDealer = (typeof KNOWN_DEALERS)[number]

/**
 * The voices kept for dealers that arrive later (L4, L5): a dealer we do not know by id speaks with one
 * of them, picked by a hash of its id, so it is never the narrator's voice nor a known dealer's.
 */
export const GUEST_SPEAKERS = ['guest1', 'guest2', 'guest3'] as const
export type GuestSpeaker = (typeof GUEST_SPEAKERS)[number]

const TEAM_ID = /^t\d{1,3}$/i
const DEALER_HANDLE = /^[a-z][a-z0-9_-]{0,39}$/

/** FNV-1a over the id: the same dealer always gets the same guest voice, on every page and the server. */
function hashOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The guest voice a dealer id we do not know gets. */
export function guestSpeaker(id: string): GuestSpeaker {
  return GUEST_SPEAKERS[hashOf(id.toLowerCase()) % GUEST_SPEAKERS.length] ?? 'guest1'
}

/** A known dealer's id from a handle or a name (`chato`, `Abuela Carmen`, `Doña Pilar`), or null. */
export function knownDealer(counterpart: string | null | undefined): KnownDealer | null {
  const id = (counterpart ?? '').toLowerCase()
  if (id.includes('abuela') || id.includes('carmen')) return 'abuela'
  if (id.includes('chato')) return 'chato'
  if (id.includes('pilar')) return 'pilar'
  return null
}

/**
 * Who speaks a dealer thread's words: a known dealer, else a guest voice for any other dealer handle;
 * null for a team (`t05`) or anything that is not a handle (the narrator reads those).
 */
export function dealerSpeaker(counterpart: string | null | undefined): Speaker | null {
  const known = knownDealer(counterpart)
  if (known) return known
  const id = (counterpart ?? '').trim().toLowerCase()
  if (!DEALER_HANDLE.test(id) || TEAM_ID.test(id)) return null
  return guestSpeaker(id)
}

export const isGuest = (speaker: Speaker): speaker is GuestSpeaker => (GUEST_SPEAKERS as readonly string[]).includes(speaker)

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
