/**
 * Which of the browser's voices each character gets. Pure: it takes the list `speechSynthesis` offers
 * and returns one voice per role, so it can be tested with made-up voices.
 *
 * A line is in one language, so every role gets a NATIVE voice of that language (es-ES first, then
 * the other Spanish ones; en-GB, en-US, then any English one), never an English voice reading Spanish.
 * Within a language the characters get different voices when the browser has enough of them, and a
 * male or female one by the role (the abuela is a woman, El Chato has a deep voice).
 */
import type { Lang } from '../../shared/lang.ts'
import { SPEAKERS, type Speaker } from '../../shared/tags.ts'

export interface VoiceLike {
  readonly name: string
  readonly lang: string
  readonly localService?: boolean
}

type Gender = 'f' | 'm'

/** The voice each role should sound like; the pitch and rate in webspeech.ts finish the job. */
const ROLE_GENDER: Readonly<Record<Speaker, Gender>> = {
  abuela: 'f', buyer: 'f', chato: 'm', seller: 'm', pilar: 'f', guest1: 'm', guest2: 'f', guest3: 'm', narrator: 'm', jev: 'm',
}
/**
 * Who picks first: the leads speak most, so they get the most native voices before the dealers do; the
 * guest voices (dealers that arrive later) pick last and share a voice when the browser runs out (their
 * pitch and rate in webspeech.ts still tell them apart).
 */
const PICK_ORDER: readonly Speaker[] = ['seller', 'buyer', 'abuela', 'chato', 'pilar', 'narrator', 'jev', 'guest1', 'guest2', 'guest3']

const FEMALE = /\b(flo|sandy|shelley|sonia|monica|mónica|paulina|helena|laura|sabina|marisol|lucia|lucía|elvira|dalia|luciana|samantha|karen|moira|tessa|serena|kate|fiona|victoria|susan|zira|female|mujer)\b/i
const MALE = /\b(grandpa|reed|rocko|eddy|ryan|jorge|juan|diego|carlos|pablo|alvaro|álvaro|enrique|miguel|alonso|daniel|alex|fred|oliver|arthur|thomas|david|mark|male|hombre)\b/i
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|junior|organ|princess|ralph|trinoids|whisper|wobble|zarvox|superstar|jester)\b/i
const QUALITY = /\b(natural|neural|premium|enhanced|online|siri)\b/i

const normalise = (lang: string): string => lang.replace('_', '-').toLowerCase()

/** How native a voice is for a language: lower is better, Infinity means not usable. */
function tierOf(voice: VoiceLike, lang: Lang): number {
  const tag = normalise(voice.lang)
  if (NOVELTY.test(voice.name)) return Infinity
  if (lang === 'es') return tag === 'es-es' ? 0 : tag.startsWith('es') ? 1 : Infinity
  if (tag === 'en-gb') return 0
  if (tag === 'en-us') return 1
  return tag.startsWith('en') ? 2 : Infinity
}

function genderOf(voice: VoiceLike): Gender | null {
  if (FEMALE.test(voice.name)) return 'f'
  if (MALE.test(voice.name)) return 'm'
  return null
}

/** Best first: the most native tier, then the better engines, then the local ones (they start faster). */
function ranked<T extends VoiceLike>(voices: readonly T[], lang: Lang): T[] {
  return voices
    .map((voice, index) => ({ voice, index, tier: tierOf(voice, lang) }))
    .filter((v) => Number.isFinite(v.tier))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        Number(QUALITY.test(b.voice.name)) - Number(QUALITY.test(a.voice.name)) ||
        Number(b.voice.localService === true) - Number(a.voice.localService === true) ||
        a.index - b.index,
    )
    .map((v) => v.voice)
}

export type VoiceMap<T extends VoiceLike> = Readonly<Record<Speaker, T | null>>

/**
 * The voices worth using: the most native tier only (every es-ES voice when there is one, not an es-MX
 * one next to it); for English also the next tier (en-GB and en-US sound alike), so the cast has choice.
 */
function usableTiers<T extends VoiceLike>(pool: readonly T[], lang: Lang): T[] {
  const best = pool[0] ? tierOf(pool[0], lang) : 0
  const worst = lang === 'en' ? Math.max(best, 1) : best
  return pool.filter((v) => tierOf(v, lang) <= worst)
}

/** One native voice per role (or null when the browser has none for the language). */
export function assignVoices<T extends VoiceLike>(voices: readonly T[], lang: Lang): VoiceMap<T> {
  const pool = usableTiers(ranked(voices, lang), lang)
  const taken = new Set<T>()
  const out = Object.fromEntries(SPEAKERS.map((s) => [s, null])) as Record<Speaker, T | null>
  for (const role of PICK_ORDER) {
    const want = ROLE_GENDER[role]
    const free = pool.filter((v) => !taken.has(v))
    // A free voice of the right gender, else one of unknown gender; sharing a voice of the right gender
    // (the pitch still differs) beats giving a woman's part to a man's voice.
    const pick =
      free.find((v) => genderOf(v) === want) ?? free.find((v) => genderOf(v) === null) ?? pool.find((v) => genderOf(v) === want) ?? free[0] ?? pool[0] ?? null
    out[role] = pick
    if (pick) taken.add(pick)
  }
  return out
}
