/**
 * English, written for the ear and not translated from the Spanish pack: its own jokes, one language
 * per line (Madrid names such as Rastro, Lavapiés and churros stay as they are). `[tags]` are delivery
 * cues, never read aloud (see tags.ts). The buyer is the taker, the seller is the maker; El Chato is
 * not kind.
 */
import { B, D, N, S, v, type Pack } from './bank.ts'

const HANDLE = [B('[whispers] Let me handle {dealerName}.'), S('[chuckles] This I want to see.')] as const

const BID_SHARED = [
  v('calm', B('You say {ask}, I say {price}.'), S('[whispers] Steady… steady…')),
  v('calm', B('I say {price}.'), S('[whispers] Steady… steady…')),
  v('eager', B("[mischievously] {price}, and I'll tell everyone you're the best."), S('[laughs] Flattery! The oldest trick in the Rastro.')),
]

const ACCEPT_SHARED = [
  v('triumphant', B('{ask}? Deal!'), S('[gasps] A deal with {dealerName}! Frame it!')),
  v('triumphant', B('That price? Deal!'), S('[gasps] A deal with {dealerName}! Frame it!')),
]

const WALK_SHARED = v('sarcastic', B('No deal, {dealerName}. My wallet says no.'), S('[sarcastic] Your wallet is very talkative today.'))

