# The paid voices: ElevenLabs settings per role (for the pitch)

Nothing here was run: **no ElevenLabs or Gemini call was made to write or test this.** The ElevenLabs key
is not on the Railway service and stays off until the pitch. Every fact below comes from ElevenLabs' own
documentation (pages read on 2026-10-03, linked under "Sources"); the request the server will send is built
by `elevenRequest()` in `server/providers.ts` and pinned by a test that sends nothing
(`server/app.test.ts`, "builds the ElevenLabs request…").

## What the server sends

`POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`

```json
{
  "text": "[sighs] Ay, qué calor.",
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

## Per role

The ids are the server's defaults (`ELEVEN_VOICES`); every one can be replaced without a deploy of code by
the env var named in the last column. They are ElevenLabs "default" voices, which the docs say "will expire on
December 31, 2026", so they work for the pitch.

| Role | Character | Voice id (default) | Stability | Similarity | Delivery tags it uses most | Env override |
|---|---|---|---|---|---|---|
| `seller` | the maker: a theatrical broker, loud and charming | `s3TPKV1kjDlVtZbl4Ksh` | 0.40 | 0.75 | `[excited]`, `[mischievously]`, `[whispers]`, `[laughs]` | `ELEVENLABS_VOICE_SELLER` |
| `buyer` | the taker: a cheeky, quick bargain hunter | `IKne3meq5aSn9XLyUdCD` | 0.35 | 0.75 | `[sarcastic]`, `[excited]`, `[sighs]`, `[curious]` | `ELEVENLABS_VOICE_BUYER` |
| `abuela` | Abuela Carmen: warm, slow, affectionate | `XB0fDUnXU5powFXDhCwa` | 0.55 | 0.80 | `[laughs]`, `[sighs]` | `ELEVENLABS_VOICE_ABUELA` |
| `chato` | El Chato: gruff, laconic, never kind | `N2lVS1w4EtoT3dr4eOWO` | 0.50 | 0.80 | `[snorts]`, `[sighs]`, `[sarcastic]` | `ELEVENLABS_VOICE_CHATO` |
| `narrator` | the radio host for "something new" | `onwK4e9ZLuTAKqWW03F9` | 0.60 | 0.75 | none (calm) | `ELEVENLABS_VOICE_NARRATOR` |

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

## Switching it on (Omar's step, at the pitch)

1. `railway variable set ELEVENLABS_API_KEY --stdin --service bazaar-live` (never in a file or a chat).
2. Optionally set `ELEVENLABS_VOICE_*` as above.
3. Open the site with `?tts=elevenlabs` (or leave `auto`: ElevenLabs, then Gemini, then the browser voice).
4. The guards stay on: same-origin only, template-only lines, per-address and global rate limits, and the
   daily character budget (`TTS_DAILY_CHARS`, `TTS_DAILY_CHARS_PER_ADDRESS`). Lower them for a rehearsal.

## Sources

- Create speech: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Models: https://elevenlabs.io/docs/overview/models
- Eleven v4: https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
- Prompting Eleven v4 (audio tags): https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4
- Voices (default voices expire 2026-12-31): https://elevenlabs.io/docs/overview/capabilities/voices
- Voices search (filters): https://elevenlabs.io/docs/api-reference/voices/search
