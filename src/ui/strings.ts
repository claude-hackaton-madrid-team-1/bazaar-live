/** The words around the dialogue (labels, captions, notices), in the show's language. */
import type { Lang } from '../../shared/lang.ts'
import type { AgentId } from '../model/events'

export interface Strings {
  readonly sign: string
  readonly buyer: string
  readonly seller: string
  readonly taker: string
  readonly maker: string
  readonly stageLabel: string
  readonly boardLabel: string
  readonly boardEmpty: string
  readonly wanted: string
  readonly priceUnknown: string
  readonly bidFor: string
  readonly askFor: string
  readonly cardPrivate: string
  readonly primas: string
  readonly reaches: string
  readonly dealDone: string
  readonly dealSent: string
  readonly dealDoneSr: string
  readonly dealSentSr: string
  readonly guardrail: string
  readonly guardrailSr: string
  readonly jevThinks: string
  readonly jevSr: string
  readonly undecided: string
  readonly dealers: { readonly abuela: string; readonly chato: string; readonly other: string }
  readonly moves: Readonly<Record<string, string>>
  readonly hoods: Readonly<Record<string, string>>
  readonly transcript: string
  readonly captions: string
  readonly waiting: string
  readonly skipped: string
  readonly narrator: string
  /** What a delivery tag looks like in a caption (the voice never reads it). */
  readonly tags: Readonly<Record<string, string>>
  readonly brandTag: string
  readonly modes: { readonly live: string; readonly dry: string; readonly offline: string }
  readonly who: Readonly<Record<AgentId, string>>
  readonly mock: string
  readonly voiceLabel: string
  readonly voices: Readonly<Record<string, string>>
  readonly noKey: string
  readonly langLabel: string
  readonly noVoice: string
  readonly muted: string
  readonly soundOn: string
  readonly tick: string
  readonly noTick: string
  readonly fallback: string
  readonly gateTitle: string
  readonly gateText: string
  readonly gateSound: string
  readonly gateMuted: string
  readonly gateKey: string
  readonly mockNotice: string
  readonly doorsClosed: (when: string | null) => string
  readonly tryMock: string
  readonly cantReach: string
}

const HOODS_ALL = { LAV: 'Lavapiés', MAL: 'Malasaña', LAT: 'La Latina', SAL: 'Salamanca', RET: 'El Retiro', CHA: 'Chamberí' }

const ES: Strings = {
  sign: 'EL RASTRO · PUESTO Nº 1',
  buyer: 'COMPRADOR',
  seller: 'VENDEDOR',
  taker: 'taker',
  maker: 'maker',
  stageLabel: 'El puesto en El Rastro, al atardecer',
  boardLabel: 'Nuestras ofertas en el tablón',
  boardEmpty: 'El tablón está vacío… por ahora.',
  wanted: 'SE BUSCA',
  priceUnknown: 'precio privado',
  bidFor: 'Puja por',
  askFor: 'Oferta de',
  cardPrivate: 'precio privado',
  primas: 'primas',
  reaches: 'El comprador alcanza',
  dealDone: '¡TRATO HECHO!',
  dealSent: 'enviado',
  dealDoneSr: 'Trato hecho',
  dealSentSr: 'Enviado al juego',
  guardrail: 'BARRERA',
  guardrailSr: 'Alto: una barrera de seguridad frenó el movimiento',
  jevThinks: 'Jev piensa…',
  jevSr: 'Jev piensa',
  undecided: '¿?',
  dealers: { abuela: 'Abuela Carmen', chato: 'El Chato', other: 'el tratante' },
  moves: { open: 'saluda', bid: 'regatea…', accept: '¡trato!', walk: 'se va' },
  hoods: HOODS_ALL,
  transcript: 'Transcripción',
  captions: 'subtítulos',
  waiting: 'Esperando el primer movimiento…',
  skipped: 'omitida',
  narrator: 'Narrador',
  tags: { laughs: 'ríe', chuckles: 'se ríe', gasps: 'se sorprende', sighs: 'suspira', snorts: 'bufa', sarcastic: 'con sorna', whispers: 'susurra', excited: 'emocionado', mischievously: 'con picardía', curious: 'curioso' },
  brandTag: 'el comprador y el vendedor, hablando en voz alta',
  modes: { live: 'EN VIVO', dry: 'ENSAYO', offline: 'SIN CONEXIÓN' },
  who: { taker: 'comprador', maker: 'vendedor' },
  mock: 'SIMULACRO',
  voiceLabel: 'Proveedor de voz',
  voices: { auto: 'Voz: auto', webspeech: 'Voz del navegador', elevenlabs: 'ElevenLabs', gemini: 'Gemini', off: 'Sin voz' },
  noKey: 'sin clave',
  langLabel: 'Idioma',
  noVoice: 'Este navegador no tiene voz en castellano: solo se muestra el texto',
  muted: 'Silenciado',
  soundOn: 'Con sonido',
  tick: 'tick',
  noTick: 'Aún sin tick',
  fallback: 'El puesto tropezó con una caja. Vuelvo enseguida; la transcripción sigue.',
  gateTitle: 'Bazaar Live',
  gateText: 'Nuestros dos agentes, el comprador y el vendedor, regatean en un puesto de El Rastro al caer la tarde. Cada movimiento que hacen, lo dicen en voz alta.',
  gateSound: '▶ Empezar con sonido',
  gateMuted: 'Ver en silencio',
  gateKey: 'Pulsa M en cualquier momento para silenciar o activar el sonido.',
  mockNotice: 'Modo simulacro: una tarde grabada en el puesto, en bucle. Quita ?mock=1 para ver a los agentes en vivo.',
  doorsClosed: (when) => `Puertas cerradas${when ? ` · el juego reabre ${when} (hora de Madrid)` : ''}. ¿Una vista previa? Prueba`,
  tryMock: '?mock=1',
  cantReach: 'No llego a los agentes ahora mismo; reintentando. Mientras tanto:',
}