export const EN: Pack = {
  // ---------------------------------------------------------------- the SELLER (maker) lists and reprices
  POST_ASK: [
    v('eager', S('[excited] Step right up! {card}, fresh off the cart, {price}!'), B('[sarcastic] {price}? For that it had better come with churros.')),
    v('eager', S('{card} on the board for {price}. Not a penny less, folks.'), B("[laughs] Somebody's feeling brave today.")),
    v('calm', S('{card}, {price}. No rush. The Rastro keeps.'), B('Looks good to me. For now.')),
    v('sarcastic', S("[mischievously] {card} for {price}. My gran's own recipe."), B('[laughs] Your gran never sold a card in her life.')),
    v('calm', S("[whispers] {card}, {price}. A real gem, but you didn't hear it from me."), B('[whispers] My lips are sealed.')),
  ],
  POST_ASK_NO_PRICE: [
    v('eager', S('Look at this beauty: {card}.'), B('[sarcastic] Beautiful. And expensive, I bet.')),
    v('calm', S('{card} goes on the board.'), B('[curious] And the price?'), S('[whispers] Ask nicely.')),
    v('eager', S('[excited] {card} just came in!'), B("Sure it did. You won't give it away, though.")),
  ],
  POST_BID: [
    v('eager', S("I'm buying today! I want {card}, I pay {price}!"), B("[laughs] Look who's shopping now.")),
    v('calm', S('Anyone holding {card}? {price} cash, right here.'), B('[whispers] Cash talks, friend.')),
    v('sarcastic', S('I pay {price} for {card}. Offer of the century.'), B('[sarcastic] Stop, you are making me cry.')),
  ],
  POST_BID_NO_PRICE: [
    v('calm', S('Wanted: {card}. Good home, fair price.'), B('[chuckles] Like a lost-dog poster.')),
    v('eager', S('Who has {card}? I need it today.'), B("Easy, it's not going anywhere.")),
  ],
  REPRICE: [
    v('eager', S('New price for {card}: {price}!'), B('[gasps] The tag moved! Inflation, my friend.')),
    v('calm', S('[whispers] Jev says {verdict}, so {card} is now {price}.'), B('You listen to that machine more than to me.')),
    v('sarcastic', S('{card}, now {price}. Fresh price, fresh day.'), B('[sarcastic] Ah yes, the famous Rastro discount.')),
  ],
  REPRICE_NO_PRICE: [
    v('calm', S('Time to touch the price of {card}.'), B('[curious] Up or down?'), S('[mischievously] Sideways.')),
    v('eager', S('Let me take another look at the price of {card}.'), B("It always goes up. Don't play the mystery.")),
  ],
  HOLD: [
    v('calm', S('{card} stays put.'), B('Patience. The Rastro rewards the patient.')),
    v('calm', S('[whispers] Jev says {verdict}. We hold.'), B('[sighs] We hold. Like statues.')),
    v('sarcastic', S('Not touching {card}. A good price is a good price.'), B('[chuckles] Famous last words.')),
  ],
  HOLD_MANY: [
    v('calm', S('{count} prices on the board, and we hold them all.'), B('[sighs] Like the statues in the Retiro.')),
    v('eager', S('Holding {count} prices. Nobody panic.'), B("[whispers] I'm not panicking. You're panicking.")),
    v('sarcastic', S('{count} prices standing still. We are calm itself.'), B('[sarcastic] Calm or lazy, depending on the day.')),
  ],
  CANCEL_SELLER: [
    v('calm', S('[sighs] Taking {card} off the board.'), B('Back to the drawer, little one.')),
    v('sarcastic', S("{card}, you're coming home."), B('[sarcastic] Nobody loved it like you did.')),
  ],
  CANCEL_BUYER: [
    v('sarcastic', B('I withdraw my bid on {card}.'), S('[sarcastic] Commitment issues?')),
    v('calm', B('On second thought, I pull my bid on {card}.'), S("Think it over. I'll be right here.")),
  ],

  // ---------------------------------------------------------------- the BUYER (taker) shops
  TAKE: [
    v('triumphant', B('[excited] {card} at {ask}? Sold to me!'), S('[laughs] Sold before the ink dried.')),
    v('eager', B('[excited] {card} at that price? Wrap it up!'), S('[laughs] Sold before the ink dried.')),
    v('eager', B('That one. {card}. Wrap it up!'), S('[gasps] No haggling at all!')),
    v('triumphant', B('[whispers] {card}, {ask}… a bargain. Mine!'), S('Somebody call the newspaper.')),
  ],
  PASS: [
    v('calm', B('{card}… no. Not today.'), S('[whispers] Picky, picky.')),
    v('calm', B("[sighs] I'll let {card} go."), S("There's always another card.")),
    v('sarcastic', B('{card}? Pass. Somebody else will buy it.'), S("[chuckles] With that attitude you'll go far.")),
  ],
  LATE: [
    v('calm', B('[sighs] Too slow for {card}. The window closed.'), S("Tomorrow's another day.")),
    v('sarcastic', B('Wait, wait… the tick is over already?'), S('[laughs] Like the last bus home.')),
  ],
  SKIP_SELLER: [
    v('calm', S("I'll keep {card} in the drawer for now."), B('Wise. Very wise.')),
    v('calm', S('[whispers] Not yet for {card}.'), B('[chuckles] The suspense is killing me.')),
  ],
  PRACTICE: [
    v('sarcastic', B("If this were for real, I'd grab {card}."), S('[chuckles] Dreaming is free.')),
    v('calm', S('In practice mode, {card} would be on the board.'), B('[whispers] Rehearsal. Just a rehearsal.')),
  ],
  DENIED_BUYER: [
    v('sarcastic', B("I'll take {card}—"), S('[gasps] Stop! The guardrails said no!'), B('[sighs] Fine. Fine.')),
    v('calm', B('[excited] {card}, here I come!'), S('Stop sign, friend. Rules are rules.')),
    v('sarcastic', B('{card} has my name on it…'), S('And the guardrails have theirs. They say no.')),
  ],
  DENIED_SELLER: [
    v('calm', S("I'll list {card}—"), B('[gasps] Stop! The guardrails say no.')),
    v('sarcastic', S("[sighs] The guardrails won't let {card} out."), B("[whispers] They're stricter than my mother.")),
  ],

  // ---------------------------------------------------------------- dealers at the Rastro (El Chato is not kind)
  DEALER_OPEN_KIND: [
    v('eager', B("Good morning, {dealerName}! I'm after {item}."), D('Oh, sweetheart, sit down, sit down.')),
    v('eager', B('Lovely to see you, {dealerName}! Would you have {item}?'), D('For you, always, dear. Come in, come in.')),
    v('calm', ...HANDLE),
  ],
  DEALER_OPEN_CHATO: [
    v('sarcastic', B("Good morning, {dealerName}! I'm after {item}."), D('[sarcastic] You again. What do you want now?')),
    v('sarcastic', B('Morning, {dealerName}. Have you got {item}?'), D('[sighs] Depends. Are you here to buy or to bother me?')),
    v('calm', ...HANDLE),
  ],
  DEALER_BID_KIND: [
    v('calm', B('I offer {price} for {item}.'), D('[laughs] You remind me of my grandson. Too cheap!')),
    ...BID_SHARED,
  ],
  DEALER_BID_CHATO: [
    v('sarcastic', B('I offer {price} for {item}.'), D('[snorts] {price}? Pigeons offer more.')),
    ...BID_SHARED,
  ],
  DEALER_BID_NO_PRICE: [v('calm', B('A little offer for {item}…'), S('[whispers] Steady… steady…'))],
  DEALER_ACCEPT_KIND: [
    v('triumphant', B('[excited] Deal done, {dealerName}!'), D('Enjoy it, my boy!')),
    ...ACCEPT_SHARED,
  ],
  DEALER_ACCEPT_CHATO: [
    v('triumphant', B('[excited] Deal done, {dealerName}!'), D("[sighs] Fine. Don't tell anyone.")),
    ...ACCEPT_SHARED,
  ],
  DEALER_WALK_KIND: [
    v('calm', B('[sighs] Too much for me. See you later!'), D("Come back Sunday, I'll have churros.")),
    WALK_SHARED,
  ],
  DEALER_WALK_CHATO: [
    v('sarcastic', B('[sighs] Too much for me. See you later!'), D("[snorts] Walk, then. The door's that way.")),
    WALK_SHARED,
  ],

  // ---------------------------------------------------------------- what the game answered
  DEAL: [
    v('triumphant', B('[excited] Deal done!'), S('[laughs] Handshake, confetti, the works!')),
    v('triumphant', S('[gasps] It went through!'), B('Whoop, whoop, whoop!')),
    v('calm', B('Shake on it, friend.'), S('[laughs] Firm handshake. I like it.')),
  ],
  SENT_LIST_OFFER: [v('calm', S('Done. Official, stamped, and on the board.')), v('eager', S('The game said yes. Off we go!'))],
  SENT_CANCEL: [v('calm', S('Gone from the board.')), v('calm', S('[sighs] Withdrawn. Officially.'))],
  SENT_OPEN_THREAD: [v('eager', B('Conversation open. Here we go.')), v('eager', B("I'm in. Let the haggling begin."))],
  SENT_SAY: [v('calm', B('[whispers] Message delivered.')), v('calm', B('Offer sent. Fingers crossed.'))],
  SENT_CLOSE_THREAD: [v('calm', B('Thread closed. Goodbye!')), v('sarcastic', B('Conversation over. Thanks for nothing.'))],
  SENT_OTHER: [v('eager', S('The game said yes. Off we go!')), v('calm', S('Accepted. Next.'))],
  FAIL: [
    v('calm', S('[gasps] The game says: {error}!'), B('[sighs] Paperwork. Always paperwork.')),
    v('sarcastic', B('Refused? {error}?'), S('[sarcastic] Bureaucracy, the true boss of the Rastro.')),
  ],
  UNKNOWN: [v('calm', N('A new move at the stall: {kind}.'))],

  // ---------------------------------------------------------------- duels
  DUEL_OFFER: [
    v('eager', B("It's duel day. My offer is on the table."), S('[whispers] Let the dance begin.')),
    v('sarcastic', B("Here's my little duel offer. Let's see who dares."), S('[chuckles] At that price, not even the cat dares.')),
  ],
  DUEL_ACCEPT: [
    v('triumphant', B('[excited] I accept the duel! May the best trader win.'), S('[laughs] Hear, hear. Let the ink flow.')),
    v('eager', B('Deal in the duel. Time to collect.'), S('[gasps] Ice in your veins!')),
  ],
  DUEL_HOLD: [
    v('calm', B('I hold. Let the other side blink first.'), S('[whispers] Nerves of steel.')),
    v('sarcastic', B("I'm not moving an inch."), S('[sarcastic] Like one of the statues in the Retiro.')),
  ],

  // ---------------------------------------------------------------- situations (/health, /state, /events)
  DOORS_CLOSED: [
    v('calm', S('The doors are still shut. We open {opens}.'), B('[sighs] And me itching to haggle.')),
    v('calm', B('{eta} until we open. What do we do meanwhile?'), S('Sharpen the prices. You can always sharpen a price.')),
    v('eager', S('{eta} to opening. I can already smell the churros.'), B('My purse is packed and ready.')),
    v('sarcastic', B('{eta} to go? Plenty of time for a stroll in the Retiro.'), S('Go ahead, and come back empty-handed.')),
    v('eager', B("When we open {opens}, I'm heading straight for the rare cards."), S("[mischievously] Go ahead. I've hidden them all.")),
    v('calm', S('With the doors shut, even the lanterns are bored.'), B("[chuckles] And they're lit.")),
  ],
  DOORS_CLOSED_BARE: [
    v('calm', S('The doors are still shut.'), B('[sighs] We wait, then.')),
    v('sarcastic', B('Closed. What a surprise.'), S('[chuckles] Even the Rastro needs a rest.')),
    v('eager', S('The moment the doors open, we get to work.'), B('My fingers are warmed up already.')),
  ],
  PAUSED: [
    v('calm', S('The game is paused. Not a move.'), B("[whispers] Breathe in. It'll be back.")),
    v('sarcastic', B('A pause? Just as I was getting going.'), S('[chuckles] The organisers have perfect timing.')),
    v('calm', S('Somebody stopped the clock. Good time to check the prices.'), B("That's all I've been doing all morning.")),
  ],
  QUIET: [
    v('calm', S('Quiet market. Nobody buying, nobody selling.'), B('[sighs] Feels like a Monday at the Rastro.')),
    v('sarcastic', B('Not much going on, is there?'), S('[sarcastic] The calm before the storm. Or before the nap.')),
    v('eager', S('The prices are up. Now we wait for the first brave soul.'), B('Somebody step up, please.')),
    v('calm', B('[whispers] Has the market fallen asleep?'), S('[chuckles] Siesta. Even the cards need one.')),
    v('sarcastic', S("It's nicer here than on a terrace in La Latina."), B('I would already be ordering a drink.')),
    v('eager', B('Any good cards today?'), S('[mischievously] Wait and see.')),
    v('calm', B('Do you think anyone is still watching?'), S('Of course. We keep our composure.')),
    v('sarcastic', S('An ordinary day at the Rastro, an ordinary business.'), B('Anything but ours. Ours is deluxe.')),
  ],
  TICK: [
    v('calm', S('Tick, tock… we are at tick {tick} already.'), B("And nobody's made a move yet.")),
    v('eager', B("Tick {tick}! Let's see what is cooking."), S('[whispers] Quiet, you can hear the machines think.')),
    v('sarcastic', S('Tick {tick} and here we are, cool as ever.'), B('[sarcastic] The thrill. The vertigo.')),
    v('eager', S('[excited] Another tick, number {tick}! Somebody do something.'), B("I'm ready, you know me.")),
    v('calm', B('We are at tick {tick}.'), S('[whispers] And I am counting the seconds.')),
    v('sarcastic', S('Tick {tick} just arrived. We missed it so much.'), B('[laughs] Like an electricity bill.')),
  ],
  NEW_PAGE: [
    v('eager', S('[excited] New pages! We can trade {hood} now.'), B("[gasps] A fresh corner of the album! Let's go.")),
    v('triumphant', B('{hood} is here! Now it gets interesting.'), S('Now the market will really move.')),
  ],
  MARKET_TEST: [
    v('eager', S('Market Test session: every venue gets the same book of buyers and sellers.'), B("[whispers] Time to show who's the best go-between.")),
    v('calm', B("They say there's a Market Test. Are we being graded?"), S("We are. Smile and don't touch anything odd.")),
    v('sarcastic', S("Market Test is on. Let's hope the synthetic buyers haggle well."), B('[laughs] They probably have no idea what a prima is.')),
  ],
  SIMULATOR: [
    v('calm', S('We are on the simulator today. Mistakes are free here.'), B("Then let's make magnificent ones.")),
    v('sarcastic', B('This is the simulator, right? You can tell by how well everything goes.'), S('[laughs] Enjoy it while it lasts.')),
  ],
  DRY: [
    v('sarcastic', B("We're in practice mode. Nothing we do today counts."), S('[chuckles] My favourite kind of day.')),
    v('calm', S('Rehearsal only today: nothing reaches the game.'), B('[whispers] Then let us rehearse with feeling.')),
  ],
  OFFLINE: [
    v('calm', S('The line to the stall next door is down.'), B('[sighs] Retrying. Patiently.')),
    v('sarcastic', B('No signal again. Just like the metro.'), S('[chuckles] Hold on, it will be back.')),
  ],
}
