# The paid voices: ElevenLabs settings per role (for the pitch)

The settings below come from ElevenLabs' own documentation; the dealer voices ("One voice per dealer") were
chosen with the ElevenLabs API on 2026-10-03 (six short test lines, nothing else). Every other fact comes from
the documentation (pages read on 2026-10-03, linked under "Sources"); the request the server will send is built
by `elevenRequest()` in `server/providers.ts` and pinned by a test that sends nothing
(`server/app.test.ts`, "builds the ElevenLabs request…").

## What the server sends

`POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`

```json
{
  "text": "[warm gentle voice] [unhurried] [sighs] Ay, qué calor.",
  "model_id": "eleven_v4",
  "language_code": "es",
  "voice_settings": { "stability": 0.55, "similarity_boost": 0.8 }
}
```

| Field | Value | Why (docs) |
|---|---|---|
| `model_id` | `eleven_v4` (env `ELEVENLABS_MODEL_ID` overrides; `eleven_v4_turbo` is the lower-latency sibling, ~100 ms) | v4 is "our most emotionally rich, expressive" model, for "character voiceovers" and "emotional dialogue"; 90+ languages. Both v4 variants use two voice settings only. |
| `language_code` | `es` or `en` (ISO 639-1) | "Enforce a language for the model and text normalization"; the model ignores a code it does not support. It makes "30 primas" read the Spanish way. |
| `voice_settings.stability` | per role, below | "Lower values introduce broader emotional range… higher values can result in a monotonous voice." |
| `voice_settings.similarity_boost` | per role, below | "How closely the AI should adhere to the original voice." |
| `style`, `speed`, `use_speaker_boost` | **not sent** | The v4 page says v4 "use[s] two voice settings: Stability and Similarity". |
| `apply_text_normalization` | not sent (default `auto`) | Numbers and "primas" are normalised by default. |
| `output_format` | `mp3_44100_128` | The default; no paid-tier format needed. |

## Character delivery (2026-10-04)

Each authorized ElevenLabs line now receives two fixed, server-owned performance tags. The quote's words,
price, punctuation and caption stay unchanged. No LLM rewrites dialogue, and the browser cannot choose tags
outside the existing authorized text/template path. Existing approved expressive tags remain after the prefix.

| Speaker | Injected performance prefix |
|---|---|
| buyer / Taker | `[curious] [quick playful delivery]` |
| seller / Maker and Sales | `[confident] [animated delivery]` |
| Abuela | `[warm gentle voice] [unhurried]` |
| Chato | `[low gravelly voice] [dry delivery]` |
| Pilar | `[refined voice] [measured delivery]` |
| guest1 | `[low resonant voice] [deliberate delivery]` |
| guest2 | `[bright voice] [energetic delivery]` |
| guest3 | `[raspy voice] [theatrical delivery]` |
| narrator | `[clear voice] [upbeat delivery]` |
| Jev | `[calm voice] [measured delivery]` |

The guest assignment remains a stable hash of the dealer or rival identity. This covers currently authorized
spoken opponent/duel summaries. Raw rival quotes remain captions under the existing trust policy; a delivery
profile does not authorize arbitrary text. Maker and Sales share the existing seller voice; this change does
not pretend they have separate voice IDs.

The audio cache key now includes the complete rendered ElevenLabs request: voice ID, model, language,
settings and prefix. Old neutral audio cannot mask the new performance. Daily character charging and refunds
include the added tags. Authentication still runs before cache access, including private Sales quotes.

The official [best-practices guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4)
recommends explicit voice-quality instructions and testing them with the chosen voice. These custom tags are
curated directions, not guaranteed effects; v4 does not support SSML break tags. Unit tests verify payloads,
unchanged quote words, cache invalidation and budgets. Audible character quality remains to be auditioned.

## Per role

The ids are the server's defaults (`ELEVEN_VOICES`); every one can be replaced without a deploy of code by
the env var named in the last column. They are ElevenLabs "default" voices, which the docs say "will expire on
December 31, 2026", so they work for the pitch.

