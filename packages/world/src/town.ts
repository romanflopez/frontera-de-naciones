/**
 * Kit de ciudad (arte CC0 de Screaming Brain Studios: Overworld, Wall y Object packs). Ids del atlas `town.webp` y
 * fachadas de edificios armadas por tools/src/town/atlas.ts. Este archivo es la única fuente de verdad de los ids: el script
 * lo importa para generar el atlas y los mapas lo usan para elegir piezas, así que cualquier cambio acá pide volver a correr
 * el script (`pnpm assets:town <carpeta SBS>`).
 *
 * Convenciones (grilla de 96x48, x hacia el sudeste y y hacia el sudoeste de la pantalla):
 *   - Pisos: 3000 + hoja * 18 + celda (hojas de 3x6 rombos de 256x128, reescalados a 100x50 como terrain.webp).
 *   - Paredes: dos pisos de alto (pieza plana abajo + pieza gruesa con remate arriba). Cada pieza ocupa UN lado de una celda y se
 *     ancla en la esquina norte (de arriba) de la celda donde se pone el prop: `/` va sobre el lado oeste de esa celda y `\` sobre
 *     el lado norte. Para el lado este de (x, y) se pone `/` en (x + 1, y); para el lado sur, `\` en (x, y + 1).
 *   - Muretes (copings) y balaustradas: misma convención que las paredes, pero bajos.
 *   - Objetos chicos (cajas, escaleras, faroles): centrados en su celda.
 */

export const TOWN_BASE = 3000;
/** Hojas de piso del Overworld Pack (Large, flat), en el orden del atlas. */
export const TOWN_SHEETS = ['water', 'terrain1', 'terrain2', 'terrain3', 'forest'] as const;
export type TownSheet = (typeof TOWN_SHEETS)[number];
export const townTile = (sheet: TownSheet, cell: number): number => TOWN_BASE + TOWN_SHEETS.indexOf(sheet) * 18 + cell;

/** Estilos de pared: material del Wall Pack y color (índice 0..11 de la grilla de 3x4 variantes de cada hoja). */
export const WALL_STYLES = [
    { id: 'cal', mat: 'Stone', color: 11 }, // piedra encalada (blanca)
    { id: 'arenisca', mat: 'Stone', color: 10 }, // arenisca dorada
    { id: 'crema', mat: 'Stone', color: 4 },
    { id: 'piedra', mat: 'Stone', color: 0 }, // piedra gris (muralla, herrería)
    { id: 'ladrillo', mat: 'Brick', color: 0 },
    { id: 'ladrillo_claro', mat: 'Brick', color: 6 },
    { id: 'madera', mat: 'Wood', color: 3 },
    { id: 'madera_clara', mat: 'Wood', color: 6 },
    { id: 'lila', mat: 'Stone', color: 8 }, // torre de magia
    { id: 'beige', mat: 'Stone', color: 9 },
] as const;
export type WallStyle = (typeof WALL_STYLES)[number]['id'];
export type WallVariant = 'liso' | 'ventana' | 'ventana2';
const WALL_VARIANTS: WallVariant[] = ['liso', 'ventana', 'ventana2'];
export const WALL_BASE = 3200;
/** Pared alta (dos pisos). `ori` '/' = lado oeste de la celda, '\\' = lado norte. */
export const townWall = (style: WallStyle, v: WallVariant, ori: '/' | '\\'): number =>
    WALL_BASE + WALL_STYLES.findIndex((s) => s.id === style) * 10 + WALL_VARIANTS.indexOf(v) * 2 + (ori === '/' ? 0 : 1);
/** Pared baja (un piso, con remate): muralla de la ciudad. */
export const townWallLow = (style: WallStyle, ori: '/' | '\\'): number => WALL_BASE + WALL_STYLES.findIndex((s) => s.id === style) * 10 + 6 + (ori === '/' ? 0 : 1);
/** Pilar de esquina (dos pisos), centrado en la esquina norte de la celda. */
export const townPillar = (style: WallStyle): number => WALL_BASE + WALL_STYLES.findIndex((s) => s.id === style) * 10 + 8;

