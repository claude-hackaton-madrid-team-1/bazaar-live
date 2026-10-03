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
/**
 * Format characters and EVERY combining mark (bazaar drops Mn and Me; a mark that a newer Unicode moved to Mc, such as
 * U+1171E, must still go, or it splits a keyword).
 */
const FOLD_DROP = /[\p{Cf}\p{M}]/u
/** What bazaar's fold drops, under this runtime's categories: it keeps spacing marks, and its patterns read one as a break. */
const RECORDER_DROP = /[\p{Cf}\p{Mn}\p{Me}]/u
/** Everything outside ASCII: in the "split" readings, a break between words. */
const NON_ASCII = /[\u0080-\u{10ffff}]/gu
/** The dotless i matches "i" in the recorder's case-insensitive patterns (Python's re); JavaScript's /i does not. */
const DOTLESS_I = String.fromCodePoint(0x0131)
/** IPA letters and Latin small capitals ("ɪ", "ɡ", "ᴀ"): look-alikes of Latin letters. */
const LOOKALIKE_BLOCKS: readonly (readonly [number, number])[] = [[0x0250, 0x02af], [0x1d00, 0x1d2b]]
const LATIN = /\p{Script=Latin}/u
const LETTER = /\p{L}/u
/** Letters outside the Latin script that are not tricks in a Latin word: "µ" (micro sign) and "ʼ" (modifier apostrophe). */
const LATIN_FRIENDS = new Set([0x00b5, 0x02bc])

/**
 * The text the patterns read, as bazaar's recorder reads it (llm/chooser.py `folded`): compatibility-decomposed
 * (fullwidth letters and digits become ASCII, accents split off), the dotless i read as "i", without format
 * characters, combining marks and hiding blanks (nothing invisible splits a word), spaces collapsed.
 */
export function folded(text: string): string {
  return squeeze(decomposed(text), FOLD_DROP)
}

const decomposed = (text: string): string => text.normalize('NFKD').replaceAll(DOTLESS_I, 'i')

/** The text without the characters `drop` matches and without hiding blanks, spaces collapsed. */
function squeeze(text: string, drop: RegExp): string {
  return Array.from(text)
    .filter((ch) => !drop.test(ch) && !HIDING_MARKS.has(ch.codePointAt(0) ?? 0))
    .join('')
    .replace(/\s+/g, ' ')
}

const split = (text: string): string => text.replace(NON_ASCII, ' ').replace(/\s+/g, ' ')

/**
 * Every way the recorder could read the words of a text. Its fold drops format characters and non-spacing marks (the
 * words around them join), and its patterns then read any other character that is not a letter or a digit as a break.
 * Python and this runtime ship different Unicode versions (a mark Python drops is a spacing mark here; a character
 * new here is unassigned there), so the port reads the text both ways: with every mark dropped (joined), and with every
 * remaining non-ASCII character as a break (split), on the folded text, on the recorder's own fold and on the raw text.
 */
function readings(text: string): string[] {
  const nfkd = decomposed(text)
  const joined = squeeze(nfkd, FOLD_DROP)
  return [joined, split(joined), split(squeeze(nfkd, RECORDER_DROP)), split(text)]
}

/** A word with a Latin letter and a letter of another script (a Cyrillic "а" in "аccept", a Greek numeral sign). */
function mixesScripts(word: string): boolean {
  if (!LATIN.test(word)) return false
  for (const ch of word) if (LETTER.test(ch) && !LATIN.test(ch) && !LATIN_FRIENDS.has(ch.codePointAt(0) ?? 0)) return true
  return false
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
 * Hiding (bazaar's `odd_unicode`, stricter): any character `revealHidden` marks, a look-alike letter, or a word that
 * mixes Latin letters with letters of any other script (bazaar flags only the look-alike scripts; Unicode versions
 * and script data differ between Python and JavaScript, so this side takes them all).
 */
export function oddUnicode(text: string): boolean {
  if (revealHidden(text).some((s) => 'hidden' in s)) return true
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (LOOKALIKE_BLOCKS.some(([lo, hi]) => cp >= lo && cp <= hi)) return true
  }
  return (text.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).some(mixesScripts)
}

/**
 * The names of the injection shapes in a text: every one bazaar's recorder (`injection_flags`) tags, except in a text
 * `readsDifferently` refuses (a character that reads otherwise to the recorder's Unicode), and a few more, since the
 * port also reads every non-ASCII character as a break. The voice guard is `looksLikeInjection`, which refuses both.
 */
export function injectionFlags(text: string | null | undefined): string[] {
  if (!text) return []
  const plains = readings(text)
  const found = Object.entries(PATTERNS).filter(([, re]) => plains.some((plain) => re.test(plain))).map(([name]) => name)
  return oddUnicode(text) ? [...found, 'odd_unicode'] : found
}

/** Compatibility characters a dealer may well type, which read the same to a pattern: … º ª µ, a no-break space, ½ ¼ ¾. */
const PLAIN_COMPAT = new Set([0x2026, 0x00ba, 0x00aa, 0x00b5, 0x00a0, 0x00bd, 0x00bc, 0x00be])
/**
 * The plain accents: the Combining Diacritical Marks block (U+0300-036F, every code point assigned, so no newer Unicode
 * can add a mark there) and the variation selectors (U+FE00-FE0F, an emoji's own). Any other mark reads differently: a
 * mark this runtime knows and the recorder's Python does not (Unicode 17 added inherited marks at U+1ACF-1AEB) is
 * dropped here, joining two words the recorder reads apart.
 */
const plainMark = (cp: number): boolean => (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0xfe00 && cp <= 0xfe0f)
/** Hangul syllables decompose into their letters (jamo) the same way in every Unicode version. */
const HANGUL_SYLLABLE = /[\uac00-\ud7a3]/u

/** One character that decomposes into several letters: one character to a runtime that does not know it, several here. */
const expands = (ch: string): boolean => !HANGUL_SYLLABLE.test(ch) && Array.from(ch.normalize('NFD')).filter((c) => !MARK.test(c)).length > 1

/**
 * A text that reads differently to a pattern than it looks: a mark other than a plain accent (a spacing mark, an
 * enclosing mark, a script's own sign, a mark newer than the recorder's Unicode), a compatibility character (an
 * outlined letter, a fullwidth form, a ligature) beyond a few a dealer may type, or a character that decomposes into several letters (the Kirat Rai vowel signs, new
 * in Unicode 16: one unknown character to the recorder's Python, two or three letters here, enough to stretch a
 * pattern's gap). No voice reads such a text, whatever any pattern says about it.
 */
export function readsDifferently(text: string): boolean {
  for (const ch of text) {
    if (MARK.test(ch)) {
      if (!plainMark(ch.codePointAt(0) ?? 0)) return true
      continue
    }
    if (ch.normalize('NFKD') !== ch.normalize('NFD') && !PLAIN_COMPAT.has(ch.codePointAt(0) ?? 0)) return true
    if (expands(ch)) return true
  }
  return false
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
 * A text no voice should read: every shape the recorder tags, read every way it could read it (so no row's text is ever
 * voiced), a text that reads differently than it looks, and a few more shapes. Deliberately broad: a false positive
 * only keeps a quote a caption (its generated line is voiced instead).
 */
export function looksLikeInjection(text: string): boolean {
  if (injectionFlags(text).length > 0 || readsDifferently(text)) return true
  const plains = readings(text)
  return MORE.some((re) => plains.some((plain) => re.test(plain)))
}