| Role | Character | Voice id (default) | Stability | Similarity | Optional existing script cues | Env override |
|---|---|---|---|---|---|---|
| `seller` | the maker: a theatrical broker, loud and charming | `s3TPKV1kjDlVtZbl4Ksh` | 0.40 | 0.75 | `[excited]`, `[mischievously]`, `[whispers]`, `[laughs]` | `ELEVENLABS_VOICE_SELLER` |
| `buyer` | the taker: a cheeky, quick bargain hunter | `IKne3meq5aSn9XLyUdCD` | 0.35 | 0.75 | `[sarcastic]`, `[excited]`, `[sighs]`, `[curious]` | `ELEVENLABS_VOICE_BUYER` |
| `abuela` | Abuela Carmen: warm, slow, affectionate | `RTuKyXJgRGAQSx8Qz8Mf` | 0.55 | 0.80 | `[laughs]`, `[sighs]` | `ELEVENLABS_VOICE_ABUELA` |
| `chato` | El Chato: gruff, laconic, never kind | `RnKqZYEeVQciORlpiCz0` | 0.50 | 0.80 | `[snorts]`, `[sighs]`, `[sarcastic]` | `ELEVENLABS_VOICE_CHATO` |
| `pilar` | Doña Pilar: elegant, formal, from the Salamanca district | `9oWKy782oltLmeuOUdq7` | 0.60 | 0.80 | `[sighs]` | `ELEVENLABS_VOICE_PILAR` |
| `guest1` | the first guest dealer voice (deep, mysterious man) | `5egO01tkUjEzu7xSSE8M` | 0.45 | 0.75 | any | `ELEVENLABS_VOICE_GUEST1`, or the 1st id of `ELEVENLABS_VOICE_POOL` |
| `guest2` | the second guest dealer voice (young, bright woman) | `1eHrpOW5l98cxiSRjbzJ` | 0.45 | 0.75 | any | `ELEVENLABS_VOICE_GUEST2`, or the 2nd id of `ELEVENLABS_VOICE_POOL` |
| `guest3` | the third guest dealer voice (old, theatrical man) | `orF2qy9215xjwqqxqsWW` | 0.50 | 0.75 | any | `ELEVENLABS_VOICE_GUEST3`, or the 3rd id of `ELEVENLABS_VOICE_POOL` |
| `narrator` | the radio host for "something new" | `onwK4e9ZLuTAKqWW03F9` | 0.60 | 0.75 | none (calm) | `ELEVENLABS_VOICE_NARRATOR` |

### One voice per dealer (chosen 2026-10-03 with the ElevenLabs API)

Every dealer speaks and captions as itself, never as the narrator. The three dealers we know have their own
voices; a dealer that arrives later (L4, L5) gets one of the three guest voices, picked by a hash of its id
(`guestSpeaker()` in `shared/tags.ts`), so the same dealer always sounds the same and never takes the
narrator's or a known dealer's voice. Its caption shows its display name from the game's `GET /api/dealers`
(read keyless by the server, `server/dealers.ts`, served to the page as `/api/dealers`).

The account library has a single Spanish voice (Carmelo), so the others come from the shared Voice Library,
filtered on Spanish with a peninsular (Spain) accent. On a paid tier a shared voice is used by id directly,
without adding it to the account; each returned HTTP 200 on one short `eleven_v4` test line. The shared voices
carry a 730-day notice period.

| Dealer | Voice | Voice id | Labels | Why |
|---|---|---|---|---|
| Abuela Carmen (`abuela`) | Tete – Slow, Reflexive and Soft | `RTuKyXJgRGAQSx8Qz8Mf` | peninsular, old, female, calm | "tenderness and memory": a warm, patient grandmother |
| El Chato (`chato`) | Baldo – Husky, Mature and Alluring | `RnKqZYEeVQciORlpiCz0` | peninsular, middle-aged, male, serious | husky and serious: a gruff stallholder |
| Doña Pilar (`pilar`) | Alegria Sana – Diplomatic and Confident | `9oWKy782oltLmeuOUdq7` | peninsular, old, female, classy | old, classy and diplomatic: a formal Salamanca lady |
| guest 1 | Carmelo – Mysterious & Deep | `5egO01tkUjEzu7xSSE8M` | peninsular, middle-aged, male, deep | smooth and deep, unlike Baldo's husk |
| guest 2 | Raquel – Young, Bright and Cheerful | `1eHrpOW5l98cxiSRjbzJ` | peninsular, young, female | the only young voice in the cast |
| guest 3 | Rafael – Expressive and Theatrical | `orF2qy9215xjwqqxqsWW` | peninsular, old, male, a little raspy | a theatrical older man, like an auctioneer |

Alternatives, in case a voice sounds wrong when auditioned: El Chato → Marcos Vidal `BMHmZiBmdOZuKlbiqBOk` (rough,
firm) or Johnny `HMCmDsbKeaSZp5LMOYKR` (mocking); Doña Pilar → Marisa `OTsv82NplloP7M5TyIJ3` (serene, classy) or
Bárbara `oE9b8jFugLgWaRosYzRh` (posh Madrid, but middle-aged); Abuela Carmen → Rosa `ypIbR1aohyRSdDv25DPr`.

**Unverified:** the voices were chosen from their labels and descriptions, not by ear, and none is tagged
Madrid specifically (the Madrid-tagged ones found did not fit an older woman or a gruff man). Audition each with
`?tts=elevenlabs&lang=es` before the pitch. On Railway only `ELEVENLABS_VOICE_SELLER` is set today
(`JBFqnCBsd6RMkjVDRZzb`), so the dealers use these defaults unless a variable overrides them.

The browser fallback (Web Speech) gives each dealer and guest voice its own pitch and rate
(`src/tts/webspeech.ts`) and a voice of its gender when the browser has one (`src/tts/voices.ts`).