/** Muretes y barandas de piedra (Copings): `ori` como las paredes. */
export const COPINGS = ['cornisa', 'murete', 'muro', 'baranda', 'balaustrada'] as const;
export type Coping = (typeof COPINGS)[number];
export const COPING_BASE = 3400;
export const townCoping = (c: Coping, ori: '/' | '\\'): number => COPING_BASE + COPINGS.indexOf(c) * 2 + (ori === '/' ? 0 : 1);

/** Escaleras (Object Pack): material y sentido (sube hacia el noroeste `/` o hacia el noreste `\\`). */
export const STAIRS_BASE = 3420;
export const STAIR_MATS = ['piedra', 'ladrillo', 'madera'] as const;
export const townStairs = (m: (typeof STAIR_MATS)[number], ori: '/' | '\\'): number => STAIRS_BASE + STAIR_MATS.indexOf(m) * 2 + (ori === '/' ? 0 : 1);

/** Cajas (Object Pack): 12 de madera y 6 de metal. */
export const CRATE_BASE = 3440;
export const CRATES_WOOD = Array.from({ length: 12 }, (_, i) => CRATE_BASE + i);
export const CRATES_METAL = Array.from({ length: 6 }, (_, i) => CRATE_BASE + 12 + i);

/** Espuma de la orilla (decal sobre el agua, una por lado del rombo que da a tierra): ne, se, sw, nw. */
export const FOAM_BASE = 3470;
export const FOAM = { ne: FOAM_BASE, se: FOAM_BASE + 1, sw: FOAM_BASE + 2, nw: FOAM_BASE + 3 } as const;
/** Objetos dibujados por el script (sin arte de terceros): farol de hierro, bote, bandera, cartel. */
export const PROP_BASE = 3480;
export const TOWN_PROPS = { farol: PROP_BASE, bote: PROP_BASE + 1, bote2: PROP_BASE + 2, bandera: PROP_BASE + 3, poste: PROP_BASE + 4, alfombra: PROP_BASE + 5 } as const;

/**
 * Fachadas: edificios cerrados (cara sur y cara este a la vista) con terraza plana y pretil, puerta dibujada y cartel.
 * `door.side` 'S' = cara sur (la puerta da a la celda (x + i, y + h)), 'E' = cara este (da a (x + w, y + i)).
 */
