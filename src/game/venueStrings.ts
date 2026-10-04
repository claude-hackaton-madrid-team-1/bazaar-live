/**
 * The words of the Venue screen, in the page's language (kept apart from strings.ts: one screen, one file). Team names
 * come from humanize.ts (`whoName`), times from strings.ts (`hum.ago`, `hum.span`).
 */
import type { Lang } from '../../shared/lang.ts'
import { useLang } from '../ui/lang'
import type { VenueStatus } from './venue.ts'
import type { BenchScore, VenueWarn } from './views/venue.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const pct = (share: number | null): string => (share === null ? '—' : `${Math.round(share * 100)} %`)

const dec = (v: number, lang: Lang): string => {
  const s = String(Math.round(v * 100) / 100)
  return lang === 'es' ? s.replace('.', ',') : s
}

/** A fee as the game sets it: basis points and primas per card. */
const feeText = (bps: number | null, perCard: number | null, lang: Lang, word: string): string => {
  if (bps === null && perCard === null) return `${word} ?`
  const parts = [`${dec((bps ?? 0) / 100, lang)} %`]
  if (perCard) parts.push(`${perCard} P/${lang === 'es' ? 'carta' : 'card'}`)
  return `${word} ${parts.join(' + ')}`
}

export interface VenueStrings {
  readonly notice: Readonly<Record<Exclude<VenueStatus, 'live'>, string>>
  readonly missingView: string
  // the hero: the Market Test now
  readonly eyebrow: string
  readonly liveTitle: (session: number | null) => string
  readonly left: (ticks: number, span: string) => string
  readonly nextTitle: (session: number | null) => string
  /** "in 141 ticks". */
  readonly inTicks: (ticks: number) => string
  /** "~35 min · at 17:42". */
  readonly eta: (span: string, clock: string | null) => string
  readonly noneToday: string
  readonly noneTodaySub: string
  readonly notOurs: string
  readonly traders: string
  readonly tradersValue: (buyers: number, sellers: number) => string
  readonly matched: string
  readonly matchedValue: (matched: number, possible: number) => string
  readonly captured: string
  readonly capturedValue: (captured: number, possible: number) => string
  readonly stopped: string
  readonly stoppedValue: (failed: number, refused: number, expired: number) => string
  readonly noBook: string
  readonly lastResult: (session: number | null, matched: number, possiblePairs: number, share: number | null, efficiency: number | null) => string
  readonly quotedNote: string
  // our venue
  readonly venueTitle: string
  readonly venueSub: string
  readonly kind: (mechanism: string | null) => string
  readonly kindTitle: (mechanism: string | null) => string
  readonly fee: (bps: number | null, perCard: number | null) => string
  readonly status: (s: string | null) => string
  readonly counts: string
  readonly countsTitle: string
  readonly alsoOpen: string
  readonly warn: Readonly<Record<Exclude<VenueWarn, null>, string>>
  readonly score: (s: BenchScore) => string
  readonly scoreTitle: string
  // the sessions
  readonly sessionsTitle: string
  readonly sessionsSub: string
  readonly col: { readonly session: string; readonly traders: string; readonly matched: string; readonly stopped: string; readonly captured: string; readonly efficiency: string }
  readonly sessionName: (session: number | null, startTick: number) => string
  readonly liveTag: string
  readonly pending: string
  readonly earlierDay: (day: string) => string
  readonly noSessions: string
  readonly matchesOf: (n: number) => string
  readonly matchLine: (ask: number | null, bid: number | null, price: number | null, surplus: number | null) => string
  readonly matchStatus: (status: string) => string
  readonly notOursRow: string
  readonly noBookRow: string
  // other teams on our venue
  readonly othersTitle: string
  readonly othersSub: string
  readonly othersNone: (venue: string) => string
  readonly othersHead: (settled: number, teams: number, volume: number, listed: number) => string
  readonly sold: (seller: string, buyer: string, price: number | null) => string
  readonly listedLine: (maker: string, side: 'buy' | 'sell' | null, price: number | null) => string
  readonly brokered: (done: number, stopped: number) => string
  readonly organicNote: string
}

