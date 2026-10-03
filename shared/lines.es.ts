/**
 * Castellano, with a Madrid flavour: one language per line, written for the ear (short, spoken, no
 * English). `[tags]` are delivery cues, never read aloud (see tags.ts). The buyer is the taker, the
 * seller is the maker; El Chato is not kind.
 */
import { B, D, N, S, v, type Pack } from './bank.ts'

const HANDLE = [B('[whispers] Déjame a mí con {dealerName}.'), S('[chuckles] Esto lo quiero ver.')] as const

const BID_SHARED = [
  v('calm', B('Usted dice {ask}, yo digo {price}.'), S('[whispers] Firme… firme…')),
  v('calm', B('Yo digo {price}.'), S('[whispers] Firme… firme…')),
  v('eager', B('[mischievously] {price}, y le digo a todo el mundo que usted es el mejor.'), S('[laughs] ¡Peloteo! El truco más viejo del Rastro.')),
]

const ACCEPT_SHARED = [
  v('triumphant', B('¿{ask}? ¡Trato!'), S('[gasps] ¡Un trato con {dealerName}! ¡A enmarcarlo!')),
  v('triumphant', B('¿A ese precio? ¡Trato!'), S('[gasps] ¡Un trato con {dealerName}! ¡A enmarcarlo!')),
]

const WALK_SHARED = v('sarcastic', B('No hay trato, {dealerName}. Mi cartera dice que no.'), S('[sarcastic] Qué charlatana está hoy tu cartera.'))

