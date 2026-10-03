/**
 * The wire type of GET /api/injections: the prompt-injection attempts our agents recorded (bazaar's
 * `injection_attempts` table, read through db/injections.sql's view), newest first; and the text rules shared by the
 * server and the page: what hides in a text (`revealHidden`) and what no voice may read (`looksLikeInjection`).
 *
 * `raw` is a counterparty's exact words: HOSTILE by definition. The page shows it as plain text only, and no
 * voice ever reads it (server/transcript/rows.ts mutes such a quote at the source, the TTS proxy and
 * src/show/real.ts refuse it again).
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
  /** What our agent did, as the view maps it: a verb from a closed list, then a reason without digits. */
  readonly ourResponse: string
  /** How anyone can verify it, e.g. "GET /api/threads/412 message 2210". */
  readonly proof: string
  /** ISO time the recorder saw it. */
  readonly seenAt: string | null
}

export interface InjectionsSnapshot {
  /** ISO time of the read that produced these rows (an unchanged read keeps it), or null before the first. */
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

/** What our agent did: the verbs db/injections.sql lets through (anything else reads "recorded"). */
export const RESPONSE_VERBS = ['ignored', 'refused', 'rejected', 'blocked', 'walked', 'held', 'declined', 'flagged', 'recorded', 'logged', 'countered', 'accepted', 'closed', 'kept'] as const

/** `<verb>` or `<verb>: <reason>`, the reason without digits (a price or a limit never leaves): the view's own shape. */
const RESPONSE = new RegExp(`^(${RESPONSE_VERBS.join('|')})(: [A-Za-z][A-Za-z ,./()'_-]{0,100})?$`)

/** Our response as the panel may show it, or "recorded" when it is not in the closed shape (the server's second wall). */
export const responseOf = (raw: unknown): string => (typeof raw === 'string' && RESPONSE.test(raw) ? raw : 'recorded')

// ---------------------------------------------------------------------------------------------------------------
// What hides in a text
// ---------------------------------------------------------------------------------------------------------------

/**
 * Characters a reader cannot see, or that change how the text around them looks: controls (a newline and a tab
 * excepted), format characters (zero-width spaces and joiners, bidi marks, embeddings, overrides and isolates, the tag
 * block, invisible operators), private use and lone surrogates, line and paragraph separators, every
 * default-ignorable code point (Hangul and halfwidth fillers, the combining grapheme joiner, variation selectors,
 * unassigned ignorables) and the braille blank.
 */
const HIDES = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u
const BRAILLE_BLANK = String.fromCodePoint(0x2800)
const ZWJ = String.fromCodePoint(0x200d)
const VS16 = String.fromCodePoint(0xfe0f)
const MARK = /\p{M}/u
const EMOJI = /\p{Emoji}/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u
const SKIN_TONE = /\p{Emoji_Modifier}/u

/** Combining marks kept on one character; more is a stack drawn far outside the line ("zalgo"), shown as one marker. */
export const MAX_MARKS = 2

/** One code point that hides (see HIDES). A newline and a tab are text. */
export function isHiddenChar(ch: string): boolean {
  if (ch === '\n' || ch === '\t') return false
  return ch === BRAILLE_BLANK || HIDES.test(ch)
}

/** The emoji presentation selector after an emoji, a joiner between two pictographs: part of an emoji, not a trick. */
function inEmoji(chars: readonly string[], i: number): boolean {
  const ch = chars[i]
  const prev = chars[i - 1] ?? ''
  const next = chars[i + 1] ?? ''
  if (ch === VS16) return EMOJI.test(prev)
  if (ch === ZWJ) return (PICTOGRAPH.test(prev) || prev === VS16 || SKIN_TONE.test(prev)) && PICTOGRAPH.test(next)
  return false
}

/** A run of plain text, or what hides: one character as its code point (`U+200B`) or a stack of marks (`+238 marks`). */
export type Segment = { readonly text: string } | { readonly hidden: string; readonly count: number }

const codePoint = (ch: string): string => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`

/** The text split into plain runs and markers, so the panel shows ⟨U+200B⟩ where a trick hides one. */
export function revealHidden(text: string): Segment[] {
  const chars = Array.from(text)
  const out: Segment[] = []
  let run = ''
  const flush = (): void => {
    if (run) out.push({ text: run })
    run = ''
  }
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? ''
    if (isHiddenChar(ch)) {
      if (inEmoji(chars, i)) run += ch
      else {
        flush()
        out.push({ hidden: codePoint(ch), count: 1 })
      }
      continue
    }
    if (!MARK.test(ch)) {
      run += ch
      continue
    }
    // a run of visible combining marks (this one included): the first MAX_MARKS stay on their character, the rest
    // are one marker. `end` is past `i`, so the loop always moves on.
    let end = i + 1
    while (end < chars.length && MARK.test(chars[end] ?? '') && !isHiddenChar(chars[end] ?? '')) end++
    run += chars.slice(i, Math.min(end, i + MAX_MARKS)).join('')
    const extra = end - i - MAX_MARKS
    if (extra > 0) {
      flush()
      out.push({ hidden: `+${extra} marks`, count: extra })
    }
    i = end - 1
  }
  flush()
  return out
}

/** How many characters a text hides (each stacked mark counts). */
export const hiddenCount = (text: string): number => revealHidden(text).reduce((n, s) => n + ('hidden' in s ? s.count : 0), 0)

// ---------------------------------------------------------------------------------------------------------------
// What no voice may read
// ---------------------------------------------------------------------------------------------------------------

/** Blanks and letters that split a word without being format characters (bazaar's HIDING_MARKS). */
const HIDING_MARKS = new Set([0x034f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x2800])
const FOLD_DROP = /[\p{Cf}\p{Mn}\p{Me}]/u
/** IPA letters and Latin small capitals ("ɪ", "ɡ", "ᴀ"): look-alikes of Latin letters. */
const LOOKALIKE_BLOCKS: readonly (readonly [number, number])[] = [[0x0250, 0x02af], [0x1d00, 0x1d2b]]
const LATIN = /\p{Script=Latin}/u
const CONFUSABLE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}\p{Script=Coptic}\p{Script=Lisu}\p{Script=Canadian_Aboriginal}]/u

/**
 * The text the patterns read, as bazaar's recorder reads it (llm/chooser.py `folded`): compatibility-decomposed
 * (fullwidth letters and digits become ASCII, accents split off), without format characters, combining marks and
 * hiding blanks (nothing invisible splits a word), spaces collapsed.
 */
export function folded(text: string): string {
  return Array.from(text.normalize('NFKD'))
    .filter((ch) => !FOLD_DROP.test(ch) && !HIDING_MARKS.has(ch.codePointAt(0) ?? 0))
    .join('')
    .replace(/\s+/g, ' ')
}

/** The recorder's shapes (llm/chooser.py INJECTION_PATTERNS), read on the folded text. */
const PATTERNS: Readonly<Record<string, RegExp>> = {
  instruction_override: /\b(ignore|disregard|forget|ignora|olvida)\b[\s\S]{0,40}\b(instructions?|rules?|previous|prompt|instrucciones|reglas)\b/iu,
  role_play: /\b(you are now|act as|pretend|system prompt|eres ahora|act[uú]a como)\b/iu,
  role_tag: /<\/?\s*(system|assistant|user|tool)\s*>|\b(system|assistant|developer)\s*:/iu,
  code_or_json: /```|\{\s*"/u,
  url: /https?:\/\//iu,
  money_command: /\b(accept|acepta|pay|paga|transfer|send|env[ií]a)\b[\s\S]{0,30}\p{Nd}/iu,
  asset_grab: /\b(sell|give|transfer|vende|regala|dame)\b[\s\S]{0,20}\b(all|every|todas|todos)\b|\bgive\b[\s\S]{0,10}\bassets?\b/iu,
}

/**
 * Hiding (bazaar's `odd_unicode`, a little stricter): any character `revealHidden` marks, a look-alike letter, or a word
 * that mixes Latin letters with a look-alike script (a Cyrillic "а" inside "аccept").
 */
export function oddUnicode(text: string): boolean {
  if (revealHidden(text).some((s) => 'hidden' in s)) return true
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (LOOKALIKE_BLOCKS.some(([lo, hi]) => cp >= lo && cp <= hi)) return true
  }
  return (text.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).some((word) => LATIN.test(word) && CONFUSABLE.test(word))
}

