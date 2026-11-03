/**
 * Tiers de zona (docs/TIERS_DE_ZONA.md, paso 1.5): un número por mapa (1..7) del que salen el rango de nivel de los mobs, la banda de
 * ítems que sueltan y la mazmorra que le corresponde. Agregar un mapa es darle un tier y un sub-rango dentro de él; el validador
 * (`tierErrors`, que corre dentro de `validateMapGraph`) comprueba que todo cierre.
 */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** Niveles recomendados de cada tier (ambos incluidos). Cubren 1..40 sin huecos ni solapes. */
export const TIERS: Record<Tier, [number, number]> = { 1: [1, 5], 2: [6, 10], 3: [11, 15], 4: [16, 20], 5: [21, 25], 6: [26, 30], 7: [31, 40] };
export const TIER_LIST = Object.keys(TIERS).map(Number) as Tier[];
/** Tier al que pertenece un nivel (1..7). */
export const tierOfLvl = (lvl: number): Tier => (TIER_LIST.find((t) => lvl <= TIERS[t][1]) ?? 7);
/** Banda de ítems que suelta un mob de nivel `lvl`: la de su tier (las 7 bandas tienen catálogo; la T7 es de ilvl 35). */
export const itemBandOfLevel = (lvl: number): number => tierOfLvl(Math.max(1, lvl));
/**
 * Nivel de los mobs de un pit en un mapa que cubre `range` (sub-rango de su tier): A (0) el más bajo, C (2) el más alto, B en el medio.
 * Los sueltos (`pit` indefinido) van al nivel de A.
 */
export const pitLevel = (range: [number, number], pit?: number): number =>
    pit === 2 ? range[1] : pit === 1 ? Math.round((range[0] + range[1]) / 2) : range[0];
/** Nivel mínimo para cruzar la puerta de una mazmorra del tier `t`: el mínimo del tier menos 2 (sin máximo). */
export const tierGateLevel = (t: Tier): number => Math.max(1, TIERS[t][0] - 2);
/** Texto del cartel de zona: "Zona T3 · niveles 11-15". */
export const tierLabel = (t: Tier): string => `Zona T${t} · niveles ${TIERS[t][0]}-${TIERS[t][1]}`;