const EN: VenueStrings = {
  notice: {
    loading: 'Reading our venue…',
    off: 'No database: set SHOW_DATABASE_URL on the server and apply db/venue.sql to see our venue and the Market Test.',
    locked: 'This screen needs ?token= (GAME_VIEW_TOKEN): it shows our broker and our private score.',
    error: 'The server did not answer: showing the last snapshot read.',
    mock: 'A made-up day around the mock game (a session every 40 ticks). Remove ?mock=1 for our real venue.',
  },
  missingView: 'not applied yet (db/venue.sql)',
  eyebrow: 'Market Test',
  liveTitle: (s) => (s === null ? 'A session is on now' : `Session ${s} is on now`),
  left: (ticks, span) => `${plural(ticks, 'tick', 'ticks')} left · ${span}`,
  nextTitle: (s) => (s === null ? 'Next session' : `Next: session ${s}`),
  inTicks: (n) => `in ${plural(n, 'tick', 'ticks')}`,
  eta: (span, clock) => [span, clock ? `at ${clock}` : null].filter(Boolean).join(' · '),
  noneToday: 'No Market Test seen today yet',
  noneTodaySub: 'Every two game hours every venue gets the same synthetic book; the first start of the day sets the countdown.',
  notOurs: 'Our venue is not in this session’s list of venues.',
  traders: 'Traders on our venue',
  tradersValue: (b, s) => `${b} buy · ${s} sell`,
  matched: 'Matched',
  matchedValue: (m, p) => `${m} of ${p}`,
  captured: 'Quoted surplus captured',
  capturedValue: (c, p) => `${c} of ${p} P`,
  stopped: 'Stopped',
  stoppedValue: (f, r, e) => [f ? `${f} failed` : null, r ? `${r} refused` : null, e ? `${e} expired` : null].filter(Boolean).join(' · ') || 'none',
  noBook: 'Our broker has not read this session’s book yet.',
  lastResult: (s, m, p, share, eff) =>
    [`Last: ${s === null ? 'session' : `session ${s}`}`, `${m} of ${p} matched`, share === null ? null : `${pct(share)} of the quoted surplus`, eff === null ? 'official efficiency pending' : `official efficiency ${pct(eff)}`]
      .filter(Boolean).join(' · '),
  quotedNote: 'Quotes are not limits: the game scores the gains between the traders’ hidden limits, so the official efficiency (from /me) is the score.',
  venueTitle: 'Our venue',
  venueSub: 'the one each session counts: our best venue open during it',
  kind: (m) => (m === 'board' ? 'board' : m === 'auto' ? 'auto' : 'kind ?'),
  kindTitle: (m) => (m === 'board' ? 'Our broker matches the book' : m === 'auto' ? 'The venue crosses on its own: our broker cannot act' : 'Mechanism not seen yet'),
  fee: (bps, perCard) => feeText(bps, perCard, 'en', 'fee'),
  status: (s) => ({ open: 'open', closing: 'closing', closed: 'closed', suspended: 'suspended' })[s ?? ''] ?? 'status ?',
  counts: 'counts for the Market Test',
  countsTitle: '/me names it as our bench venue',
  alsoOpen: 'Also open',
  warn: {
    none_open: 'No venue of ours is open: the next session counts 0.',
    not_counted: 'The Market Test counts another venue of ours, not this one.',
    auto: 'An auto venue crosses on its own: our broker cannot match its book.',
    closing: 'Our venue is closing: a session after it closes counts 0.',
  },
  score: (s) =>
    [
      s.benchPoints === null ? 'Bench points not read yet' : `Bench points ${dec(s.benchPoints, 'en')}${s.level === 'stall' ? ' (level with the free stall)' : s.level === 'top' ? ' (the top three’s level)' : s.level === 'below_stall' ? ' (below the free stall)' : ''}`,
      s.efficiency === null ? null : `efficiency ${pct(s.efficiency)}`,
      s.mmPoints === null ? null : `market-making ${dec(s.mmPoints, 'en')}`,
    ].filter(Boolean).join(' · '),
  scoreTitle: 'From /me, private: 0.5 bench points = as good as the free auto stall, 1 = the mean of the top three',
  sessionsTitle: 'Every session',
  sessionsSub: 'what the synthetic book brought to our venue and what our broker made of it, newest first',
  col: { session: 'Session', traders: 'Traders', matched: 'Matched', stopped: 'Stopped', captured: 'Captured', efficiency: 'Efficiency' },
  sessionName: (s, tick) => (s === null ? `tick ${tick}` : `#${s}`),
  liveTag: 'live',
  pending: 'pending',
  earlierDay: (day) => day.slice(5).replace('-', '/'),
  noSessions: 'No session announced yet.',
  matchesOf: (n) => `${plural(n, 'match', 'matches')} by our broker`,
  matchLine: (ask, bid, price, surplus) => `sell ${ask ?? '?'} → buy ${bid ?? '?'} at ${price ?? '?'} P${surplus === null ? '' : ` · +${surplus}`}`,
  matchStatus: (s) => ({ done: 'taken', failed: 'failed', rejected: 'refused', expired: 'expired', approved: 'sent' })[s] ?? s,
  notOursRow: 'our venue not in it',
  noBookRow: 'no book read',
  othersTitle: 'Other teams on our venue',
  othersSub: 'today: the second half of market-making is the value they create here',
  othersNone: (v) => `No other team has traded on ${v} today.`,
  othersHead: (settled, teams, volume, listed) =>
    [`${plural(settled, 'trade', 'trades')}`, teams ? `${plural(teams, 'team', 'teams')}` : null, settled ? `${volume} P moved` : null, `${plural(listed, 'offer', 'offers')} listed`].filter(Boolean).join(' · '),
  sold: (seller, buyer, price) => `${seller} → ${buyer}${price === null ? '' : ` at ${price} P`}`,
  listedLine: (maker, side, price) => `${maker} ${side === 'buy' ? 'bids' : 'asks'}${price === null ? '' : ` ${price} P`}`,
  brokered: (done, stopped) => `Our broker matched ${plural(done, 'pair', 'pairs')} of their offers${stopped ? ` (${stopped} stopped)` : ''}.`,
  organicNote: 'The game scores the value created between the two teams, which the feed does not show: the price moved is what we can see.',
}

