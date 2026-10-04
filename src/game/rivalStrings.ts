/**
 * The words of the Rivals screen, in the page's language (kept apart from strings.ts: one screen, one file).
 * Facts only, and always as far as the public moves show: a card we never saw a team hold is unknown, not missing.
 */
import type { Lang } from '../../shared/lang.ts'
import type { HowKnown } from '../../shared/rivals.ts'
import { useLang } from '../ui/lang'
import type { RivalsStatus } from './rivals.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface RivalStrings {
  readonly notice: Readonly<Record<Exclude<RivalsStatus, 'live'>, string>>
  readonly missingView: string
  readonly publicOnly: string
  readonly rarity: (r: string | null) => string
  // who has what we need
  readonly needs: string
  readonly needsSub: string
  readonly page: (name: string, have: number, of: number) => string
  readonly how: Readonly<Record<HowKnown, string>>
  /** "bought 3 min ago", for a holder chip's title and the album's cells. */
  readonly since: (how: HowKnown, ago: string) => string
  readonly seen: (ago: string) => string
  /** On a holder chip: the latest sighting, when later than how it got the card. */
  readonly seenLast: string
  readonly copies: (n: number) => string
  readonly nobody: string
  readonly dealers: (names: string) => string
  readonly chasing: string
  readonly bid: (price: number) => string
  readonly asksDealer: string
  readonly more: (n: number) => string
  readonly noNeeds: string
  // the standings
  readonly standings: string
  readonly standingsSub: string
  readonly col: { readonly rank: string; readonly team: string; readonly score: string; readonly pages: string; readonly ours: string; readonly chases: string }
  readonly us: string
  readonly holdsOurs: (n: number) => string
  readonly sameSet: string
  readonly sameSetTitle: string
  readonly pagesTitle: string
  readonly oursTitle: string
  readonly pick: string
  // one team's album
  readonly compare: (team: string) => string
  readonly usCol: string
  readonly ourCount: (have: number, of: number, complete: boolean) => string
  readonly noPage: string
  readonly weHave: (n: number) => string
  readonly weLack: string
  readonly legendOurs: string
  /** When the leaderboard counts more complete pages than public moves show. */
  readonly albumGap: (complete: number, seen: number) => string
  readonly albumHead: (rank: number, score: number, pages: number | null) => string
  /** "36 held · 27 known": filled slots by the leaderboard (null until stored) beside the page cards public moves show. */
  readonly heldKnown: (held: number | null, known: number) => string
  readonly heldKnownTitle: (stored: boolean) => string
  readonly probable: string
  readonly probableTitle: (known: number, of: number, complete: number, seen: number) => string
  readonly unknownProbable: string
  readonly known: (n: number, of: number) => string
  readonly holdsNeed: (n: number) => string
  readonly unknown: string
  readonly needed: string
  readonly legendKnown: string
  readonly legendUnknown: string
  readonly legendNeed: string
  readonly noTeam: string
  // invite rivals to our market
  readonly invite: string
  readonly inviteSub: string
  readonly inviteEmpty: string
  readonly inviteChasing: string
  readonly inviteCount: (cards: number) => string
  readonly inviteVenue: (name: string, id: string) => string
  /** The ready-to-send pitch for a team: the cards it lacks that we list, on our 0 % venue. */
  readonly inviteMsg: (team: string, cards: string, venue: string) => string
  readonly inviteCardAt: (card: string, price: number | null) => string
  readonly inviteCopy: string
  readonly inviteCopied: string
}

