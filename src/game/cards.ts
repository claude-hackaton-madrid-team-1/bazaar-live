/**
 * The game's 72 cards by name (bazaar src/bazaar_sim/data/catalog.json): a duel names the card at stake, never its
 * ref, and the screens want its set.
 */
import { setOf } from './game.ts'

const NAMES: Readonly<Record<string, readonly string[]>> = {
  LAV: ['La Corrala', 'El Frutero de Argumosa', 'Té Moruno', 'Mural de la Esquina', 'Bici de Reparto', 'La Tabacalera', 'Samosas de la Plaza', 'Teatro Valle-Inclán', 'Cine Doré', 'Fiesta de San Cayetano', 'La Casa Encendida', 'El Gato de Lavapiés'],
  MAL: ['Vinilo de la Movida', 'Plaza del Dos de Mayo', 'Cartel de Conciertos', 'El Tatuador', 'Café de Madrugada', 'Tienda de Discos', 'Mercado de San Ildefonso', 'La Vía Láctea', 'La Heroína del Dos de Mayo', 'Noche de Movida', 'La Sala Pentagrama', 'La Reina de la Movida'],
  LAT: ['Caña en la Cava Baja', 'Puesto del Rastro', 'Huevos Rotos', 'Mercado de la Cebada', 'El Organillero', 'La Chulapa', 'Vermut del Domingo', 'Las Vistillas', 'San Isidro', 'El Mesón de la Cava', 'San Francisco el Grande', 'El Rastro al Amanecer'],
  SAL: ['Escaparate de Serrano', 'El Portero', 'Perrito con Abrigo', 'Café en Goya', 'Taxi Blanco', 'La Galería', 'Mercado de la Paz', 'Guantería Antigua', 'El Marqués', 'Museo Lázaro Galdiano', 'La Puerta de Alcalá', 'La Dama de Serrano'],
  RET: ['Barca del Estanque', 'La Castañera', 'El Titiritero', 'Paseo de Coches', 'La Ardilla', 'La Rosaleda', 'Fuente de la Alcachofa', 'Palacio de Velázquez', 'El Ángel Caído', 'Monumento a Alfonso XII', 'Palacio de Cristal', 'El Ahuehuete'],
  CHA: ['Andén de Metro', 'Kiosco de Prensa', 'La Churrería', 'Mercado de Vallehermoso', 'Plaza de Olavide', 'Estación de Chamberí', 'Club de Jazz', 'El Instituto', 'Museo Sorolla', 'Casa de las Flores', 'Andén 0', 'El Tren Fantasma'],
}

const BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(NAMES).flatMap(([set, names]) => names.map((name, i): [string, string] => [name.toLowerCase(), `${set}-${String(i + 1).padStart(2, '0')}`])),
)

/** The ref of a card by its name (`Palacio de Cristal` → `RET-11`), case aside; null for a name the catalog lacks. */
export const refOfName = (name: string | null | undefined): string | null => (name ? BY_NAME.get(name.trim().toLowerCase()) ?? null : null)

/** The set of a card by its name, or null. */
export const setOfName = (name: string | null | undefined): { name: string; color: string } | null => {
  const ref = refOfName(name)
  return ref ? setOf(ref) : null
}
