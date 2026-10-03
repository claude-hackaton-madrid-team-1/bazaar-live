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
  readonly album: (team: string) => string
  readonly albumSub: (cards: number) => string
  readonly albumHead: (rank: number, score: number, pages: number | null) => string
  readonly known: (n: number, of: number) => string
  readonly holdsNeed: (n: number) => string
  readonly unknown: string
  readonly needed: string
  readonly legendKnown: string
  readonly legendUnknown: string
  readonly legendNeed: string
  readonly noTeam: string
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
  album: (team) => `${team}'s album`,
  albumSub: (cards) => `${plural(cards, 'card', 'cards')} seen in public moves; the rest unknown`,
  albumHead: (rank, score, pages) => `#${rank} · ${score.toFixed(1)} points${pages == null ? '' : ` · ${plural(pages, 'complete page', 'complete pages')}`}`,
  known: (n, of) => `${n}/${of} known`,
  holdsNeed: (n) => `${plural(n, 'card', 'cards')} we need`,
  unknown: 'not seen: it may hold it',
  needed: 'we need it',
  legendKnown: 'seen holding it',
  legendUnknown: 'unknown',
  legendNeed: 'a card we need',
  noTeam: 'No leaderboard read yet.',
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
  album: (team) => `Álbum de ${team}`,
  albumSub: (cards) => `${plural(cards, 'carta vista', 'cartas vistas')} en movimientos públicos; el resto, desconocido`,
  albumHead: (rank, score, pages) => `#${rank} · ${score.toFixed(1).replace('.', ',')} puntos${pages == null ? '' : ` · ${plural(pages, 'página completa', 'páginas completas')}`}`,
  known: (n, of) => `${n}/${of} conocidas`,
  holdsNeed: (n) => (n === 1 ? '1 carta que nos falta' : `${n} cartas que nos faltan`),
  unknown: 'sin ver: puede tenerla',
  needed: 'nos falta',
  legendKnown: 'vista en su poder',
  legendUnknown: 'desconocida',
  legendNeed: 'una carta que nos falta',
  noTeam: 'Todavía no hay lectura de la clasificación.',
}

export const RIVAL_STRINGS: Readonly<Record<Lang, RivalStrings>> = { es: ES, en: EN }

export function useRivalStrings(): RivalStrings {
  return RIVAL_STRINGS[useLang()]
}
