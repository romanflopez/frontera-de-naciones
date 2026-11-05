/**
 * Tiers de zona (docs/TIERS_DE_ZONA.md, paso 1.5; ampliados a 12 en la etapa E2 del diseño HB de nivel 120): un número por mapa (1..12)
 * del que salen el rango de nivel de los mobs y la mazmorra que le corresponde. Cada tier son 10 niveles. Agregar un mapa es darle un tier
 * y un sub-rango dentro de él; el validador (`tierErrors`, dentro de `validateMapGraph`) comprueba que todo cierre.
 *
 * El tier de zona y la BANDA DE ÍTEMS son dos cosas distintas: la banda (1..7) es el catálogo de ítems/únicos/sets y sus chances de drop;
 * `itemBandOfLevel` dice cuál suelta un mob de cierto nivel.
 */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
/** Niveles recomendados de cada tier (ambos incluidos): 12 tiers de 10 niveles, 1..120 sin huecos ni solapes. */
export const TIERS: Record<Tier, [number, number]> = {
    1: [1, 10], 2: [11, 20], 3: [21, 30], 4: [31, 40], 5: [41, 50], 6: [51, 60],
    7: [61, 70], 8: [71, 80], 9: [81, 90], 10: [91, 100], 11: [101, 110], 12: [111, 120],
};
export const TIER_LIST = Object.keys(TIERS).map(Number) as Tier[];
/** Tier de zona al que pertenece un nivel (1..12). */
export const tierOfLvl = (lvl: number): Tier => (TIER_LIST.find((t) => lvl <= TIERS[t][1]) ?? 12);
/** Último tier con contenido de caza hoy (los siguientes se llenan en la etapa E6 en adelante; el validador no los exige todavía). */
export const TIERS_WITH_CONTENT = 4;
/**
 * Banda de ítems (1..7) según el nivel del mob: nivel mínimo de cada banda. El catálogo de 7 bandas y 21 sets se estira sobre 1-120
 * (~17 niveles por banda), igual que los lugares de entrenamiento: no se rehace el catálogo; la variedad la dan los afijos y las calidades,
 * y un ítem sirve ~17 niveles (se mejora con +N mientras subís).
 */
export const BAND_FROM: readonly number[] = [1, 18, 35, 52, 69, 86, 103];
/** Banda de ítems que suelta un mob de nivel `lvl` (las 7 bandas tienen catálogo; la 7 es de ilvl 35). */
export const itemBandOfLevel = (lvl: number): number => { let b = 1; BAND_FROM.forEach((f, i) => { if (Math.max(1, lvl) >= f) b = i + 1; }); return b; };
/**
 * Nivel de los mobs de un pit en un mapa que cubre `range` (sub-rango de su tier): A (0) el más bajo, el último el más alto y los de en medio repartidos parejo (3 pits por defecto; un mapa que une varios tramos puede traer más).
 * Los sueltos (`pit` indefinido) van al nivel de A.
 */
export const pitLevel = (range: [number, number], pit?: number, pits = 3): number =>
    !pit ? range[0] : pit >= pits - 1 ? range[1] : Math.round(range[0] + ((range[1] - range[0]) * pit) / (pits - 1));
/** Nivel mínimo para cruzar la puerta de una mazmorra del tier `t`: el mínimo del tier menos 2 (sin máximo). */
export const tierGateLevel = (t: Tier): number => Math.max(1, TIERS[t][0] - 2);
/** Texto del cartel de zona: "Zona T3 · niveles 21-30". */
export const tierLabel = (t: Tier): string => `Zona T${t} · niveles ${TIERS[t][0]}-${TIERS[t][1]}`;

/**
 * Nivel de poder: el juego se diseñó para los niveles 1-40 y se estiró a 1-120 (E2b). Los anclajes son [nivel viejo, nivel nuevo]; entre
 * anclajes se interpola en línea recta. Las curvas de poder (vida de clase, vida/daño/exp de los mobs, multiplicador de exp) se siguen
 * calculando en la escala vieja con `powerLevel(nivel)`, así el balance ya probado no cambia: subir un nivel nuevo es subir una fracción
 * de nivel viejo. Los anclajes dejan cada mapa de entrada de mazmorra dentro de la banda de ítems de su llave (llaves y materiales).
 */
export const LEVEL_ANCHORS: readonly (readonly [number, number])[] = [[1, 1], [5, 14], [9, 26], [12, 42], [17, 58], [24, 77], [27, 94], [34, 108], [40, 120]];
/** Nivel nuevo (1-120) de un nivel de la escala vieja (1-40). */
export function relevel(oldLvl: number): number {
    const k = LEVEL_ANCHORS; if (oldLvl <= k[0][0]) return k[0][1];
    for (let i = 1; i < k.length; i++) if (oldLvl <= k[i][0]) { const [a, na] = k[i - 1], [b, nb] = k[i]; return Math.round(na + ((nb - na) * (oldLvl - a)) / (b - a)); }
    return k[k.length - 1][1];
}
/** Nivel de poder (escala vieja, 1-40, continuo) de un nivel nuevo (1-120). */
export function powerLevel(lvl: number): number {
    const k = LEVEL_ANCHORS; if (lvl <= k[0][1]) return k[0][0];
    for (let i = 1; i < k.length; i++) if (lvl <= k[i][1]) { const [a, na] = k[i - 1], [b, nb] = k[i]; return a + ((b - a) * (lvl - na)) / (nb - na); }
    return k[k.length - 1][0];
}
