/**
 * The words of the game screens, in the page's language. Lines built from the events themselves
 * (an agent's thought, "bid 12 P to t05 for LAV-03") come as the agent and the game wrote them.
 */
import type { Lang } from '../../shared/lang.ts'
import type { Route } from '../ui/route'
import { useLang } from '../ui/lang'
import type { GameStatus } from './store.ts'
import type { Lane } from './views/agent.ts'
import type { DecisionStatus } from '../../shared/decisions.ts'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface GameStrings {
  readonly nav: Readonly<Record<Route, string>>
  readonly navHint: Readonly<Record<Route, string>>
  readonly navLabel: string
  readonly brandTag: string
  readonly status: Readonly<Record<GameStatus, string>>
  readonly source: { readonly db: string; readonly api: string; readonly dbTitle: string; readonly apiTitle: string }
  readonly notice: { readonly off: string; readonly locked: string; readonly mock: string; readonly noTeam: string; readonly tryMock: string }
  readonly day: string
  readonly tick: string
  readonly secondsLeft: (s: number) => string
  readonly cash: string
  /** The header's cash: where a click goes, and the last change. */
  readonly cashHint: string
  readonly cashLast: (delta: string, tick: number) => string
  readonly score: string
  readonly rank: string
  readonly pause: string
  readonly resume: string
  readonly pauseTitle: string
  readonly phases: Readonly<Record<'observe' | 'decide' | 'act', string>>
  readonly lanes: Readonly<Record<Lane, string>>
  readonly agent: {
    readonly now: string
    readonly loop: string
    readonly goal: string
    readonly noGoal: string
    readonly why: string
    readonly did: string
    readonly noReasoning: string
    readonly noAction: string
    readonly openThreads: string
    readonly ourTrades: string
    readonly gained: string
    readonly timeline: string
    readonly timelineSub: string
    readonly filters: Readonly<Record<'all' | 'actions' | 'deals', string>>
    readonly show: string
    readonly follow: string
    readonly followTitle: string
    readonly newer: (n: number) => string
    readonly waiting: string
    readonly nothingKind: string
    readonly now_: string
    readonly deals: (n: number) => string
  }
  /** Our agents' decisions (agent.decision / agent.outcome / agent.ledger). Agent names and rule ids stay as the agents write them. */
  readonly decide: {
    readonly idle: (agents: readonly { readonly agent: string; readonly last: number | null }[]) => string
    /** A run of the same refusal, folded into one row. */
    readonly run: (n: number, from: number, to: number) => string
    /** A decision kind as the page names it: the agents' own id, except a deploy restart. */
    readonly kind: (kind: string) => string
    /** "Now" from the agents' decisions: what it went for, why, and what it sent. */
    readonly goal: (agent: string, kind: string, item: string | null, counterparty: string | null) => string
    readonly did: (agent: string, method: string, item: string | null, price: string | null) => string
    readonly status: Readonly<Record<DecisionStatus, string>>
    readonly allowed: string
    readonly noCheck: string
    readonly blockedBy: string
    readonly jev: string
    readonly error: (code: string) => string
    readonly blocks: string
    readonly blocksSub: (fromTick: number) => string
    readonly noBlocks: string
    readonly times: (n: number) => string
    readonly ledger: string
    readonly ledgerSub: string
    readonly spent: string
    readonly cashFloor: string
    readonly accepts: string
    readonly headroom: (p: string) => string
    readonly noLedger: string
    readonly deals: string
    readonly dealsSub: string
    readonly noDeals: string
    readonly beat: string
    readonly even: string
    readonly below: string
    readonly unscored: string
    readonly noValue: string
    readonly jevRight: string
    readonly jevWrong: string
    readonly target: Readonly<Record<'trade' | 'dealer' | 'duel', string>>
  }
  readonly badge: {
    readonly final: string
    readonly injection: string
    readonly injectionTitle: string
    readonly expired: string
    readonly expiredTitle: string
    readonly expiresTitle: string
    readonly closed: string
    readonly buy: string
    readonly sell: string
    readonly complete: string
    readonly master: string
    readonly ours: string
    readonly market: string
  }
  readonly neg: {
    readonly threads: string
    readonly threadsSub: (open: number, closed: number) => string
    readonly ourThreads: string
    readonly conversation: string
    readonly with: (id: number, who: string) => string
    readonly noThreads: string
    readonly noThread: string
    readonly noOffers: string
    readonly their: (label: string) => string
    readonly our: (label: string) => string
    readonly ask: string
    readonly bid: string
    readonly gap: string
    readonly rounds: string
    readonly roundsAxis: string
    readonly last: (id: number) => string
    readonly we: string
    readonly railLabel: (id: number) => string
    readonly convoLabel: (id: number) => string
    readonly duels: string
    readonly duelsSub: (live: number) => string
    readonly noDuels: string
    readonly duelHead: readonly string[]
    readonly duelStatus: Readonly<Record<'open' | 'deal' | 'no deal', string>>
    readonly against: string
    readonly unknownRival: string
    readonly rivalDuels: (duels: number, finished: number) => string
    readonly ticksLeft: (ticks: number) => string
    readonly rivalDeals: (deals: number, noDeals: number) => string
    readonly rivalPoints: (points: number | null) => string
    readonly rivalPointsNone: string
  }
  readonly album: {
    readonly album: string
    readonly score: string
    readonly snapshots: (n: number) => string
    readonly closest: string
    readonly setOrder: string
    readonly waiting: string
    readonly pagesComplete: string
    readonly masters: (n: number) => string
    readonly missingSlots: string
    readonly slotsToFill: string
    readonly duplicates: string
    readonly noneSpare: string
    readonly cheapest: string
    readonly nothingMissing: string
    readonly book: string
    readonly worth: string
    readonly worthFoot: string
    readonly copies: (n: number) => string
    readonly sparesFoot: (market: string) => string
    readonly cashFoot: (total: string) => string
    readonly cashPlain: string
    readonly moves: string
    readonly movesSub: string
    readonly movesNote: string
    readonly buyNext: string
    readonly buyHint: string
    readonly buyHow: (gain: string, where: string) => string
    readonly noBuy: string
    readonly sell: string
    readonly sellHint: string
    readonly sellHow: (lose: string, where: string) => string
    readonly spareOf: (n: number) => string
    readonly lowSet: string
    readonly noSell: string
    readonly closestPages: string
    readonly pagesHint: string
    readonly needs: (cards: string) => string
    readonly pays: (gain: string, bonus: string, cost: string) => string
    readonly noPages: string
    readonly completes: Readonly<Record<'page' | 'master', string>>
    /** Where a price comes from: a board's offer (at a venue), the last trade, or book. */
    readonly where: Readonly<Record<'board' | 'tape' | 'book', (side: 'ask' | 'bid', venue: string) => string>>
    readonly affTitle: string
    readonly pageWorth: (worth: string, bonus: string) => string
    readonly pageEarned: (worth: string, bonus: string) => string
    readonly valueLegend: string
    readonly tiers: readonly [string, string, string, string]
    readonly rarityLegend: string
    readonly buyLegend: string
    readonly sellLegend: string
    readonly gridSub: string
    readonly howValue: string
    readonly scoreDetails: string
    readonly total: string
    readonly dealsCount: (n: number) => string
    readonly parts: Readonly<Record<'duel_points' | 'ladder_points' | 'neg_points' | 'mm_points' | 'bench_points', string>>
    readonly packs: string
    readonly noPacks: string
    readonly packsFoot: (kinds: number) => string
    readonly rarity: Readonly<Record<string, string>>
    readonly missing: string
    readonly spare: string
    readonly over: (label: string, n: number) => string
  }
  readonly market: {
    readonly now: string
    readonly nowSub: (buy: number, sell: number) => string
    readonly untakenSub: (n: number) => string
    readonly buy: string
    readonly sell: string
    readonly buyHint: string
    readonly sellHint: string
    readonly noBuy: string
    readonly noSell: string
    readonly overCash: (n: number, cash: string) => string
    readonly pay: string
    readonly get: string
    readonly worth: string
    readonly estimated: string
    readonly netTitle: string
    readonly completes: Readonly<Record<'page' | 'master', string>>
    readonly completesTitle: string
    readonly need: Readonly<Record<'missing' | 'spare' | 'unneeded' | 'held', string>>
    readonly forUs: string
    readonly forUsTitle: string
    readonly more: (n: number) => string
    readonly expiresIn: (ticks: number, minutes: number | null) => string
    readonly from: (maker: string, venue: string) => string
    readonly untaken: (age: number) => string
    readonly agentSaid: (agent: string, status: string, rule: string | null) => string
    readonly noAgent: string
    readonly ourOffers: string
    readonly ourOffersSub: (n: number) => string
    readonly weSell: string
    readonly weBuy: string
    readonly bestPrice: string
    readonly alone: string
    readonly beatenBy: (p: string) => string
    readonly ourHead: readonly string[]
    readonly ourPrices: string
    readonly ourPricesSub: (traded: number, untraded: number) => string
    readonly noOurPrices: string
    readonly priceHead: readonly string[]
    readonly showAll: string
    readonly hideAll: string
    readonly allSub: (offers: number, trades: number, venues: number) => string
    readonly tape: string
    readonly tapeSub: (n: number, volume: number) => string
    readonly which: string
    readonly others: string
    readonly all: string
    readonly search: string
    readonly searchLabel: string
    readonly noTrades: string
    readonly tapeHead: readonly string[]
    readonly noBook: string
    readonly bookPrice: (p: string) => string
    readonly book: string
    readonly bookSub: (offers: number, venues: number) => string
    readonly noOffers: string
    readonly bookHead: readonly string[]
    readonly offers: (n: number) => string
    readonly oursCount: (n: number) => string
    readonly age: (n: number) => string
    readonly venues: string
    readonly venuesSub: (open: number) => string
    readonly noVenues: string
    readonly venueStatus: Readonly<Record<'open' | 'closing' | 'closed', string>>
    readonly fee: (bps: number | null, perCard: number | null) => string
  }
  readonly debug: {
    readonly stream: string
    readonly sub: (shown: string, scanned: number, ours: boolean) => string
    readonly of: (a: number, b: number) => string
    readonly source: string
    readonly sources: Readonly<Record<'ours' | 'market' | 'all', string>>
    readonly family: string
    readonly clear: string
    readonly search: string
    readonly unknownOnly: string
    readonly noEvents: string
    readonly head: readonly string[]
    readonly notKnown: string
    readonly stats: Readonly<Record<'window' | 'mine' | 'last' | 'perTick' | 'unknown' | 'types', string>>
    readonly perTick: (avg: string, last: number) => string
  }
  readonly inspector: { readonly label: string; readonly copy: string; readonly close: string; readonly evicted: string; readonly inspect: string }
  readonly learn: {
    readonly notice: Readonly<Record<'loading' | 'off' | 'locked' | 'error' | 'mock', string>>
    readonly missing: string
    readonly asOf: (time: string) => string
    readonly search: string
    readonly searchLabel: string
    readonly inForce: string
    readonly inForceSub: (n: number, lifted: number) => string
    readonly noneInForce: string
    readonly lifts: (n: number) => string
    readonly liftsUnknown: string
    readonly forUs: string
    readonly forAll: string
    readonly lessons: string
    readonly lessonsSub: (n: number) => string
    readonly noLessons: string
    readonly facts: string
    readonly factsSub: (n: number) => string
    readonly noFacts: string
    readonly support: (n: number) => string
    readonly confidence: string
    readonly kinds: Readonly<Record<string, string>>
    readonly sources: Readonly<Record<string, string>>
    readonly dealers: string
    readonly dealersSub: (n: number) => string
    readonly noDealers: string
    readonly dealerHead: readonly string[]
    readonly dealerHint: Readonly<Record<'fill' | 'ourFill' | 'firm' | 'concession', string>>
    readonly moves: string
    readonly movesSub: (n: number) => string
    readonly noMoves: string
    readonly moveHead: readonly string[]
    readonly which: string
    readonly ours: string
    readonly all: string
    readonly us: string
    readonly feed: string
    readonly events: Readonly<Record<string, string>>
    readonly rivals: string
    readonly rivalsSub: (n: number) => string
    readonly noRivals: string
    readonly rivalHead: readonly string[]
  }
  readonly history: {
    readonly notice: Readonly<Record<'loading' | 'off' | 'locked' | 'error' | 'mock', string>>
    readonly missing: string
    readonly asOf: (time: string) => string
    readonly now: string
    readonly nowSub: (tick: number | null) => string
    readonly stats: Readonly<Record<'open' | 'low' | 'high' | 'in' | 'out' | 'fees' | 'trades', string>>
    readonly tradesValue: (buys: number, sells: number) => string
    readonly chart: string
    readonly chartSub: (n: number) => string
    readonly chartLabel: (low: string, high: string, now: string) => string
    readonly noChart: string
    readonly moves: string
    readonly movesSub: (n: number) => string
    readonly noMoves: string
    readonly filter: string
    readonly filters: Readonly<Record<'all' | 'in' | 'out', string>>
    readonly head: readonly string[]
    readonly line: {
      readonly buy: (card: string, from: string, fee: number) => string
      readonly sell: (card: string, to: string) => string
      readonly bond: (venue: string, bond: number | null) => string
      readonly gift: string
      readonly pack: (pack: string, best: string | null) => string
      readonly level: (level: number | null, why: string | null) => string
      readonly failed: string
      readonly closed: (venue: string) => string
      readonly other: string
    }
    readonly before: string
    readonly pending: string
    readonly orders: string
    readonly ordersSub: (n: number) => string
    readonly noOrders: string
    readonly ordersHead: readonly string[]
    readonly agent: string
    readonly allAgents: string
  }
}