export const ES: Pack = {
  // ---------------------------------------------------------------- the SELLER (maker) lists and reprices
  POST_ASK: [
    v('eager', S('[excited] ¡Venga, venga! {card}, recién llegada, a {price}.'), B('[sarcastic] ¿{price}? Por eso que te regalen unos churros.')),
    v('eager', S('¡Pasen y vean! {card} por solo {price}, ni un céntimo menos.'), B('[laughs] Anda que no tienes cara, tío.')),
    v('calm', S('{card} al tablón, {price}. Sin prisa, que el Rastro es largo.'), B('Pues yo la veo bien. De momento.')),
    v('sarcastic', S('[mischievously] {card}, {price}. Receta de mi abuela.'), B('[laughs] Tu abuela no ha vendido una carta en su vida.')),
    v('calm', S('[whispers] {card}, {price}. Una joya, pero no se lo digas a nadie.'), B('[whispers] Tranquilo, que mi boca es una tumba.')),
  ],
  POST_ASK_NO_PRICE: [
    v('eager', S('Mirad qué preciosidad: {card}.'), B('[sarcastic] Preciosa. Y carísima, seguro.')),
    v('calm', S('{card} sube al tablón.'), B('[curious] ¿Y el precio?'), S('[whispers] Eso, preguntando bien.')),
    v('eager', S('[excited] ¡Acaba de entrar {card}!'), B('Ya, ya. Seguro que no me la vas a regalar.')),
  ],
  POST_BID: [
    v('eager', S('¡Hoy compro yo! Busco {card} y pago {price}.'), B('[laughs] Mira quién se ha puesto a comprar.')),
    v('calm', S('¿Alguien con {card}? {price} en mano, aquí mismo.'), B('[whispers] El dinero habla, tío.')),
    v('sarcastic', S('Pago {price} por {card}. Ofertón del siglo.'), B('[sarcastic] Se me saltan las lágrimas de la emoción.')),
  ],
  POST_BID_NO_PRICE: [
    v('calm', S('Se busca {card}. Buen hogar y precio justo.'), B('[chuckles] Parece el cartel de un perro perdido.')),
    v('eager', S('¿Quién tiene {card}? Que la necesito ya.'), B('Tranquilo, hombre, que no se va a ir a ningún lado.')),
  ],
  REPRICE: [
    v('eager', S('¡Precio nuevo para {card}: {price}!'), B('[gasps] ¡Ha movido la etiqueta! Menuda inflación, tío.')),
    v('calm', S('[whispers] Jev dice {verdict}, así que {card} queda en {price}.'), B('Le haces más caso a esa máquina que a mí.')),
    v('sarcastic', S('{card}, ahora a {price}. Precio fresco, día nuevo.'), B('[sarcastic] Ah, sí, el famoso descuento del Rastro.')),
  ],
  REPRICE_NO_PRICE: [
    v('calm', S('Toca retocar el precio de {card}.'), B('[curious] ¿Para arriba o para abajo?'), S('[mischievously] De lado.')),
    v('eager', S('Voy a darle una vuelta al precio de {card}.'), B('Siempre es para arriba, no te hagas el interesante.')),
  ],
  HOLD: [
    v('calm', S('{card} se queda como está.'), B('Paciencia. El Rastro premia a los pacientes.')),
    v('calm', S('[whispers] Jev dice {verdict}. Aguantamos.'), B('[sighs] Aguantamos. Como estatuas.')),
    v('sarcastic', S('No toco {card}. Buen precio es buen precio.'), B('[chuckles] Lo dijo el último que subió el precio.')),
  ],
  HOLD_MANY: [
    v('calm', S('{count} precios en el tablón y los aguantamos todos.'), B('[sighs] Como las estatuas del Retiro.')),
    v('eager', S('Mantengo {count} precios. Que nadie se ponga nervioso.'), B('[whispers] Yo no estoy nervioso. Nervioso estás tú.')),
    v('sarcastic', S('{count} precios quietos. Somos la calma personificada.'), B('[sarcastic] La calma o la pereza, según se mire.')),
  ],
  CANCEL_SELLER: [
    v('calm', S('[sighs] Retiro {card} del tablón.'), B('Vuelve al cajón, pequeña.')),
    v('sarcastic', S('{card}, te vienes a casa.'), B('[sarcastic] Nadie la quería como tú.')),
  ],
  CANCEL_BUYER: [
    v('sarcastic', B('Retiro mi puja por {card}.'), S('[sarcastic] ¿Miedo al compromiso?')),
    v('calm', B('Mejor me lo pienso: retiro la puja por {card}.'), S('Piénsalo, piénsalo. Aquí te espero.')),
  ],

  // ---------------------------------------------------------------- the BUYER (taker) shops
  TAKE: [
    v('triumphant', B('[excited] ¿{card} a {ask}? ¡Me la llevo!'), S('[laughs] Vendida antes de que se seque la tinta.')),
    v('eager', B('[excited] ¿{card} a ese precio? ¡Me la llevo!'), S('[laughs] Vendida antes de que se seque la tinta.')),
    v('eager', B('Esa. {card}. ¡Envuélvamela!'), S('[gasps] ¡Y sin regatear ni nada!')),
    v('triumphant', B('[whispers] {card} a {ask}… una ganga. ¡Mía!'), S('¡Olé! Que alguien llame al periódico.')),
  ],
  PASS: [
    v('calm', B('{card}… no. Hoy no.'), S('[whispers] Qué exigente.')),
    v('calm', B('[sighs] Dejo pasar {card}.'), S('Siempre hay otra carta, colega.')),
    v('sarcastic', B('¿{card}? Paso. Ya se la comprará otro.'), S('[chuckles] Con esa filosofía vas lejos.')),
  ],
  LATE: [
    v('calm', B('[sighs] Tarde para {card}. Se me pasó el turno.'), S('Mañana será otro día.')),
    v('sarcastic', B('Espera, espera… ¿ya se acabó el turno?'), S('[laughs] Como el último autobús.')),
  ],
  SKIP_SELLER: [
    v('calm', S('Guardo {card} en el cajón de momento.'), B('Sabio. Muy sabio.')),
    v('calm', S('[whispers] Todavía no toca para {card}.'), B('[chuckles] Qué intriga, me muero.')),
  ],
  PRACTICE: [
    v('sarcastic', B('Si esto fuera de verdad, me llevaría {card}.'), S('[chuckles] Soñar es gratis.')),
    v('calm', S('En modo ensayo, {card} estaría en el tablón.'), B('[whispers] Ensayo. Solo es un ensayo.')),
  ],
  DENIED_BUYER: [
    v('sarcastic', B('Me llevo {card}…'), S('[gasps] ¡Alto! ¡Las barreras dicen que no!'), B('[sighs] Vale. Vale.')),
    v('calm', B('[excited] ¡{card}, allá voy!'), S('Señal de stop, colega. Las reglas son las reglas.')),
    v('sarcastic', B('Mira, {card} lleva mi nombre…'), S('Y las barreras llevan el suyo. Dicen que no.')),
  ],
  DENIED_SELLER: [
    v('calm', S('Voy a poner {card}…'), B('[gasps] ¡Alto! Las barreras dicen que no.')),
    v('sarcastic', S('[sighs] Las barreras no dejan salir a {card}.'), B('[whispers] Son más estrictas que mi madre.')),
  ],

  // ---------------------------------------------------------------- dealers at the Rastro (El Chato is not kind)
  DEALER_OPEN_KIND: [
    v('eager', B('¡Buenos días, {dealerName}! Ando buscando {item}.'), D('Ay, cariño, siéntate, siéntate.')),
    v('eager', B('¡Muy buenas, {dealerName}! ¿Tendrá {item}?'), D('Para ti siempre, hijo mío. Pasa, pasa.')),
    v('calm', ...HANDLE),
  ],
  DEALER_OPEN_CHATO: [
    v('sarcastic', B('¡Buenos días, {dealerName}! Ando buscando {item}.'), D('[sarcastic] Tú otra vez. ¿Qué quieres ahora?')),
    v('sarcastic', B('Buenas, {dealerName}. ¿Tiene {item}?'), D('[sighs] Depende. ¿Vienes a comprar o a molestar?')),
    v('calm', ...HANDLE),
  ],
  DEALER_BID_KIND: [
    v('calm', B('Le ofrezco {price} por {item}.'), D('[laughs] Me recuerdas a mi nieto. ¡Qué rácano!')),
    ...BID_SHARED,
  ],
  DEALER_BID_CHATO: [
    v('sarcastic', B('Le ofrezco {price} por {item}.'), D('[snorts] ¿{price}? Eso lo ofrecen hasta las palomas de la Plaza Mayor.')),
    ...BID_SHARED,
  ],
  DEALER_BID_NO_PRICE: [v('calm', B('Una ofertilla por {item}…'), S('[whispers] Firme… firme…'))],
  DEALER_ACCEPT_KIND: [
    v('triumphant', B('[excited] ¡Trato hecho, {dealerName}!'), D('¡Que aproveche, mi niño!')),
    ...ACCEPT_SHARED,
  ],
  DEALER_ACCEPT_CHATO: [
    v('triumphant', B('[excited] ¡Trato hecho, {dealerName}!'), D('[sighs] Vale. No se lo cuentes a nadie.')),
    ...ACCEPT_SHARED,
  ],
  DEALER_WALK_KIND: [
    v('calm', B('[sighs] Es demasiado para mí. ¡Hasta luego!'), D('Vuelve el domingo, que tendré churros.')),
    WALK_SHARED,
  ],
  DEALER_WALK_CHATO: [
    v('sarcastic', B('[sighs] Es demasiado para mí. ¡Hasta luego!'), D('[snorts] Pues largo. La puerta está por ahí.')),
    WALK_SHARED,
  ],

  // ---------------------------------------------------------------- what the game answered
  DEAL: [
    v('triumphant', B('[excited] ¡Trato hecho!'), S('[laughs] ¡Apretón de manos, confeti, todo!')),
    v('triumphant', S('[gasps] ¡Ha colado!'), B('¡Olé, olé, olé!')),
    v('calm', B('Choca esos cinco, tío.'), S('[laughs] Qué apretón más firme. Me gusta.')),
  ],
  SENT_LIST_OFFER: [v('calm', S('Hecho. Oficial, sellado y en el tablón.')), v('eager', S('El juego dijo que sí. ¡Vamos!'))],
  SENT_CANCEL: [v('calm', S('Fuera del tablón.')), v('calm', S('[sighs] Retirada. Oficialmente.'))],
  SENT_OPEN_THREAD: [v('eager', B('Conversación abierta. Allá vamos.')), v('eager', B('Ya estoy dentro. Que empiece el regateo.'))],
  SENT_SAY: [v('calm', B('[whispers] Mensaje entregado.')), v('calm', B('Oferta enviada. Cruzo los dedos.'))],
  SENT_CLOSE_THREAD: [v('calm', B('Hilo cerrado. ¡Adiós!')), v('sarcastic', B('Conversación terminada. Gracias por nada.'))],
  SENT_OTHER: [v('eager', S('El juego dijo que sí. ¡Vamos!')), v('calm', S('Aceptado. Siguiente.'))],
  FAIL: [
    v('calm', S('[gasps] ¡El juego dice: {error}!'), B('[sighs] Papeleo. Siempre el papeleo.')),
    v('sarcastic', B('¿Rechazado? ¿{error}?'), S('[sarcastic] La burocracia, la verdadera jefa del Rastro.')),
  ],
  UNKNOWN: [v('calm', N('Movimiento nuevo en el puesto: {kind}.'))],

  // ---------------------------------------------------------------- duels
  DUEL_OFFER: [
    v('eager', B('Hoy toca duelo. Mi oferta está sobre la mesa.'), S('[whispers] Que empiece el baile.')),
    v('sarcastic', B('Les dejo una ofertita de duelo. A ver quién se atreve.'), S('[chuckles] Con ese listón no se atreve ni el gato.')),
  ],
  DUEL_ACCEPT: [
    v('triumphant', B('[excited] ¡Acepto el duelo! Que gane el mejor.'), S('[laughs] Eso, eso. Que corra la tinta.')),
    v('eager', B('Trato en el duelo. Ahora a cobrar.'), S('[gasps] ¡Qué sangre fría!')),
  ],
  DUEL_HOLD: [
    v('calm', B('Aguanto. Que mueva ficha el otro primero.'), S('[whispers] Nervios de acero.')),
    v('sarcastic', B('No me muevo ni un milímetro.'), S('[sarcastic] Ni que fueras una estatua del Retiro.')),
  ],

  // ---------------------------------------------------------------- situations (/health, /state, /events)
  DOORS_CLOSED: [
    v('calm', S('Las puertas siguen cerradas. Abrimos {opens}.'), B('[sighs] Y yo con las ganas de regatear.')),
    v('calm', B('Cuenta atrás: {eta} para abrir. ¿Qué hacemos mientras?'), S('Afinar los precios, colega. Siempre se puede afinar un precio.')),
    v('eager', S('{eta} para la apertura y ya huelo los churros.'), B('Yo ya tengo el monedero preparado.')),
    v('sarcastic', B('¿{eta} para abrir? Me da tiempo a dar una vuelta por el Retiro.'), S('Hazlo, y vuelves con las manos vacías.')),
    v('eager', B('Cuando abramos {opens}, voy directo a las cartas raras.'), S('[mischievously] Tú ve, que yo ya las he escondido.')),
    v('calm', S('Con las puertas cerradas, hasta los faroles se aburren.'), B('[chuckles] Y eso que están encendidos.')),
  ],
  DOORS_CLOSED_BARE: [
    v('calm', S('Las puertas siguen cerradas.'), B('[sighs] A esperar, entonces.')),
    v('sarcastic', B('Cerrado. Qué sorpresa.'), S('[chuckles] El Rastro también descansa, ¿eh?')),
    v('eager', S('En cuanto se abran las puertas, nos ponemos manos a la obra.'), B('Yo ya estoy calentando los dedos.')),
  ],
  PAUSED: [
    v('calm', S('El juego está en pausa. Ni un movimiento.'), B('[whispers] Respira hondo. Ya volverá.')),
    v('sarcastic', B('¿Pausa? Justo cuando me estaba animando.'), S('[chuckles] Qué oportunos, los organizadores.')),
    v('calm', S('Alguien ha parado el reloj. Aprovecha para repasar precios.'), B('Eso llevo haciendo toda la mañana.')),
  ],
  QUIET: [
    v('calm', S('Mercado tranquilo. Nadie compra, nadie vende.'), B('[sighs] Esto parece un lunes en el Rastro.')),
    v('sarcastic', B('Mucho movimiento no hay, ¿eh?'), S('[sarcastic] Es la calma antes de la tormenta. O de la siesta.')),
    v('eager', S('Los precios están puestos. Ahora a esperar al primer valiente.'), B('Que se anime alguien, por favor.')),
    v('calm', B('[whispers] ¿Se ha dormido el mercado?'), S('[chuckles] Siesta. Hasta las cartas la necesitan.')),
    v('sarcastic', S('Aquí se está mejor que en una terraza de la Latina.'), B('Pues yo pediría una caña ya.')),
    v('eager', B('¿Alguna carta buena hoy?'), S('[mischievously] Tú espera y verás, colega.')),
    v('calm', B('Oye, ¿tú crees que la gente sigue mirando?'), S('Claro. Hay que mantener la compostura.')),
    v('sarcastic', S('Un día cualquiera en el Rastro, un negocio cualquiera.'), B('Cualquiera menos el nuestro, que es de lujo.')),
  ],
  TICK: [
    v('calm', S('Tic, tac… ya vamos por el turno {tick}.'), B('Y nadie ha movido ficha todavía.')),
    v('eager', B('¡Turno {tick}! A ver qué se cuece.'), S('[whispers] Silencio, que se oye pensar a las máquinas.')),
    v('sarcastic', S('Turno {tick} y aquí seguimos, tan campantes.'), B('[sarcastic] Qué emoción, qué vértigo.')),
    v('eager', S('[excited] ¡Otro turno, el {tick}! Que alguien haga algo.'), B('Yo estoy listo, ya me conoces.')),
    v('calm', B('Estamos en el turno {tick}.'), S('[whispers] Y yo contando los segundos.')),
    v('sarcastic', S('El turno {tick} acaba de llegar. Se le echaba de menos.'), B('[laughs] Como a un recibo de la luz.')),
  ],
  NEW_PAGE: [
    v('eager', S('[excited] ¡Páginas nuevas! Ya se puede comerciar con {hood}.'), B('[gasps] ¡Una zona nueva del álbum! A por ella.')),
    v('triumphant', B('¡Llega {hood}! Esto se pone interesante.'), S('Ahora sí que se va a mover el mercado.')),
  ],
  MARKET_TEST: [
    v('eager', S('Sesión del Test de Mercado: todos los puestos reciben el mismo libro de compradores.'), B('[whispers] A demostrar quién es el mejor intermediario.')),
    v('calm', B('Dicen que hay Test de Mercado. ¿Nos examinan?'), S('Nos examinan. Sonríe y no toques nada raro.')),
    v('sarcastic', S('Test de Mercado en marcha. Ojalá los compradores sintéticos regateen bien.'), B('[laughs] Seguro que ni saben lo que es una prima.')),
  ],
  SIMULATOR: [
    v('calm', S('Hoy estamos en el simulador. Aquí los errores son gratis.'), B('Pues aprovechemos para equivocarnos a lo grande.')),
    v('sarcastic', B('Esto es el simulador, ¿verdad? Se nota por lo bien que sale todo.'), S('[laughs] Disfrútalo mientras dure.')),
  ],
  DRY: [
    v('sarcastic', B('Estamos en modo ensayo. Lo que hagamos hoy no cuenta.'), S('[chuckles] Mi tipo de día favorito.')),
    v('calm', S('Hoy solo ensayamos: nada sale al juego.'), B('[whispers] Pues ensayemos con ganas.')),
  ],
  OFFLINE: [
    v('calm', S('Se ha caído la conexión con el puesto de al lado.'), B('[sighs] Reintentando. Con paciencia.')),
    v('sarcastic', B('Otra vez sin cobertura. Esto es como el metro.'), S('[chuckles] Aguanta, que ya vuelve.')),
  ],
}