const RARITY_EN: Readonly<Record<string, string>> = { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary' }
const RARITY_ES: Readonly<Record<string, string>> = { common: 'común', uncommon: 'poco común', rare: 'rara', epic: 'épica', legendary: 'legendaria' }

const EN: RivalStrings = {
  notice: {
    loading: 'Reading the rivals…',
    off: 'No database: set SHOW_DATABASE_URL on the server and apply db/rival_albums.sql to see the rivals\' albums.',
    locked: 'This screen needs ?token= (GAME_VIEW_TOKEN), like every game screen.',
    error: 'The server did not answer: showing the last snapshot read.',
    mock: 'A made-up market around the mock game. Remove ?mock=1 for the real rivals.',
  },
  missingView: 'not applied yet (db/rival_albums.sql)',
  publicOnly: 'known from public moves',
  rarity: (r) => (r ? (RARITY_EN[r] ?? r) : '—'),
  needs: 'Who has what we need',
  needsSub: 'the cards our target pages lack: swap or buy targets',
  page: (name, have, of) => `${name} ${have}/${of}`,
  how: { bought: 'bought', pack: 'from a pack', gift: 'a gift', crafted: 'crafted', listed: 'seen listed' },
  since: (how, ago) => (how === 'listed' ? `seen listing it ${ago}` : how === 'gift' ? `given ${ago}` : how === 'pack' ? `opened ${ago}` : `${how === 'crafted' ? 'crafted' : 'bought'} ${ago}`),
  seen: (ago) => `last seen ${ago}`,
  seenLast: 'seen',
  copies: (n) => `×${n}`,
  nobody: 'No team seen holding it in public moves',
  dealers: (names) => `Also held by ${names}`,
  chasing: 'Also after it:',
  bid: (price) => `bids ${price} P`,
  asksDealer: 'asks the dealers',
  more: (n) => `+${n} more`,
  noNeeds: 'Our target pages lack nothing, or our album has not arrived yet.',
  standings: 'Standings',
  standingsSub: 'the leaderboard\'s last read; pick a team to see its album',
  col: { rank: '#', team: 'Team', score: 'Pts', pages: 'Pages', ours: 'Ours', chases: 'Chases' },
  us: 'us',
  holdsOurs: (n) => `holds ${plural(n, 'card', 'cards')} we need`,
  sameSet: 'like us',
  sameSetTitle: 'Its public moves chase a set we aim for: it competes with us for the same cards',
  pagesTitle: 'Complete album pages, by the leaderboard',
  oursTitle: 'How many of the cards we need it holds',
  pick: 'See its album',
  compare: (team) => `Us vs ${team}`,
  usCol: 'Us',
  ourCount: (have, of, complete) => (complete ? `${have}/${of} complete` : `${have}/${of}`),
  noPage: 'no page',
  weHave: (n) => (n > 1 ? `we hold ${n} copies` : 'we hold it'),
  weLack: 'we lack it',
  legendOurs: 'we hold it',
  albumGap: (complete, seen) => `The leaderboard counts ${plural(complete, 'complete page', 'complete pages')}, public moves show ${seen}: the likeliest are flagged`,
  albumHead: (rank, score, pages) => `#${rank} · ${score.toFixed(1)} points${pages == null ? '' : ` · ${plural(pages, 'complete page', 'complete pages')}`}`,
  known: (n, of) => `${n}/${of} known`,
  heldKnown: (held, known) => (held === null ? `${known} known` : `${held} held · ${known} known`),
  heldKnownTitle: (stored) =>
    stored
      ? 'Held: filled album slots, by the leaderboard. Known: page cards seen in public moves.'
      : 'Page cards seen in public moves. The leaderboard\'s filled slots are not stored yet.',
  probable: 'probably complete',
  probableTitle: (known, of, complete, seen) => `${known}/${of} seen. The leaderboard counts ${plural(complete, 'complete page', 'complete pages')}, public moves show ${seen}: this is one of the likeliest.`,
  unknownProbable: 'not seen: probably held (the page is probably complete)',
  holdsNeed: (n) => `${plural(n, 'card', 'cards')} we need`,
  unknown: 'not seen: it may hold it',
  needed: 'we need it',
  legendKnown: 'seen holding it',
  legendUnknown: '? = held or not, never seen in public moves',
  legendNeed: 'a card we need',
  noTeam: 'No leaderboard read yet.',
  invite: 'Invite them to our market',
  inviteSub: 'cards we list that each rival is missing — pitch them our 0 % venue (public moves only: "may need")',
  inviteEmpty: 'Nothing to pitch yet: no card we list matches a rival\'s missing page, or our venue has no asks up.',
  inviteChasing: 'already after one',
  inviteCount: (cards) => `${plural(cards, 'card', 'cards')} it may need`,
  inviteVenue: (name, id) => `on ${name} (${id})`,
  inviteMsg: (team, cards, venue) => `${team}: we have ${cards} listed on our market — ${venue}, 0 % fee (vs El Rastro's 5 % + 1 P). Come and complete your pages.`,
  inviteCardAt: (card, price) => (price == null ? card : `${card} (${price} P)`),
  inviteCopy: 'Copy pitch',
  inviteCopied: 'Copied',
}

const ES: RivalStrings = {
  notice: {
    loading: 'Leyendo a los rivales…',
    off: 'Sin base de datos: pon SHOW_DATABASE_URL en el servidor y aplica db/rival_albums.sql para ver los álbumes de los rivales.',
    locked: 'Esta pantalla necesita ?token= (GAME_VIEW_TOKEN), como todas las del juego.',
    error: 'El servidor no responde: se muestra la última lectura.',
    mock: 'Un mercado inventado alrededor del juego de prueba. Quita ?mock=1 para ver a los rivales de verdad.',
  },
  missingView: 'sin aplicar todavía (db/rival_albums.sql)',
  publicOnly: 'conocido por movimientos públicos',
  rarity: (r) => (r ? (RARITY_ES[r] ?? r) : '—'),
  needs: 'Quién tiene lo que nos falta',
  needsSub: 'las cartas que faltan en nuestras páginas objetivo: a quién cambiar o comprar',
  page: (name, have, of) => `${name} ${have}/${of}`,
  how: { bought: 'comprada', pack: 'de un sobre', gift: 'regalo', crafted: 'fabricada', listed: 'vista a la venta' },
  since: (how, ago) => (how === 'listed' ? `la puso a la venta ${ago}` : how === 'gift' ? `se la regalaron ${ago}` : how === 'pack' ? `le salió en un sobre ${ago}` : `${how === 'crafted' ? 'la fabricó' : 'la compró'} ${ago}`),
  seen: (ago) => `vista por última vez ${ago}`,
  seenLast: 'vista',
  copies: (n) => `×${n}`,
  nobody: 'Ningún equipo la tiene en movimientos públicos',
  dealers: (names) => `También la tiene ${names}`,
  chasing: 'También la buscan:',
  bid: (price) => `puja ${price} P`,
  asksDealer: 'la pide a los tratantes',
  more: (n) => `+${n} más`,
  noNeeds: 'A nuestras páginas objetivo no les falta nada, o nuestro álbum aún no ha llegado.',
  standings: 'Clasificación',
  standingsSub: 'la última lectura de la clasificación; elige un equipo para ver su álbum',
  col: { rank: '#', team: 'Equipo', score: 'Ptos', pages: 'Págs', ours: 'Nuestras', chases: 'Persigue' },
  us: 'nosotros',
  holdsOurs: (n) => (n === 1 ? 'tiene 1 carta que nos falta' : `tiene ${n} cartas que nos faltan`),
  sameSet: 'como nosotros',
  sameSetTitle: 'Sus movimientos públicos persiguen un barrio que buscamos: compite con nosotros por las mismas cartas',
  pagesTitle: 'Páginas del álbum completas, según la clasificación',
  oursTitle: 'Cuántas de las cartas que nos faltan tiene',
  pick: 'Ver su álbum',
  compare: (team) => `Nosotros vs ${team}`,
  usCol: 'Nosotros',
  ourCount: (have, of, complete) => (complete ? `${have}/${of} completa` : `${have}/${of}`),
  noPage: 'sin página',
  weHave: (n) => (n > 1 ? `tenemos ${n} copias` : 'la tenemos'),
  weLack: 'nos falta',
  legendOurs: 'la tenemos',
  albumGap: (complete, seen) => `La clasificación cuenta ${plural(complete, 'página completa', 'páginas completas')}, los movimientos públicos muestran ${seen}: se marcan las más probables`,
  albumHead: (rank, score, pages) => `#${rank} · ${score.toFixed(1).replace('.', ',')} puntos${pages == null ? '' : ` · ${plural(pages, 'página completa', 'páginas completas')}`}`,
  known: (n, of) => `${n}/${of} conocidas`,
  heldKnown: (held, known) => (held === null ? `${known} conocidas` : `${held} en su álbum · ${known} conocidas`),
  heldKnownTitle: (stored) =>
    stored
      ? 'En su álbum: casillas llenas, según la clasificación. Conocidas: cartas de página vistas en movimientos públicos.'
      : 'Cartas de página vistas en movimientos públicos. Las casillas llenas de la clasificación aún no se guardan.',
  probable: 'probablemente completa',
  probableTitle: (known, of, complete, seen) => `${known}/${of} vistas. La clasificación cuenta ${plural(complete, 'página completa', 'páginas completas')}, los movimientos públicos muestran ${seen}: es una de las más probables.`,
  unknownProbable: 'sin ver: probablemente la tiene (la página está probablemente completa)',
  holdsNeed: (n) => (n === 1 ? '1 carta que nos falta' : `${n} cartas que nos faltan`),
  unknown: 'sin ver: puede tenerla',
  needed: 'nos falta',
  legendKnown: 'vista en su poder',
  legendUnknown: '? = la tenga o no, nunca vista en movimientos públicos',
  legendNeed: 'una carta que nos falta',
  noTeam: 'Todavía no hay lectura de la clasificación.',
  invite: 'Invítalos a nuestro market',
  inviteSub: 'cartas que tenemos listadas y le faltan a cada rival — véndeles nuestro puesto de 0 % (solo movimientos públicos: "quizá le falte")',
  inviteEmpty: 'Nada que ofrecer aún: ninguna carta que listamos encaja con una página incompleta de un rival, o no tenemos asks en nuestro puesto.',
  inviteChasing: 'ya va a por una',
  inviteCount: (cards) => `${plural(cards, 'carta', 'cartas')} que quizá le falten`,
  inviteVenue: (name, id) => `en ${name} (${id})`,
  inviteMsg: (team, cards, venue) => `${team}: tenemos ${cards} listadas en nuestro market — ${venue}, 0 % de comisión (frente al 5 % + 1 P de El Rastro). Venid a completar vuestras páginas.`,
  inviteCardAt: (card, price) => (price == null ? card : `${card} (${price} P)`),
  inviteCopy: 'Copiar mensaje',
  inviteCopied: 'Copiado',
}

export const RIVAL_STRINGS: Readonly<Record<Lang, RivalStrings>> = { es: ES, en: EN }

export function useRivalStrings(): RivalStrings {
  return RIVAL_STRINGS[useLang()]
}