const EN: GameStrings = {
  nav: { show: 'Show', agent: 'Agent', negotiations: 'Negotiations', album: 'Album', market: 'Market', history: 'Movements', learn: 'Learned', debug: 'Debug' },
  navHint: {
    show: 'the buyer and the seller, out loud',
    agent: 'what our agent is doing, tick by tick',
    negotiations: 'our threads and duels',
    album: 'pages and score',
    market: 'everyone else',
    history: 'our cash and every movement of it',
    learn: 'what our agents learned: blockers, lessons, dealers, rivals',
    debug: 'the raw event stream',
  },
  navLabel: 'Screens',
  brandTag: 'our agent, tick by tick',
  status: { connecting: 'CONNECTING', live: 'LIVE', reconnecting: 'RECONNECTING', off: 'NO FEED', locked: 'LOCKED', mock: 'MOCK GAME' },
  source: { db: 'DB', api: 'GAME API', dbTitle: 'Read from our database, where our agents record the game', apiTitle: 'Read from the game\'s API with the team key' },
  notice: {
    off: 'The server has no team key (BAZAAR_KEY), so the game screens have no feed. Want a preview? Try',
    locked: 'This view is private: open it with ?token=… (the GAME_VIEW_TOKEN of the server).',
    mock: 'Mock game: a made-up match on a loop, our agent included. Drop ?mock=1 for the real game.',
    noTeam: 'The key cannot read /me, so nothing here is ours yet: Market and Debug show the whole game.',
    tryMock: '?mock=1',
  },
  day: 'day',
  tick: 'tick',
  secondsLeft: (s) => `${s} s to the next tick`,
  cash: 'cash',
  cashHint: 'our cash now · every movement of it in Movements',
  cashLast: (delta, tick) => `${delta} at tick ${tick}`,
  score: 'score',
  rank: 'rank',
  pause: 'Pause',
  resume: 'Resume',
  pauseTitle: 'Freeze the view (the feed keeps up underneath)',
  phases: { observe: 'observe', decide: 'decide', act: 'act' },
  lanes: { observe: 'Observe', decide: 'Decide', act: 'Act', result: 'Result' },
  agent: {
    now: 'Now',
    loop: 'Agent loop',
    goal: 'Goal',
    noGoal: 'no goal yet',
    why: 'Why',
    did: 'Did',
    noReasoning: 'no reasoning yet',
    noAction: 'no action yet',
    openThreads: 'Open threads',
    ourTrades: 'Our trades',
    gained: 'Value gained',
    timeline: 'Timeline',
    timelineSub: 'our agent only, newest tick first',
    filters: { all: 'All', actions: 'Actions', deals: 'Deals' },
    show: 'Show',
    follow: 'Follow live',
    followTitle: 'When off, the timeline stays on the ticks it has now',
    newer: (n) => `${plural(n, 'newer tick', 'newer ticks')} ↑`,
    waiting: "Waiting for our agent's first tick",
    nothingKind: 'Nothing of this kind yet',
    now_: 'now',
    deals: (n) => plural(n, 'deal', 'deals'),
  },
  decide: {
    idle: (agents) => `no decision this tick: ${agents.map(({ agent, last }) => `${agent}${last != null ? ` (last at tick ${last})` : ''}`).join(', ')}`,
    run: (n, from, to) => `×${n}, ticks ${from}–${to}`,
    kind: (kind) => (kind === 'process_started' ? 'restart (deploy)' : kind),
    goal: (agent, kind, item, counterparty) => `${agent}: ${kind}${item ? ` ${item}` : ''}${counterparty ? ` · ${counterparty}` : ''}`,
    did: (agent, method, item, price) => `${agent}: ${method}${item ? ` ${item}` : ''}${price ? ` at ${price}` : ''}`,
    status: { proposed: 'proposed', approved: 'approved', rejected: 'rejected', claimed: 'claimed', done: 'done', failed: 'failed', expired: 'expired' },
    allowed: 'guardrails ok',
    noCheck: 'no guardrail check',
    blockedBy: 'blocked by',
    jev: 'Jev',
    error: (code) => `error ${code}`,
    blocks: 'Blocks by rule',
    blocksSub: (fromTick) => `last game hour, since tick ${fromTick}`,
    noBlocks: 'No guardrail blocked anything in the last game hour.',
    times: (n) => `${n}×`,
    ledger: 'Ledger',
    ledgerSub: 'against GUARDRAILS.md',
    spent: 'Spent this game hour',
    cashFloor: 'Cash / floor',
    accepts: 'Accepts this tick',
    headroom: (p) => `the next purchase may cost up to ${p}`,
    noLedger: 'No ledger yet. It comes from db/agent_decisions.sql.',
    deals: 'Deals vs our value',
    dealsSub: 'settled and scored, newest first',
    noDeals: 'No settled deal scored yet.',
    beat: 'beat our value',
    even: 'at our value',
    below: 'below our value',
    unscored: 'not scored yet',
    noValue: 'no value',
    jevRight: 'Jev right',
    jevWrong: 'Jev wrong',
    target: { trade: 'trade', dealer: 'dealer', duel: 'duel' },
  },
  badge: {
    final: 'FINAL',
    injection: 'INJECTION?',
    injectionTitle: 'The counterparty text carries instructions: only the structured offer counts',
    expired: 'expired',
    expiredTitle: 'The offer has expired',
    expiresTitle: 'Ticks until the last offer expires',
    closed: 'closed',
    buy: 'BUY',
    sell: 'SELL',
    complete: 'COMPLETE',
    master: 'MASTER',
    ours: 'OURS',
    market: 'MARKET',
  },
  neg: {
    threads: 'Threads',
    threadsSub: (open, closed) => `${open} open · ${closed} closed`,
    ourThreads: 'Our threads',
    conversation: 'Conversation',
    with: (id, who) => `#${id} with ${who}`,
    noThreads: 'No threads yet.',
    noThread: 'No thread selected. Our threads show up here as soon as the agent opens one.',
    noOffers: 'No offers yet.',
    their: (label) => `their ${label}`,
    our: (label) => `our ${label}`,
    ask: 'ask',
    bid: 'bid',
    gap: 'gap',
    rounds: 'rounds',
    roundsAxis: 'rounds →',
    last: (id) => `last #${id}`,
    we: 'we',
    railLabel: (id) => `Price rail of thread ${id}`,
    convoLabel: (id) => `Conversation in thread ${id}`,
    duels: 'Duels',
    duelsSub: (live) => `${live} live`,
    noDuels: 'No duels yet.',
    duelHead: ['duel', 'rival', 'role', 'us', 'them', 'gap', 'rounds', 'status', 'deal', 'points', 'event'],
    duelStatus: { open: 'open', deal: 'deal', 'no deal': 'no deal' },
    against: 'Dueling against',
    unknownRival: 'unknown rival',
    rivalDuels: (n, done) => `${n} ${n === 1 ? 'duel' : 'duels'} · ${done} finished`,
    ticksLeft: (n) => (n === 0 ? 'ends this tick' : `${n} ${n === 1 ? 'tick' : 'ticks'} left`),
    rivalDeals: (deals, none) => `${deals} ${deals === 1 ? 'deal' : 'deals'} · ${none} no deal`,
    rivalPoints: (p) => (p == null ? 'pts —' : p === 0 ? '0 pts' : `${p > 0 ? '+' : '−'}${Math.abs(p)} pts`),
    rivalPointsNone: 'No points recorded for these duels (our database does not keep them)',
  },
  album: {
    album: 'Album',
    score: 'Score',
    snapshots: (n) => plural(n, 'snapshot', 'snapshots'),
    closest: 'Closest',
    setOrder: 'Set order',
    waiting: 'Waiting for agent.me',
    pagesComplete: 'Pages complete',
    masters: (n) => `${n} master`,
    missingSlots: 'Missing slots',
    slotsToFill: 'page slots still to fill',
    duplicates: 'Duplicates to sell',
    noneSpare: 'none spare',
    cheapest: 'Cheapest missing',
    nothingMissing: 'nothing missing',
    book: 'book',
    worth: 'Album worth to us',
    worthFoot: 'every copy at book × our multiplier, page bonuses included',
    copies: (n) => plural(n, 'copy', 'copies'),
    sparesFoot: (market) => `worth this to us · ~${market} at market`,
    cashFoot: (total) => `~${total} with the spares sold`,
    cashPlain: 'to spend',
    moves: 'Best next moves',
    movesSub: 'ranked by surplus at our values',
    movesNote: 'Only trade surplus scores: what a card is worth to us minus what we pay, or what we get minus what it was worth. A complete page adds 25 % of its value (the epic and legendary 10 % more) but scores nothing by itself. ~ = book price (nobody has offered or traded it) or a guessed multiplier.',
    buyNext: 'Buy next',
    buyHint: 'missing cards cheaper than they are worth',
    buyHow: (gain, where) => `worth ${gain} · ${where}`,
    noBuy: 'Nothing on offer beats what it is worth to us.',
    sell: 'Sell',
    sellHint: 'copies the market pays more for',
    sellHow: (lose, where) => `we lose ${lose} · ${where}`,
    spareOf: (n) => `spare of ×${n}`,
    lowSet: 'only copy, low set',
    noSell: 'No spare copy fetches more than it is worth to us.',
    closestPages: 'Closest pages',
    pagesHint: 'one or two cards from the bonus',
    needs: (cards) => `needs ${cards}`,
    pays: (gain, bonus, cost) => `pays ${gain} (bonus ${bonus}) for ${cost}`,
    noPages: 'No page is one or two cards from done.',
    completes: { page: 'completes the page', master: 'completes the master' },
    where: {
      board: (side, venue) => `${side === 'ask' ? 'ask' : 'bid'} on ${venue}`,
      tape: () => 'last trade',
      book: () => 'book',
    },
    affTitle: 'Our multiplier for this set: a card is worth book × this to us',
    pageWorth: (worth, bonus) => `${worth} to us · +${bonus} at 10/10`,
    pageEarned: (worth, bonus) => `${worth} to us · bonus ${bonus} earned`,
    valueLegend: 'Worth to us',
    tiers: ['< 10 P', '10–30', '30–80', '80+'],
    rarityLegend: 'Rarity',
    buyLegend: 'buy: + net P',
    sellLegend: 'sell a copy',
    gridSub: 'number = worth to us in P',
    howValue: 'How value is counted',
    scoreDetails: 'Score breakdown',
    total: 'total',
    dealsCount: (n) => plural(n, 'deal', 'deals'),
    parts: { duel_points: 'Duels', ladder_points: 'Ladder', neg_points: 'Negotiation', mm_points: 'Market-making', bench_points: 'Bench' },
    packs: 'Sealed packs',
    noPacks: 'none sealed',
    packsFoot: (kinds) => plural(kinds, 'kind', 'kinds'),
    rarity: { common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic', legendary: 'legendary' },
    missing: 'missing',
    spare: '×2 spare copies',
    over: (label, n) => `${label} over ${plural(n, 'snapshot', 'snapshots')}`,
  },
  market: {
    now: 'Right now for us',
    nowSub: (buy, sell) => `${plural(buy, 'buy', 'buys')} · ${plural(sell, 'sell', 'sells')}`,
    untakenSub: (n) => `${n} left untaken`,
    buy: 'Buy',
    sell: 'Sell',
    buyHint: 'asks for cards we miss, under what they are worth to us',
    sellHint: 'bids for our spares, at or over our value',
    noBuy: 'No ask under our value for a card we miss.',
    noSell: 'No bid at or over our value for a spare.',
    overCash: (n, cash) => `${plural(n, 'more card is', 'more cards are')} under our value but over our cash (${cash}).`,
    pay: 'pay',
    get: 'get',
    worth: 'worth',
    estimated: 'Estimated: we have no affinity for this set yet, so book × 1',
    netTitle: 'What we gain, before fees',
    completes: { page: 'completes the page', master: 'completes master' },
    completesTitle: 'Its value includes the bonus of the page it completes',
    need: { missing: 'missing', spare: 'spare', unneeded: 'no page', held: 'held' },
    forUs: 'for us',
    forUsTitle: 'Addressed to our team alone',
    more: (n) => `+${n} more`,
    expiresIn: (ticks, minutes) => (ticks <= 0 ? 'expires now' : `expires in ${ticks}t${minutes == null ? '' : ` · ~${minutes} min`}`),
    from: (maker, venue) => `${maker} on ${venue}`,
    untaken: (age) => `Up for ${plural(age, 'tick', 'ticks')} and our agents have not taken it`,
    agentSaid: (agent, status, rule) => `${agent}: ${status}${rule ? ` · ${rule}` : ''}`,
    noAgent: 'no agent decision on this card',
    ourOffers: 'Our offers on the board',
    ourOffersSub: (n) => plural(n, 'open offer', 'open offers'),
    weSell: 'we sell',
    weBuy: 'we buy',
    bestPrice: 'best price',
    alone: 'only offer',
    beatenBy: (p) => `beaten by ${p}`,
    ourHead: ['', 'card', 'price', 'worth', 'venue', 'expires', 'vs others'],
    ourPrices: 'Prices of our cards',
    ourPricesSub: (traded, untraded) => `${plural(traded, 'card', 'cards')} traded · ${untraded} never traded`,
    noOurPrices: 'None of the cards we miss or hold has traded yet.',
    priceHead: ['card', 'worth to us', 'last', 'median', 'range'],
    showAll: 'Show all market activity',
    hideAll: 'Hide all market activity',
    allSub: (offers, trades, venues) => `${plural(offers, 'offer', 'offers')} · ${plural(trades, 'trade', 'trades')} · ${plural(venues, 'venue', 'venues')}`,
    tape: 'Market tape',
    tapeSub: (n, volume) => `${plural(n, 'trade', 'trades')} · ${volume} P`,
    which: 'Which trades',
    others: 'Others',
    all: 'All',
    search: 'team, card, venue',
    searchLabel: 'Filter trades',
    noTrades: 'No trades match yet.',
    tapeHead: ['tick', 'venue', 'seller → buyer', 'card', 'price', 'vs book', 'fee', ''],
    noBook: 'no book price',
    bookPrice: (p) => `book ${p}`,
    book: 'Order book',
    bookSub: (offers, venues) => `${plural(offers, 'open offer', 'open offers')} · ${plural(venues, 'venue', 'venues')}`,
    noOffers: 'No open offers on any board yet.',
    bookHead: ['card', 'best bid', 'best ask', 'bids / asks', 'book'],
    offers: (n) => plural(n, 'offer', 'offers'),
    oursCount: (n) => `${n} ours`,
    age: (n) => `listed ${plural(n, 'tick', 'ticks')} ago`,
    venues: 'Venues',
    venuesSub: (open) => `${open} open`,
    noVenues: 'No venue seen yet.',
    venueStatus: { open: 'open', closing: 'closing', closed: 'closed' },
    fee: (bps, perCard) => [bps ? `${bps / 100}%` : '', perCard ? `${perCard} P/card` : ''].filter(Boolean).join(' + ') || 'no fee',
  },
  debug: {
    stream: 'Event stream',
    sub: (shown, scanned, ours) => `${shown} shown · ${scanned} in ${ours ? 'ours' : 'the window'}`,
    of: (a, b) => `${a} of ${b}`,
    source: 'Source',
    sources: { ours: 'Ours', market: 'Market', all: 'All' },
    family: 'Type family',
    clear: 'clear',
    search: 'search type, actor, ids, JSON…',
    unknownOnly: 'unknown types only',
    noEvents: 'No events match these filters.',
    head: ['id', 'tick', 'type', 'actor', 'scope', 'source', 'summary'],
    notKnown: 'not a type the screens know',
    stats: { window: 'window', mine: 'ours kept', last: 'last', perTick: 'per tick', unknown: 'unknown', types: 'types' },
    perTick: (avg, last) => `${avg}/tick · last ${last}`,
  },
  inspector: { label: 'Event inspector', copy: 'Copy', close: 'Close', evicted: 'evicted', inspect: 'Inspect event' },
  learn: {
    notice: {
      loading: 'Reading what our agents learned…',
      off: 'No database: set SHOW_DATABASE_URL on the server and apply db/learn.sql to see what our agents learned.',
      locked: 'This screen needs ?token= (GAME_VIEW_TOKEN): it shows the team\'s private memory.',
      error: 'The server did not answer: showing the last snapshot read.',
      mock: 'Made-up learnings around the mock game. Remove ?mock=1 for our agents\' real memory.',
    },
    missing: 'not applied yet (db/learn.sql)',
    asOf: (time) => `read at ${time}`,
    search: 'dealer, team, claim…',
    searchLabel: 'Filter learnings',
    inForce: 'Blocking us now',
    inForceSub: (n, lifted) => `${plural(n, 'learning', 'learnings')}${lifted ? ` · ${lifted} lifted` : ''}`,
    noneInForce: 'Nothing is blocking a deal right now.',
    lifts: (n) => (n <= 0 ? 'lifts now' : `lifts in ${n}t`),
    liftsUnknown: 'until a tick',
    forUs: 'us',
    forAll: 'everyone',
    lessons: 'What our outcomes taught us',
    lessonsSub: (n) => `${plural(n, 'lesson', 'lessons')} · most confident first`,
    noLessons: 'No lesson yet: they come from settled, scored outcomes.',
    facts: 'Read from the feed',
    factsSub: (n) => `${plural(n, 'fact', 'facts')} · newest first`,
    noFacts: 'No fact read from the feed yet.',
    support: (n) => `${n} ×`,
    confidence: 'confidence',
    kinds: {
      blocker: 'blocked', cooloff: 'cooloff', quota: 'quota', sold_out: 'sold out', price_floor: 'price floor', behaviour: 'behaviour',
      rule_change: 'rule', fee_change: 'fee', announcement: 'notice', lesson: 'lesson', policy: 'policy', tactic: 'tactic',
    },
    sources: { rules: 'rules', llm: 'LLM', outcome: 'outcome' },
    dealers: 'How each dealer behaves',
    dealersSub: (n) => `${plural(n, 'dealer', 'dealers')} · curves of every team, moves of the last window`,
    noDealers: 'No dealer curve or move stored yet.',
    dealerHead: ['dealer', 'threads', 'deals', 'opening', 'fill', 'fill / open', 'ours', 'firm', 'concession', 'steps', 'last'],
    dealerHint: {
      fill: 'what a deal cost against her opening ask, every team: 100% = paid the opening',
      ourFill: 'the same, our threads only',
      firm: 'share of her priced answers that held or went final instead of conceding',
      concession: 'mean drop of her price on a concession',
    },
    moves: 'Dealer moves',
    movesSub: (n) => plural(n, 'move', 'moves'),
    noMoves: 'No dealer move matches.',
    moveHead: ['tick', 'dealer', 'thread', 'move', 'her price', 'our price', 'step', 'whose'],
    which: 'Whose threads',
    ours: 'Ours',
    all: 'All',
    us: 'ours',
    feed: 'feed',
    events: { open: 'opens', counter: 'counters', concede: 'concedes', hold: 'holds', final: 'final', walk: 'walks', deal: 'deal', cooloff: 'cooloff', lie_suspected: 'lie?' },
    rivals: 'Rivals',
    rivalsSub: (n) => `${plural(n, 'team', 'teams')} · most active first`,
    noRivals: 'No rival profile yet.',
    rivalHead: ['team', 'level', 'venue', 'bought', 'sold', 'spent', 'earned', 'chases', 'dealer deals', 'pack price', 'tick'],
  },
  history: {
    notice: {
      loading: 'Reading our cash…',
      off: 'No database: set SHOW_DATABASE_URL on the server and apply db/history.sql to see our cash and its movements.',
      locked: 'This screen needs ?token= (GAME_VIEW_TOKEN): it shows the team\'s cash and trades.',
      error: 'The server did not answer: showing the last snapshot read.',
      mock: 'A made-up day of money around the mock game. Remove ?mock=1 for our real cash.',
    },
    missing: 'not applied yet (db/history.sql)',
    asOf: (time) => `read at ${time}`,
    now: 'Cash now',
    nowSub: (tick) => (tick === null ? 'no reading yet' : `at tick ${tick}`),
    stats: { open: 'first today', low: 'lowest', high: 'highest', in: 'money in', out: 'money out', fees: 'fees paid', trades: 'trades' },
    tradesValue: (buys, sells) => `${buys} bought · ${sells} sold`,
    chart: 'Cash today',
    chartSub: (n) => `${plural(n, 'change', 'changes')} · tick by tick`,
    chartLabel: (low, high, now) => `Cash today: lowest ${low}, highest ${high}, now ${now}`,
    noChart: 'No reading of our cash yet today.',
    moves: 'Movements',
    movesSub: (n) => `${plural(n, 'movement', 'movements')} · newest first`,
    noMoves: 'No movement matches.',
    filter: 'Show',
    filters: { all: 'All', in: 'Money in', out: 'Money out' },
    head: ['tick', 'change', 'cash after', 'what moved it'],
    line: {
      buy: (card, from, fee) => `Bought ${card} from ${from}${fee ? ` (+${fee} P fee)` : ''}`,
      sell: (card, to) => `Sold ${card} to ${to}`,
      bond: (venue, bond) => `Opened our market ${venue}${bond ? `: a ${bond} P bond` : ''}`,
      gift: 'A gift',
      pack: (pack, best) => `Opened a pack (${pack})${best ? `, best card ${best}` : ''}`,
      level: (level, why) => `Level ${level ?? '?'} unlocked${why ? `: ${why}` : ''}`,
      failed: 'A settlement failed',
      closed: (venue) => `Market ${venue} closed`,
      other: 'Not from a trade we saw: a venue fee, a pack, a duel, a payout',
    },
    before: 'before we read cash',
    pending: 'not in the cash yet',
    orders: 'What our agents committed',
    ordersSub: (n) => `${plural(n, 'order', 'orders')} in the ledger · newest first`,
    noOrders: 'No order in the ledger yet.',
    ordersHead: ['tick', 'agent', 'order', 'card', 'price'],
    agent: 'Agent',
    allAgents: 'All',
  },
}

const ES: GameStrings = {
  nav: { show: 'Función', agent: 'Agente', negotiations: 'Negociaciones', album: 'Álbum', market: 'Mercado', history: 'Movimientos', learn: 'Aprendido', debug: 'Depurar' },
  navHint: {
    show: 'el comprador y el vendedor, en voz alta',
    agent: 'qué hace nuestro agente, turno a turno',
    negotiations: 'nuestros hilos y duelos',
    album: 'páginas y puntuación',
    market: 'todos los demás',
    history: 'nuestra caja y cada movimiento',
    learn: 'lo que aprendieron nuestros agentes: bloqueos, lecciones, tratantes, rivales',
    debug: 'el flujo de eventos en bruto',
  },
  navLabel: 'Pantallas',
  brandTag: 'nuestro agente, turno a turno',
  status: { connecting: 'CONECTANDO', live: 'EN VIVO', reconnecting: 'RECONECTANDO', off: 'SIN FEED', locked: 'BLOQUEADO', mock: 'PARTIDA FALSA' },
  source: { db: 'BD', api: 'API DEL JUEGO', dbTitle: 'Leído de nuestra base de datos, donde nuestros agentes registran la partida', apiTitle: 'Leído de la API del juego con la clave del equipo' },
  notice: {
    off: 'El servidor no tiene la clave del equipo (BAZAAR_KEY), así que las pantallas del juego no tienen feed. ¿Una vista previa? Prueba',
    locked: 'Esta vista es privada: ábrela con ?token=… (el GAME_VIEW_TOKEN del servidor).',
    mock: 'Partida falsa: un partido inventado en bucle, con nuestro agente dentro. Quita ?mock=1 para el juego real.',
    noTeam: 'La clave no puede leer /me, así que aún nada es nuestro: Mercado y Depurar muestran todo el juego.',
    tryMock: '?mock=1',
  },
  day: 'día',
  tick: 'turno',
  secondsLeft: (s) => `${s} s para el siguiente turno`,
  cash: 'caja',
  cashHint: 'nuestra caja ahora · cada movimiento en Movimientos',
  cashLast: (delta, tick) => `${delta} en el turno ${tick}`,
  score: 'puntos',
  rank: 'puesto',
  pause: 'Pausa',
  resume: 'Seguir',
  pauseTitle: 'Congela la vista (el feed sigue por debajo)',
  phases: { observe: 'observa', decide: 'decide', act: 'actúa' },
  lanes: { observe: 'Observa', decide: 'Decide', act: 'Actúa', result: 'Resultado' },
  agent: {
    now: 'Ahora',
    loop: 'Ciclo del agente',
    goal: 'Objetivo',
    noGoal: 'aún sin objetivo',
    why: 'Por qué',
    did: 'Hizo',
    noReasoning: 'aún sin razonamiento',
    noAction: 'aún sin acción',
    openThreads: 'Hilos abiertos',
    ourTrades: 'Nuestros tratos',
    gained: 'Valor ganado',
    timeline: 'Cronología',
    timelineSub: 'solo nuestro agente, el turno más reciente primero',
    filters: { all: 'Todo', actions: 'Acciones', deals: 'Tratos' },
    show: 'Mostrar',
    follow: 'Seguir en vivo',
    followTitle: 'Apagado, la cronología se queda en los turnos que tiene ahora',
    newer: (n) => `${plural(n, 'turno nuevo', 'turnos nuevos')} ↑`,
    waiting: 'Esperando el primer turno de nuestro agente',
    nothingKind: 'Aún nada de este tipo',
    now_: 'ahora',
    deals: (n) => plural(n, 'trato', 'tratos'),
  },
  decide: {
    idle: (agents) => `sin decisión este turno: ${agents.map(({ agent, last }) => `${agent}${last != null ? ` (la última en el turno ${last})` : ''}`).join(', ')}`,
    run: (n, from, to) => `×${n}, turnos ${from}–${to}`,
    kind: (kind) => (kind === 'process_started' ? 'reinicio (deploy)' : kind),
    goal: (agent, kind, item, counterparty) => `${agent}: ${kind}${item ? ` ${item}` : ''}${counterparty ? ` · ${counterparty}` : ''}`,
    did: (agent, method, item, price) => `${agent}: ${method}${item ? ` ${item}` : ''}${price ? ` a ${price}` : ''}`,
    status: { proposed: 'propuesta', approved: 'aprobada', rejected: 'rechazada', claimed: 'reservada', done: 'hecha', failed: 'fallida', expired: 'caducada' },
    allowed: 'límites ok',
    noCheck: 'sin control de límites',
    blockedBy: 'bloqueada por',
    jev: 'Jev',
    error: (code) => `error ${code}`,
    blocks: 'Bloqueos por regla',
    blocksSub: (fromTick) => `última hora de juego, desde el turno ${fromTick}`,
    noBlocks: 'Ningún límite ha bloqueado nada en la última hora de juego.',
    times: (n) => `${n}×`,
    ledger: 'Libro de gastos',
    ledgerSub: 'frente a GUARDRAILS.md',
    spent: 'Gastado esta hora de juego',
    cashFloor: 'Caja / suelo',
    accepts: 'Aceptaciones este turno',
    headroom: (p) => `la próxima compra puede costar hasta ${p}`,
    noLedger: 'Aún no hay libro. Llega de db/agent_decisions.sql.',
    deals: 'Tratos frente a nuestro valor',
    dealsSub: 'cerrados y puntuados, los últimos primero',
    noDeals: 'Aún no hay ningún trato puntuado.',
    beat: 'mejor que nuestro valor',
    even: 'igual que nuestro valor',
    below: 'por debajo de nuestro valor',
    unscored: 'sin puntuar',
    noValue: 'sin valor',
    jevRight: 'Jev acertó',
    jevWrong: 'Jev falló',
    target: { trade: 'compraventa', dealer: 'tratante', duel: 'duelo' },
  },
  badge: {
    final: 'FINAL',
    injection: '¿INYECCIÓN?',
    injectionTitle: 'El texto de la otra parte trae instrucciones: solo cuenta la oferta estructurada',
    expired: 'caducada',
    expiredTitle: 'La oferta ha caducado',
    expiresTitle: 'Turnos hasta que caduque la última oferta',
    closed: 'cerrado',
    buy: 'COMPRA',
    sell: 'VENTA',
    complete: 'COMPLETA',
    master: 'MAESTRA',
    ours: 'NUESTRO',
    market: 'MERCADO',
  },
  neg: {
    threads: 'Hilos',
    threadsSub: (open, closed) => `${open} abiertos · ${closed} cerrados`,
    ourThreads: 'Nuestros hilos',
    conversation: 'Conversación',
    with: (id, who) => `#${id} con ${who}`,
    noThreads: 'Aún no hay hilos.',
    noThread: 'Ningún hilo elegido. Nuestros hilos aparecen aquí en cuanto el agente abre uno.',
    noOffers: 'Aún no hay ofertas.',
    their: (label) => `su ${label}`,
    our: (label) => `nuestra ${label}`,
    ask: 'oferta',
    bid: 'puja',
    gap: 'distancia',
    rounds: 'rondas',
    roundsAxis: 'rondas →',
    last: (id) => `último #${id}`,
    we: 'nosotros',
    railLabel: (id) => `Precios del hilo ${id}`,
    convoLabel: (id) => `Conversación del hilo ${id}`,
    duels: 'Duelos',
    duelsSub: (live) => `${live} en curso`,
    noDuels: 'Aún no hay duelos.',
    duelHead: ['duelo', 'rival', 'papel', 'nosotros', 'ellos', 'distancia', 'rondas', 'estado', 'trato', 'puntos', 'evento'],
    duelStatus: { open: 'abierto', deal: 'trato', 'no deal': 'sin trato' },
    against: 'En duelo contra',
    unknownRival: 'rival desconocido',
    rivalDuels: (n, done) => `${n} ${n === 1 ? 'duelo' : 'duelos'} · ${done} ${done === 1 ? 'terminado' : 'terminados'}`,
    ticksLeft: (n) => (n === 0 ? 'acaba este turno' : `quedan ${n} ${n === 1 ? 'turno' : 'turnos'}`),
    rivalDeals: (deals, none) => `${deals} ${deals === 1 ? 'trato' : 'tratos'} · ${none} sin trato`,
    rivalPoints: (p) => (p == null ? 'pts —' : p === 0 ? '0 pts' : `${p > 0 ? '+' : '−'}${Math.abs(p)} pts`),
    rivalPointsNone: 'Sin puntos registrados para estos duelos (nuestra base de datos no los guarda)',
  },
  album: {
    album: 'Álbum',
    score: 'Puntuación',
    snapshots: (n) => plural(n, 'instantánea', 'instantáneas'),
    closest: 'Más cerca',
    setOrder: 'Por barrio',
    waiting: 'Esperando agent.me',
    pagesComplete: 'Páginas completas',
    masters: (n) => `${n} maestras`,
    missingSlots: 'Huecos por llenar',
    slotsToFill: 'huecos de página aún vacíos',
    duplicates: 'Repetidas para vender',
    noneSpare: 'ninguna repetida',
    cheapest: 'La que menos cuesta',
    nothingMissing: 'no falta nada',
    book: 'libro',
    worth: 'Lo que vale el álbum para nosotros',
    worthFoot: 'cada copia a libro × nuestro multiplicador, con los bonus de página',
    copies: (n) => plural(n, 'copia', 'copias'),
    sparesFoot: (market) => `esto valen para nosotros · ~${market} en el mercado`,
    cashFoot: (total) => `~${total} vendiendo las repetidas`,
    cashPlain: 'para gastar',
    moves: 'Mejores jugadas',
    movesSub: 'por excedente a nuestros valores',
    movesNote: 'Solo puntúa el excedente de un trato: lo que una carta vale para nosotros menos lo que pagamos, o lo que cobramos menos lo que valía. Una página completa suma el 25 % de su valor (la épica y la legendaria, un 10 % más), pero no puntúa por sí sola. ~ = precio de libro (nadie la ha ofrecido ni vendido) o un multiplicador supuesto.',
    buyNext: 'Comprar ahora',
    buyHint: 'cartas que faltan, más baratas de lo que valen',
    buyHow: (gain, where) => `vale ${gain} · ${where}`,
    noBuy: 'Nada a la venta supera lo que vale para nosotros.',
    sell: 'Vender',
    sellHint: 'copias que el mercado paga por encima',
    sellHow: (lose, where) => `perdemos ${lose} · ${where}`,
    spareOf: (n) => `repetida de ×${n}`,
    lowSet: 'única copia, barrio flojo',
    noSell: 'Ninguna repetida se paga por encima de lo que vale para nosotros.',
    closestPages: 'Páginas más cerca',
    pagesHint: 'a una o dos cartas del bonus',
    needs: (cards) => `falta ${cards}`,
    pays: (gain, bonus, cost) => `rinde ${gain} (bonus ${bonus}) por ${cost}`,
    noPages: 'Ninguna página está a una o dos cartas.',
    completes: { page: 'completa la página', master: 'completa la maestra' },
    where: {
      board: (side, venue) => `${side === 'ask' ? 'venta' : 'compra'} en ${venue}`,
      tape: () => 'último trato',
      book: () => 'libro',
    },
    affTitle: 'Nuestro multiplicador de este barrio: una carta vale libro × esto para nosotros',
    pageWorth: (worth, bonus) => `${worth} para nosotros · +${bonus} al 10/10`,
    pageEarned: (worth, bonus) => `${worth} para nosotros · bonus ${bonus} ganado`,
    valueLegend: 'Vale para nosotros',
    tiers: ['< 10 P', '10–30', '30–80', '80+'],
    rarityLegend: 'Rareza',
    buyLegend: 'comprar: + neto P',
    sellLegend: 'vender una copia',
    gridSub: 'número = lo que vale para nosotros en P',
    howValue: 'Cómo se cuenta el valor',
    scoreDetails: 'Desglose de la puntuación',
    total: 'total',
    dealsCount: (n) => plural(n, 'trato', 'tratos'),
    parts: { duel_points: 'Duelos', ladder_points: 'Escalera', neg_points: 'Negociación', mm_points: 'Creación de mercado', bench_points: 'Banco de pruebas' },
    packs: 'Sobres cerrados',
    noPacks: 'ninguno cerrado',
    packsFoot: (kinds) => plural(kinds, 'tipo', 'tipos'),
    rarity: { common: 'común', uncommon: 'poco común', rare: 'rara', epic: 'épica', legendary: 'legendaria' },
    missing: 'falta',
    spare: '×2 copias repetidas',
    over: (label, n) => `${label} en ${plural(n, 'instantánea', 'instantáneas')}`,
  },
  market: {
    now: 'Ahora mismo para nosotros',
    nowSub: (buy, sell) => `${plural(buy, 'compra', 'compras')} · ${plural(sell, 'venta', 'ventas')}`,
    untakenSub: (n) => `${n} sin aprovechar`,
    buy: 'Comprar',
    sell: 'Vender',
    buyHint: 'ofertas de cartas que nos faltan, por debajo de lo que valen para nosotros',
    sellHint: 'pujas por nuestras repes, a nuestro valor o más',
    noBuy: 'Ninguna oferta por debajo de nuestro valor para una carta que nos falte.',
    noSell: 'Ninguna puja a nuestro valor o más por una repe.',
    overCash: (n, cash) => `${plural(n, 'carta más está', 'cartas más están')} por debajo de nuestro valor pero por encima de nuestra caja (${cash}).`,
    pay: 'pagar',
    get: 'cobrar',
    worth: 'vale',
    estimated: 'Estimado: aún no sabemos nuestra afinidad por este barrio, así que libro × 1',
    netTitle: 'Lo que ganamos, antes de comisiones',
    completes: { page: 'completa la página', master: 'completa el máster' },
    completesTitle: 'Su valor incluye el bonus de la página que completa',
    need: { missing: 'falta', spare: 'repe', unneeded: 'sin página', held: 'tenemos' },
    forUs: 'para nosotros',
    forUsTitle: 'Dirigida solo a nuestro equipo',
    more: (n) => `+${n} más`,
    expiresIn: (ticks, minutes) => (ticks <= 0 ? 'caduca ya' : `caduca en ${ticks}t${minutes == null ? '' : ` · ~${minutes} min`}`),
    from: (maker, venue) => `${maker} en ${venue}`,
    untaken: (age) => `Lleva ${plural(age, 'turno', 'turnos')} y nuestros agentes no la han cogido`,
    agentSaid: (agent, status, rule) => `${agent}: ${status}${rule ? ` · ${rule}` : ''}`,
    noAgent: 'ningún agente ha decidido sobre esta carta',
    ourOffers: 'Nuestras ofertas en los puestos',
    ourOffersSub: (n) => plural(n, 'oferta abierta', 'ofertas abiertas'),
    weSell: 'vendemos',
    weBuy: 'compramos',
    bestPrice: 'mejor precio',
    alone: 'única',
    beatenBy: (p) => `superada por ${p}`,
    ourHead: ['', 'carta', 'precio', 'vale', 'puesto', 'caduca', 'frente a otros'],
    ourPrices: 'Precios de nuestras cartas',
    ourPricesSub: (traded, untraded) => `${plural(traded, 'carta con tratos', 'cartas con tratos')} · ${untraded} sin tratos`,
    noOurPrices: 'Aún no se ha vendido ninguna carta que nos falte o tengamos.',
    priceHead: ['carta', 'nos vale', 'último', 'mediana', 'rango'],
    showAll: 'Ver toda la actividad del mercado',
    hideAll: 'Ocultar la actividad del mercado',
    allSub: (offers, trades, venues) => `${plural(offers, 'oferta', 'ofertas')} · ${plural(trades, 'trato', 'tratos')} · ${plural(venues, 'puesto', 'puestos')}`,
    tape: 'Cinta del mercado',
    tapeSub: (n, volume) => `${plural(n, 'trato', 'tratos')} · ${volume} P`,
    which: 'Qué tratos',
    others: 'Otros',
    all: 'Todos',
    search: 'equipo, carta, puesto',
    searchLabel: 'Filtrar tratos',
    noTrades: 'Aún no hay tratos que coincidan.',
    tapeHead: ['turno', 'puesto', 'vende → compra', 'carta', 'precio', 'vs libro', 'comisión', ''],
    noBook: 'sin precio de libro',
    bookPrice: (p) => `libro ${p}`,
    book: 'Libro de órdenes',
    bookSub: (offers, venues) => `${plural(offers, 'oferta abierta', 'ofertas abiertas')} · ${plural(venues, 'puesto', 'puestos')}`,
    noOffers: 'Aún no hay ofertas abiertas en ningún puesto.',
    bookHead: ['carta', 'mejor puja', 'mejor oferta', 'pujas / ofertas', 'libro'],
    offers: (n) => plural(n, 'oferta', 'ofertas'),
    oursCount: (n) => `${n} nuestras`,
    age: (n) => `publicada hace ${plural(n, 'turno', 'turnos')}`,
    venues: 'Puestos',
    venuesSub: (open) => `${open} abiertos`,
    noVenues: 'Aún no se ha visto ningún puesto.',
    venueStatus: { open: 'abierto', closing: 'cerrando', closed: 'cerrado' },
    fee: (bps, perCard) => [bps ? `${bps / 100} %` : '', perCard ? `${perCard} P/carta` : ''].filter(Boolean).join(' + ') || 'sin comisión',
  },
  debug: {
    stream: 'Flujo de eventos',
    sub: (shown, scanned, ours) => `${shown} mostrados · ${scanned} en ${ours ? 'los nuestros' : 'la ventana'}`,
    of: (a, b) => `${a} de ${b}`,
    source: 'Origen',
    sources: { ours: 'Nuestros', market: 'Mercado', all: 'Todos' },
    family: 'Familia de tipo',
    clear: 'quitar',
    search: 'busca tipo, actor, ids, JSON…',
    unknownOnly: 'solo tipos desconocidos',
    noEvents: 'Ningún evento coincide con estos filtros.',
    head: ['id', 'turno', 'tipo', 'actor', 'ámbito', 'origen', 'resumen'],
    notKnown: 'un tipo que las pantallas no conocen',
    stats: { window: 'ventana', mine: 'nuestros', last: 'último', perTick: 'por turno', unknown: 'desconocidos', types: 'tipos' },
    perTick: (avg, last) => `${avg}/turno · último ${last}`,
  },
  inspector: { label: 'Inspector de eventos', copy: 'Copiar', close: 'Cerrar', evicted: 'descartado', inspect: 'Ver el evento' },
  learn: {
    notice: {
      loading: 'Leyendo lo que aprendieron nuestros agentes…',
      off: 'Sin base de datos: pon SHOW_DATABASE_URL en el servidor y aplica db/learn.sql para ver lo que aprendieron nuestros agentes.',
      locked: 'Esta pantalla necesita ?token= (GAME_VIEW_TOKEN): muestra la memoria privada del equipo.',
      error: 'El servidor no respondió: se muestra la última lectura.',
      mock: 'Aprendizajes inventados alrededor de la partida falsa. Quita ?mock=1 para ver la memoria real de nuestros agentes.',
    },
    missing: 'aún sin aplicar (db/learn.sql)',
    asOf: (time) => `leído a las ${time}`,
    search: 'tratante, equipo, texto…',
    searchLabel: 'Filtrar aprendizajes',
    inForce: 'Lo que nos bloquea ahora',
    inForceSub: (n, lifted) => `${plural(n, 'aprendizaje', 'aprendizajes')}${lifted ? ` · ${lifted} levantados` : ''}`,
    noneInForce: 'Nada bloquea un trato ahora mismo.',
    lifts: (n) => (n <= 0 ? 'se levanta ya' : `se levanta en ${n}t`),
    liftsUnknown: 'hasta un turno',
    forUs: 'nosotros',
    forAll: 'todos',
    lessons: 'Lo que nos enseñaron los resultados',
    lessonsSub: (n) => `${plural(n, 'lección', 'lecciones')} · las más seguras primero`,
    noLessons: 'Aún no hay lecciones: salen de resultados cerrados y puntuados.',
    facts: 'Leído del feed',
    factsSub: (n) => `${plural(n, 'hecho', 'hechos')} · los más recientes primero`,
    noFacts: 'Aún no se ha leído ningún hecho del feed.',
    support: (n) => `${n} ×`,
    confidence: 'confianza',
    kinds: {
      blocker: 'bloqueo', cooloff: 'enfriamiento', quota: 'cupo', sold_out: 'agotado', price_floor: 'precio suelo', behaviour: 'conducta',
      rule_change: 'regla', fee_change: 'comisión', announcement: 'aviso', lesson: 'lección', policy: 'política', tactic: 'táctica',
    },
    sources: { rules: 'reglas', llm: 'LLM', outcome: 'resultado' },
    dealers: 'Cómo se comporta cada tratante',
    dealersSub: (n) => `${plural(n, 'tratante', 'tratantes')} · curvas de todos los equipos, movimientos de la última ventana`,
    noDealers: 'Aún no hay curvas ni movimientos de tratantes.',
    dealerHead: ['tratante', 'hilos', 'tratos', 'apertura', 'cierre', 'cierre / apertura', 'nuestro', 'firmeza', 'rebaja', 'pasos', 'último'],
    dealerHint: {
      fill: 'lo que costó un trato frente a su primer precio, todos los equipos: 100% = se pagó la apertura',
      ourFill: 'lo mismo, solo nuestros hilos',
      firm: 'parte de sus respuestas con precio que mantuvieron o fueron finales en vez de rebajar',
      concession: 'bajada media de su precio cuando rebaja',
    },
    moves: 'Movimientos de los tratantes',
    movesSub: (n) => plural(n, 'movimiento', 'movimientos'),
    noMoves: 'Ningún movimiento coincide.',
    moveHead: ['turno', 'tratante', 'hilo', 'movimiento', 'su precio', 'el nuestro', 'paso', 'de quién'],
    which: 'Qué hilos',
    ours: 'Nuestros',
    all: 'Todos',
    us: 'nuestro',
    feed: 'feed',
    events: { open: 'abre', counter: 'contraoferta', concede: 'rebaja', hold: 'mantiene', final: 'final', walk: 'se va', deal: 'trato', cooloff: 'enfriamiento', lie_suspected: '¿miente?' },
    rivals: 'Rivales',
    rivalsSub: (n) => `${plural(n, 'equipo', 'equipos')} · los más activos primero`,
    noRivals: 'Aún no hay perfiles de rivales.',
    rivalHead: ['equipo', 'nivel', 'puesto', 'compró', 'vendió', 'gastó', 'ganó', 'busca', 'tratos con tratantes', 'precio sobre', 'turno'],
  },
  history: {
    notice: {
      loading: 'Leyendo nuestra caja…',
      off: 'Sin base de datos: pon SHOW_DATABASE_URL en el servidor y aplica db/history.sql para ver nuestra caja y sus movimientos.',
      locked: 'Esta pantalla necesita ?token= (GAME_VIEW_TOKEN): muestra la caja y los tratos del equipo.',
      error: 'El servidor no respondió: se muestra la última lectura.',
      mock: 'Un día de dinero inventado alrededor de la partida falsa. Quita ?mock=1 para ver nuestra caja real.',
    },
    missing: 'aún sin aplicar (db/history.sql)',
    asOf: (time) => `leído a las ${time}`,
    now: 'Caja ahora',
    nowSub: (tick) => (tick === null ? 'aún sin lectura' : `en el turno ${tick}`),
    stats: { open: 'primera de hoy', low: 'mínima', high: 'máxima', in: 'entra', out: 'sale', fees: 'comisiones', trades: 'tratos' },
    tradesValue: (buys, sells) => `${buys} compras · ${sells} ventas`,
    chart: 'Caja de hoy',
    chartSub: (n) => `${plural(n, 'cambio', 'cambios')} · turno a turno`,
    chartLabel: (low, high, now) => `Caja de hoy: mínima ${low}, máxima ${high}, ahora ${now}`,
    noChart: 'Aún no hay lecturas de nuestra caja hoy.',
    moves: 'Movimientos',
    movesSub: (n) => `${plural(n, 'movimiento', 'movimientos')} · los más recientes primero`,
    noMoves: 'Ningún movimiento coincide.',
    filter: 'Mostrar',
    filters: { all: 'Todo', in: 'Entra', out: 'Sale' },
    head: ['turno', 'cambio', 'caja después', 'qué la movió'],
    line: {
      buy: (card, from, fee) => `Compramos ${card} a ${from}${fee ? ` (+${fee} P de comisión)` : ''}`,
      sell: (card, to) => `Vendimos ${card} a ${to}`,
      bond: (venue, bond) => `Abrimos nuestro mercado ${venue}${bond ? `: ${bond} P de fianza` : ''}`,
      gift: 'Un regalo',
      pack: (pack, best) => `Abrimos un sobre (${pack})${best ? `, mejor carta ${best}` : ''}`,
      level: (level, why) => `Nivel ${level ?? '?'} desbloqueado${why ? `: ${why}` : ''}`,
      failed: 'Falló una liquidación',
      closed: (venue) => `Se cerró el mercado ${venue}`,
      other: 'No viene de un trato que viéramos: una comisión, un sobre, un duelo, un pago',
    },
    before: 'antes de leer la caja',
    pending: 'aún no está en la caja',
    orders: 'Lo que comprometieron nuestros agentes',
    ordersSub: (n) => `${plural(n, 'orden', 'órdenes')} en el libro · las más recientes primero`,
    noOrders: 'Aún no hay órdenes en el libro.',
    ordersHead: ['turno', 'agente', 'orden', 'carta', 'precio'],
    agent: 'Agente',
    allAgents: 'Todos',
  },
}

export const GAME_STRINGS: Readonly<Record<Lang, GameStrings>> = { es: ES, en: EN }

export function useGameStrings(): GameStrings {
  return GAME_STRINGS[useLang()]
}
