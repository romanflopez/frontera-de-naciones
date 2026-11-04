import type { Tier } from '../tiers';
/**
 * Forma de los datos de un mapa importado de Flare (los genera tools/src/flare/maps.ts; docs/MAPAS_FLARE.md).
 * Las capas llevan los ids de tile de Flare: `flareTile(tileset, id)` los pasa a los ids del atlas de ERIS.
 */
export interface FlareZone {
    /** Tipo de mob (un `MobType`; el test de los mapas de Flare comprueba que existe). */
    type: string; x: number; y: number; r: number; n: number; name: string; lvl: number;
    /** `pit` = zona de caza con su mob; `loose` = mobs sueltos entre los pits. `pit` = 0 (A, cerca de la entrada), 1 (B) o 2 (C, lejos). */
    kind: 'pit' | 'loose' | 'boss'; pit?: number;
}
export interface FlareLinkData { cell: { x: number; y: number }; to: string; tx: number; ty: number; tooltip: string; /** Nivel mínimo para pasar (la puerta de una mazmorra). */ gate?: number }
export interface FlareMapData {
    /** Id del mapa en Flare y en ERIS. */
    id: string; eris: string; name: string; region: string; pvp: 'off' | 'faction'; lvl: [number, number];
    /** Tier de zona (docs/TIERS_DE_ZONA.md); `lvl` es el sub-rango del tier que cubre el mapa. */
    tier: Tier;
    /** Mazmorra de grupo: mobs con `tier: 'dungeon'`, sin PvP, posición temporal y el mapa oscurecido. `respawnMap` = piso donde reaparecés si no es este. */
    dungeon?: boolean; respawnMap?: string;
    /** Hoja de tiles de Flare (`grassland`, `cave`, `dungeon`…). */
    tileset: string;
    /** Lado del cuadrado de ERIS y tamaño original en Flare. */
    size: number; flareSize: [number, number];
    /** Entrada del mapa (celda caminable). */
    entry: { x: number; y: number };
    source: string; license: string;
    /** Celdas caminables (todas alcanzables a pie desde la entrada). */
    walkable: number;
    zones: FlareZone[];
    /** Vínculos de Flare hacia otros mapas (`to` = id de Flare; `tx,ty` = celda de llegada allá). */
    links: FlareLinkData[];
    /** Conexiones que Flare no trae (`to` = id de ERIS del otro mapa): portales de piedra en esta celda. */
    extras: { to: string; cell: { x: number; y: number }; kind: 'portal' | 'door' | 'walk'; gate?: number; /** Celda de llegada en el otro mapa (por defecto su entrada). */ arrive?: { x: number; y: number } }[];
    layers: { background: number[][]; object: number[][] };
    /** 1 = bloqueada. */
    blocked: number[][];
}

/** Ids de ERIS de las piezas de cada hoja de Flare: base + id de Flare (los ids de Flare son < 1000). */
export const FLARE_BASE: Record<string, number> = { grassland: 20000, cave: 21000, dungeon: 22000, snowplains: 23000 };
export const flareTile = (tileset: string, id: number): number => (FLARE_BASE[tileset] ?? 0) + id;

/**
 * Ids de agua de cada hoja de Flare (rango, ambos incluidos). Las losetas de agua de Flare son casi negras: al armar el mapa se
 * cambian por el agua del kit de ciudad (ver index.ts) y no entran al atlas.
 */
export const FLARE_WATER: Record<string, [number, number]> = { grassland: [144, 207], snowplains: [144, 165] };
export const isFlareWater = (tileset: string, id: number): boolean => { const r = FLARE_WATER[tileset]; return !!r && id >= r[0] && id <= r[1]; };

/**
 * Acantilados de cada hoja (rango de ids): Flare pinta de negro la cara de atrás porque detrás iba el vacío. Como el vacío se rellena
 * con bosque, esos píxeles negros se hacen transparentes al armar el atlas (tools/src/flare/mapatlas.ts).
 */
export const FLARE_CLIFF: Record<string, [number, number][]> = { grassland: [[48, 71]], cave: [[64, 121]], dungeon: [[48, 117], [208, 223], [280, 283]], snowplains: [[48, 71], [176, 183]] };
export const isFlareCliff = (tileset: string, id: number): boolean => !!FLARE_CLIFF[tileset]?.some((r) => id >= r[0] && id <= r[1]);

/**
 * Piezas oscurecidas que no existen en Flare: copias de un rango de piso de la hoja con el brillo multiplicado por `k`, con ids
 * `base + (id - from)`. Sirven de piso del vacío en las cuevas: roca oscura bajo las caras transparentes de las paredes, en vez del
 * negro de Flare o del musgo verde. Las arma tools/src/flare/mapatlas.ts.
 */
export const FLARE_SHADE: Record<string, { from: number; to: number; bands: { base: number; k: number }[] }> = {
    // tres bandas de oscuridad: la primera fila de vacío pegada al mapa, la segunda y el resto (se funde a negro, como una cueva de verdad)
    cave: { from: 16, to: 31, bands: [{ base: 900, k: 0.3 }, { base: 920, k: 0.16 }, { base: 940, k: 0.07 }] },
    dungeon: { from: 16, to: 23, bands: [{ base: 900, k: 0.34 }, { base: 920, k: 0.18 }, { base: 940, k: 0.08 }] },
};
const shadeBand = (tileset: string, id: number) => { const s = FLARE_SHADE[tileset]; const b = s?.bands.find((q) => id >= q.base && id <= q.base + s.to - s.from); return s && b ? { s, b } : undefined; };
/** Pieza de Flare de la que sale una pieza oscurecida (o undefined si no lo es). */
export const shadeSource = (tileset: string, id: number): number | undefined => { const r = shadeBand(tileset, id); return r ? r.s.from + id - r.b.base : undefined; };
/** Brillo de una pieza oscurecida (1 si no lo es). */
export const shadeK = (tileset: string, id: number): number => shadeBand(tileset, id)?.b.k ?? 1;
/** Id de la pieza oscurecida de `id` (piso de la hoja) en la banda `band` (0 = la más clara). */
export const shadeId = (tileset: string, id: number, band: number): number => { const s = FLARE_SHADE[tileset]; const b = s.bands[Math.min(band, s.bands.length - 1)]; return b.base + id - s.from; };