const EN: Strings = {
  sign: 'EL RASTRO · STALL Nº 1',
  buyer: 'BUYER',
  seller: 'SELLER',
  taker: 'taker',
  maker: 'maker',
  stageLabel: 'The stall at El Rastro, at dusk',
  boardLabel: 'Our offers on the board',
  boardEmpty: 'The board is empty… for now.',
  wanted: 'WANTED',
  priceUnknown: 'price private',
  bidFor: 'Bid for',
  askFor: 'Ask for',
  cardPrivate: 'price private',
  primas: 'primas',
  reaches: 'The buyer reaches for',
  dealDone: 'DEAL DONE!',
  dealSent: 'sent',
  dealDoneSr: 'Deal done',
  dealSentSr: 'Sent to the game',
  guardrail: 'GUARDRAIL',
  guardrailSr: 'Stop: a guardrail denied the move',
  jevThinks: 'Jev thinks…',
  jevSr: 'Jev thinks',
  undecided: '¿?',
  dealers: { abuela: 'Abuela Carmen', chato: 'El Chato', other: 'the dealer' },
  moves: { open: 'greets', bid: 'haggling…', accept: 'deal!', walk: 'walks away' },
  hoods: HOODS_ALL,
  transcript: 'Transcript',
  captions: 'captions',
  waiting: 'Waiting for the first move…',
  skipped: 'skipped',
  narrator: 'Narrator',
  tags: {},
  brandTag: 'the buyer and the seller, talking out loud',
  modes: { live: 'LIVE', dry: 'DRY RUN', offline: 'OFFLINE' },
  who: { taker: 'buyer', maker: 'seller' },
  mock: 'MOCK',
  voiceLabel: 'Voice provider',
  voices: { auto: 'Voice: auto', webspeech: 'Browser voice', elevenlabs: 'ElevenLabs', gemini: 'Gemini', off: 'No voice' },
  noKey: 'no key',
  langLabel: 'Language',
  noVoice: 'This browser has no English voice: the text is shown, not spoken',
  muted: 'Muted',
  soundOn: 'Sound on',
  tick: 'tick',
  noTick: 'No tick yet',
  fallback: 'The stall tripped over a crate. Back in a moment; the transcript keeps going.',
  gateTitle: 'Bazaar Live',
  gateText: 'Our two trading agents, the buyer and the seller, haggle at a stall in El Rastro as the evening falls. Every move they make, they say out loud.',
  gateSound: '▶ Start the show with sound',
  gateMuted: 'Watch muted',
  gateKey: 'Press M any time to mute or unmute.',
  mockNotice: 'Mock mode: a recorded afternoon at the stall, on a loop. Drop ?mock=1 for the live agents.',
  doorsClosed: (when) => `Doors closed${when ? ` · the game reopens ${when} (Madrid)` : ''}. Want a preview? Try`,
  tryMock: '?mock=1',
  cantReach: "Can't reach the agents right now; retrying with backoff. Meanwhile:",
}

export const STRINGS: Readonly<Record<Lang, Strings>> = { es: ES, en: EN }