const ES: VenueStrings = {
  notice: {
    loading: 'Leyendo nuestro puesto…',
    off: 'Sin base de datos: pon SHOW_DATABASE_URL en el servidor y aplica db/venue.sql para ver nuestro puesto y la prueba de mercado.',
    locked: 'Esta pantalla necesita ?token= (GAME_VIEW_TOKEN): muestra nuestro bróker y nuestra puntuación privada.',
    error: 'El servidor no respondió: se muestra la última lectura.',
    mock: 'Un día inventado alrededor de la partida falsa (una sesión cada 40 turnos). Quita ?mock=1 para ver nuestro puesto real.',
  },
  missingView: 'aún sin aplicar (db/venue.sql)',
  eyebrow: 'Prueba de mercado',
  liveTitle: (s) => (s === null ? 'Hay una sesión en marcha' : `Sesión ${s} en marcha`),
  left: (ticks, span) => `quedan ${plural(ticks, 'turno', 'turnos')} · ${span}`,
  nextTitle: (s) => (s === null ? 'Próxima sesión' : `Próxima: sesión ${s}`),
  inTicks: (n) => `en ${plural(n, 'turno', 'turnos')}`,
  eta: (span, clock) => [span, clock ? `a las ${clock}` : null].filter(Boolean).join(' · '),
  noneToday: 'Hoy aún no hemos visto ninguna prueba de mercado',
  noneTodaySub: 'Cada dos horas de juego todos los puestos reciben el mismo libro sintético; el primer arranque del día pone la cuenta atrás.',
  notOurs: 'Nuestro puesto no está en la lista de puestos de esta sesión.',
  traders: 'Traders en nuestro puesto',
  tradersValue: (b, s) => `${b} compran · ${s} venden`,
  matched: 'Casados',
  matchedValue: (m, p) => `${m} de ${p}`,
  captured: 'Excedente cotizado capturado',
  capturedValue: (c, p) => `${c} de ${p} P`,
  stopped: 'Parados',
  stoppedValue: (f, r, e) => [f ? `${f} fallidos` : null, r ? `${r} rechazados` : null, e ? `${e} caducados` : null].filter(Boolean).join(' · ') || 'ninguno',
  noBook: 'Nuestro bróker aún no ha leído el libro de esta sesión.',
  lastResult: (s, m, p, share, eff) =>
    [`Última: ${s === null ? 'sesión' : `sesión ${s}`}`, `${m} de ${p} casados`, share === null ? null : `${pct(share)} del excedente cotizado`, eff === null ? 'eficiencia oficial pendiente' : `eficiencia oficial ${pct(eff)}`]
      .filter(Boolean).join(' · '),
  quotedNote: 'Las cotizaciones no son límites: el juego puntúa las ganancias entre los límites ocultos de los traders, así que la puntuación es la eficiencia oficial (de /me).',
  venueTitle: 'Nuestro puesto',
  venueSub: 'el que cuenta en cada sesión: nuestro mejor puesto abierto durante ella',
  kind: (m) => (m === 'board' ? 'tablón' : m === 'auto' ? 'automático' : 'tipo ?'),
  kindTitle: (m) => (m === 'board' ? 'Nuestro bróker casa el libro' : m === 'auto' ? 'El puesto cruza solo: nuestro bróker no puede actuar' : 'Mecanismo aún no visto'),
  fee: (bps, perCard) => feeText(bps, perCard, 'es', 'comisión'),
  status: (s) => ({ open: 'abierto', closing: 'cerrando', closed: 'cerrado', suspended: 'suspendido' })[s ?? ''] ?? 'estado ?',
  counts: 'cuenta en la prueba de mercado',
  countsTitle: '/me lo da como nuestro puesto de la prueba',
  alsoOpen: 'También abierto',
  warn: {
    none_open: 'No tenemos ningún puesto abierto: la próxima sesión cuenta 0.',
    not_counted: 'La prueba de mercado cuenta otro puesto nuestro, no este.',
    auto: 'Un puesto automático cruza solo: nuestro bróker no puede casar su libro.',
    closing: 'Nuestro puesto está cerrando: una sesión después del cierre cuenta 0.',
  },
  score: (s) =>
    [
      s.benchPoints === null ? 'Puntos de banco aún sin leer' : `Puntos de banco ${dec(s.benchPoints, 'es')}${s.level === 'stall' ? ' (igual que el puesto gratuito)' : s.level === 'top' ? ' (el nivel de los tres mejores)' : s.level === 'below_stall' ? ' (por debajo del puesto gratuito)' : ''}`,
      s.efficiency === null ? null : `eficiencia ${pct(s.efficiency)}`,
      s.mmPoints === null ? null : `creación de mercado ${dec(s.mmPoints, 'es')}`,
    ].filter(Boolean).join(' · '),
  scoreTitle: 'De /me, privado: 0,5 puntos de banco = tan bueno como el puesto automático gratuito, 1 = la media de los tres mejores',
  sessionsTitle: 'Todas las sesiones',
  sessionsSub: 'qué trajo el libro sintético a nuestro puesto y qué hizo con él nuestro bróker, la más reciente primero',
  col: { session: 'Sesión', traders: 'Traders', matched: 'Casados', stopped: 'Parados', captured: 'Capturado', efficiency: 'Eficiencia' },
  sessionName: (s, tick) => (s === null ? `turno ${tick}` : `#${s}`),
  liveTag: 'en vivo',
  pending: 'pendiente',
  earlierDay: (day) => `${day.slice(8)}/${day.slice(5, 7)}`,
  noSessions: 'Aún no se ha anunciado ninguna sesión.',
  matchesOf: (n) => `${plural(n, 'cruce', 'cruces')} de nuestro bróker`,
  matchLine: (ask, bid, price, surplus) => `vende ${ask ?? '?'} → compra ${bid ?? '?'} a ${price ?? '?'} P${surplus === null ? '' : ` · +${surplus}`}`,
  matchStatus: (s) => ({ done: 'aceptado', failed: 'fallido', rejected: 'rechazado', expired: 'caducado', approved: 'enviado' })[s] ?? s,
  notOursRow: 'nuestro puesto no estaba',
  noBookRow: 'sin libro leído',
  othersTitle: 'Otros equipos en nuestro puesto',
  othersSub: 'hoy: la otra mitad de la creación de mercado es el valor que crean aquí',
  othersNone: (v) => `Ningún otro equipo ha comerciado hoy en ${v}.`,
  othersHead: (settled, teams, volume, listed) =>
    [`${plural(settled, 'trato', 'tratos')}`, teams ? `${plural(teams, 'equipo', 'equipos')}` : null, settled ? `${volume} P movidas` : null, `${plural(listed, 'oferta publicada', 'ofertas publicadas')}`].filter(Boolean).join(' · '),
  sold: (seller, buyer, price) => `${seller} → ${buyer}${price === null ? '' : ` a ${price} P`}`,
  listedLine: (maker, side, price) => `${maker} ${side === 'buy' ? 'puja' : 'pide'}${price === null ? '' : ` ${price} P`}`,
  brokered: (done, stopped) => `Nuestro bróker casó ${plural(done, 'pareja', 'parejas')} de sus ofertas${stopped ? ` (${stopped} paradas)` : ''}.`,
  organicNote: 'El juego puntúa el valor creado entre los dos equipos, que el feed no muestra: lo que vemos es el precio movido.',
}

export const VENUE_STRINGS: Readonly<Record<Lang, VenueStrings>> = { es: ES, en: EN }

export function useVenueStrings(): VenueStrings {
  return VENUE_STRINGS[useLang()]
}