Reasoning: the two leads trade jokes all day, so they get the lowest stability (widest range); the dealers
repeat a few stock reactions, so they sit near the middle with a higher similarity so each stays recognisably
the same person; the narrator is the steadiest.

### The tags

Our tags are v4 audio tags in square brackets. Documented v4 tags: `[laughs]`, `[whispers]`, `[sighs]`,
`[sarcastic]`, `[curious]`, `[excited]`, `[snorts]`, `[mischievously]`. `[gasps]` and `[chuckles]` are not in the
documented list (the page calls it non-exhaustive and says to use "similar, contextually appropriate" tags);
audition them before the pitch and swap for `[laughs harder]` / `[exhales]` if a voice sounds odd. The docs
also warn that a tag can occasionally be read as a sound effect, and that "tags land more readily when the
delivery is already in the voice's training data".

### Castilian, not Latin American

v4 lists Spanish as "Spanish (LatAm)", and its page says that when the language generated differs from the
reference voice's language the model "generates fluent, natural-sounding speech in the target language rather
than carrying over the reference voice's accent". So an English-native default voice speaks fluent Spanish but
not necessarily a *Madrid* Spanish. For a real castellano accent the voice itself must be Spanish (Spain):

1. In the Voice Library (or `GET /v1/voices` with `search`, `language=es`, `accent` filters; the docs note
   Library voices are not available through the API on the free tier) pick one voice per role whose accent label
   is Spain.
2. Set `ELEVENLABS_VOICE_<ROLE>` on the Railway service to those ids (no code change).
3. Audition each against the show's own lines: `?tts=elevenlabs&lang=es` plays them through the proxy.

**Unverified:** which library voice has a Madrid accent could not be checked without a key and the API.

## Gemini (the other paid voice)

`geminiRequest()` now tells Gemini the accent of the whole line as part of the turn style: "speaking natural
peninsular Spanish (castellano) from Madrid, not Latin American" for `es`, "speaking English with a light Madrid
accent" for `en`, plus the character's persona and any sustained tag (`sarcastic`, `whispering`...). Momentary
tags go inline as `<laugh>`. See `shared/tags.ts`.

## The show uses ElevenLabs v4 and nothing else

Omar's call (the browser voice sounded wrong beside the characters): `?tts=auto` (the default) is ElevenLabs v4 when
the server has its key, and **captions only** when it does not. There is no browser-voice or Gemini fallback; both
stay reachable only by name (`?tts=webspeech`, `?tts=gemini`) for development. ElevenLabs' own agent skill
(`elevenlabs/skills`, `text-to-speech`) agrees with the settings above: `style` and `speed` are not available on v4,
`language_code` is, and `eleven_v4_turbo` is meant for the Text to Dialogue WebSocket.

### Credits

The account has 10,000 credits and a character costs about one (check the first real run's usage: v4's rate is
not in the pages read). So the proxy's daily budget now defaults to 9,000 characters (`TTS_DAILY_CHARS`), about 90
lines of dialogue. Repeated lines are cached and shared by every viewer; the idle talk (one beat every 22 to 35 s)
is what spends most, so for a long day raise the quiet interval (`?idle=`), keep the page muted until needed, or
lower the budget further. The new performance prefixes have not been auditioned by this implementation task.

## Switching it on (Omar's step, at the pitch)

1. `railway variable set ELEVENLABS_API_KEY --stdin --service bazaar-live` (never in a file or a chat).
2. Optionally set `ELEVENLABS_VOICE_*` as above.
3. Open the site (the default, `?tts=auto`, is ElevenLabs v4 once the server has the key; without it the show plays captions only).
4. The guards stay on: same-origin only, template-only lines, per-address and global rate limits, and the
   daily character budget (`TTS_DAILY_CHARS`, `TTS_DAILY_CHARS_PER_ADDRESS`). Lower them for a rehearsal.

## Sources

- Create speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Models: https://elevenlabs.io/docs/overview/models
- Eleven v4: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
- Prompting Eleven v4 (audio tags): https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4
- Voices (default voices expire 2026-12-31): https://elevenlabs.io/docs/overview/capabilities/voices
- Voices search (filters): https://elevenlabs.io/docs/api-reference/voices/search

### Verification for the delivery-prefix change

- `npm run test:unit`: **1284 tests passed across127 files** (6.70s); includes private quote authorization,
  unchanged quote words, legacy-cache invalidation and exact tag-inclusive budget/refund checks.
- `npx tsc -b`, changed-file ESLint and format checks: exit0. `npm run build`: completed524ms;
  existing large-chunk warning remains.
- Initial tests exposed budget refunds still counting only the original text after adding prefixes;
  refunds now use the same rendered character count as charges. The new checkout initially lacked
  installed dependencies; `npm ci --ignore-scripts` used the existing lockfile, adding no dependencies.
- Unverified: audible interpretation and production deployment. No paid provider request was made by this slice.
