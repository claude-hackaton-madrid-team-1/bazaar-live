/**
 * The wire type of GET /api/injections: the prompt-injection attempts our agents recorded (bazaar's
 * `injection_attempts` table, read through db/injections.sql's view), newest first.
 *
 * `raw` is a counterparty's exact words: HOSTILE by definition. The page shows it as plain text only, and no
 * voice ever reads it (see `looksLikeInjection`, the TTS proxy and src/show/real.ts).
 */

export const INJECTION_SOURCES = ['feed', 'team_thread', 'duel', 'dealer_thread', 'offer_text'] as const
export type InjectionSource = (typeof INJECTION_SOURCES)[number]

/** attempt: a strong shape (instruction_override, role_play, role_tag, asset_grab, odd_unicode); weak: code, url or money words only. */
export type InjectionSeverity = 'attempt' | 'weak'

export interface InjectionAttempt {
  readonly id: number
  readonly tick: number | null
  readonly source: InjectionSource
  /** A team (t07), a dealer (abuela) or a venue (v05); null when the recorder did not know. */
  readonly from: string | null
  /** The text was addressed to us (a thread or duel of ours), not only seen in the public feed. */
  readonly toUs: boolean
  readonly tags: readonly string[]
  readonly severity: InjectionSeverity
  /** The counterparty's exact text, at most RAW_MAX characters. Hostile: plain text only. */
  readonly raw: string
  /** What our agent did, e.g. "ignored: structured offer only". */
  readonly ourResponse: string
  /** How anyone can verify it, e.g. "GET /api/threads/412 message 2210". */
  readonly proof: string
  /** ISO time the recorder saw it. */
  readonly seenAt: string | null
}

export interface InjectionsSnapshot {
  /** ISO time of the last successful read, or null before the first. */
  readonly at: string | null
  /** False while the view is missing (db/injections.sql not applied, or bazaar's table not created yet). */
  readonly ready: boolean
  /** Total rows per severity in the real world (the list itself is capped). */
  readonly counts: { readonly attempt: number; readonly weak: number }
  readonly rows: readonly InjectionAttempt[]
}

export type InjectionsResponse = ({ readonly enabled: true } & InjectionsSnapshot) | { readonly enabled: false }

export const RAW_MAX = 2000

export const EMPTY_INJECTIONS: InjectionsSnapshot = { at: null, ready: false, counts: { attempt: 0, weak: 0 }, rows: [] }

/**
 * Code points a reader cannot see, or that change how the text around them looks: C0/C1 controls (a newline and a
 * tab excepted), the soft hyphen, the combining grapheme joiner, the Arabic letter mark, Hangul and halfwidth
 * fillers, Khmer inherent vowels, Mongolian selectors, zero-width spaces and joiners, bidi marks, embeddings,
 * overrides and isolates, word joiners and invisible operators, the braille blank, variation selectors, the BOM,
 * interlinear annotations, the tag block and the supplementary variation selectors. Ranges, inclusive.
 */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5],
  [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164], [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
]

/** One character (a code point) that hides: see HIDDEN_RANGES. */
export function isHiddenChar(ch: string): boolean {
  const cp = ch.codePointAt(0)
  return cp !== undefined && HIDDEN_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
}

/**
 * A text no voice should read: the shapes of a prompt injection (an instruction override, a role tag or role play,
 * code or markup, a url, hidden or control characters). Deliberately broad: a false positive only turns a voiced
 * quote into a caption. Used by the TTS proxy (a quote it vouches for) and by the show (a quote it would voice).
 */
export function looksLikeInjection(text: string): boolean {
  // hidden and control characters (zero-width, bidi overrides, tags, fillers), anything a listener cannot see
  if (Array.from(text).some(isHiddenChar)) return true
  const plain = text.normalize('NFKC').toLowerCase()
  if (/[<>{}[\]`|\\]/.test(plain)) return true
  if (/https?:|www\.|\.(com|io|ai|net|org)\b/.test(plain)) return true
  return INSTRUCTION.some((re) => re.test(plain))
}

const INSTRUCTION: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instruction|instrucci|prompt|rule|regla|previous|anterior|above|system)/,
  /\b(ignora|olvida)\b.{0,40}\b(instrucci|regla|anterior|prompt|sistema)/,
  /\b(system|assistant|developer|user)\s*:/,
  /\b(sistema|asistente)\s*:/,
  /\byou are (now|an?|the)\b|\bact as\b|\bpretend\b|\bahora eres\b|\bactúa como\b/,
  /\b(new|nuevas?) (instructions?|instrucciones|rules|reglas)\b/,
  /\b(jailbreak|prompt injection|do anything now)\b/,
]