/** The names of the injection shapes in a text, as bazaar's recorder (`injection_flags`) would tag it. */
export function injectionFlags(text: string | null | undefined): string[] {
  if (!text) return []
  const plain = folded(text)
  const found = Object.entries(PATTERNS).filter(([, re]) => re.test(plain)).map(([name]) => name)
  return oddUnicode(text) ? [...found, 'odd_unicode'] : found
}

/** A few more shapes no voice should read, beyond the recorder's: a broader instruction override, a markup tag. */
const MORE: readonly RegExp[] = [
  /\b(override|bypass)\b[\s\S]{0,40}\b(instructions?|rules?|prompt|system)\b/iu,
  /\b(new|nuevas?) (instructions?|instrucciones|rules|reglas)\b/iu,
  /\b(sistema|asistente)\s*:/iu,
  /\byou are (an?|the) (assistant|ai|bot|model|admin)\b|\bahora eres\b/iu,
  /\b(jailbreak|prompt injection|do anything now)\b/iu,
  /<\/?\s*[a-z!]/iu,
]

/**
 * A text no voice should read: every shape the recorder tags (so no row's text is ever voiced) and a few more.
 * Deliberately broad: a false positive only keeps a quote a caption (its generated line is voiced instead).
 */
export function looksLikeInjection(text: string): boolean {
  return injectionFlags(text).length > 0 || MORE.some((re) => re.test(folded(text)))
}