export interface TownBuilding {
    id: string; w: number; h: number;
    /** Pisos de ~96 px (cada uno son dos piezas del Wall Pack apiladas). */
    floors: number; style: WallStyle;
    door?: { side: 'S' | 'E'; i: number };
    sign?: string;
    /** Color de la terraza: celda 15 de terrain1 (arcilla) o 17 de terrain2 (arena dorada). */
    roof?: 15 | 17;
    /** Pretil de la terraza (Copings). */
    parapet?: Coping;
    /** Volumen escalonado sobre la terraza (en celdas relativas a la huella). */
    upper?: { x: number; y: number; w: number; h: number; floors: number };
    /** Toldo a rayas sobre la puerta (color). */
    awning?: string;
}
export const TOWN_BUILDINGS: TownBuilding[] = [
    { id: 'sm_ayuntamiento', w: 10, h: 7, floors: 2, style: 'cal', door: { side: 'S', i: 5 }, sign: 'AYUNTAMIENTO', roof: 15, parapet: 'muro', upper: { x: 1, y: 1, w: 4, h: 3, floors: 1 } },
    { id: 'sm_templo', w: 8, h: 8, floors: 2, style: 'crema', door: { side: 'S', i: 4 }, sign: 'TEMPLO', roof: 17, parapet: 'baranda', upper: { x: 2, y: 2, w: 4, h: 4, floors: 1 } },
    { id: 'sm_herreria', w: 7, h: 5, floors: 1, style: 'piedra', door: { side: 'S', i: 3 }, sign: 'HERRERÍA', roof: 15, parapet: 'muro', awning: '#8a4b2a' },
    { id: 'sm_tienda', w: 6, h: 5, floors: 1, style: 'arenisca', door: { side: 'E', i: 2 }, sign: 'TIENDA', roof: 15, awning: '#2f7d6d', upper: { x: 0, y: 0, w: 3, h: 3, floors: 1 } },
    { id: 'sm_joyeria', w: 5, h: 5, floors: 1, style: 'cal', door: { side: 'E', i: 2 }, sign: 'JOYERÍA', roof: 17, awning: '#7a3fa0', upper: { x: 0, y: 0, w: 3, h: 2, floors: 1 } },
    { id: 'sm_deposito', w: 7, h: 5, floors: 1, style: 'ladrillo', door: { side: 'S', i: 3 }, sign: 'DEPÓSITO', roof: 15, parapet: 'muro' },
    { id: 'sm_torre', w: 4, h: 4, floors: 3, style: 'lila', door: { side: 'S', i: 2 }, sign: 'TORRE', roof: 17, parapet: 'muro', upper: { x: 1, y: 1, w: 2, h: 2, floors: 1 } },
    { id: 'sm_cuartel', w: 9, h: 6, floors: 1, style: 'piedra', door: { side: 'E', i: 3 }, sign: 'CUARTEL', roof: 15, parapet: 'muro', upper: { x: 0, y: 0, w: 3, h: 3, floors: 1 } },
    // casas y torres sin interior
    { id: 'sm_casa_a', w: 5, h: 4, floors: 1, style: 'cal', door: { side: 'S', i: 2 }, roof: 15, upper: { x: 0, y: 0, w: 3, h: 2, floors: 1 } },
    { id: 'sm_casa_b', w: 4, h: 5, floors: 2, style: 'arenisca', door: { side: 'E', i: 2 }, roof: 17 },
    { id: 'sm_casa_c', w: 6, h: 4, floors: 1, style: 'ladrillo_claro', door: { side: 'S', i: 1 }, roof: 15, upper: { x: 2, y: 0, w: 4, h: 2, floors: 1 } },
    { id: 'sm_casa_d', w: 4, h: 4, floors: 2, style: 'beige', door: { side: 'E', i: 1 }, roof: 15 },
    { id: 'sm_casa_e', w: 5, h: 5, floors: 1, style: 'crema', door: { side: 'S', i: 3 }, roof: 17, awning: '#b0473a', upper: { x: 0, y: 0, w: 2, h: 3, floors: 1 } },
    { id: 'sm_almacen', w: 6, h: 5, floors: 1, style: 'madera', door: { side: 'S', i: 2 }, roof: 15 },
    { id: 'sm_torre_muralla', w: 3, h: 3, floors: 2, style: 'piedra', roof: 17, parapet: 'muro' },
    { id: 'sm_faro', w: 3, h: 3, floors: 3, style: 'cal', door: { side: 'S', i: 1 }, roof: 17, parapet: 'baranda', upper: { x: 1, y: 1, w: 1, h: 1, floors: 1 } },
];
export const townBuilding = (id: string): TownBuilding => { const b = TOWN_BUILDINGS.find((q) => q.id === id); if (!b) throw new Error(`edificio desconocido: ${id}`); return b; };

/**
 * Muebles de Kenney ("Isometric Dungeon", CC0) agrandados para los interiores: a la escala del piso (0,375) una mesa queda del
 * tamaño de un juguete al lado de un personaje. El script los toma de dungeon.webp (ya en el repo) y los agranda 1,6x.
 */
export const KENNEY_FURNITURE = ['barrel', 'barrels', 'barrelsStacked', 'chair', 'chestClosed', 'chestOpen', 'stoneColumn', 'stoneColumnWood', 'tableChairsBroken', 'tableRound', 'tableRoundChairs', 'tableRoundItemsChairs', 'tableShort', 'tableShortChairs', 'woodenCrate', 'woodenCrates', 'woodenPile'] as const;
export const FURNITURE_BASE = 3500, FURNITURE_SCALE = 1.6;
export const townFurniture = (name: (typeof KENNEY_FURNITURE)[number], o: 'N' | 'E' | 'S' | 'W' = 'S'): number => FURNITURE_BASE + KENNEY_FURNITURE.indexOf(name) * 4 + ['N', 'E', 'S', 'W'].indexOf(o);

/** Color aproximado de un tile del kit para el minimapa (null si no es del kit). */
export function townTileRGB(id: number): [number, number, number] | null {
    if (id < TOWN_BASE || id >= TOWN_BASE + TOWN_SHEETS.length * 18) return null;
    const s = TOWN_SHEETS[Math.floor((id - TOWN_BASE) / 18)];
    if (s === 'water') return [52, 112, 150];
    if (s === 'forest') return [70, 100, 52];
    return [150, 136, 104];
}
