/**
 * Mapas importados de Flare (docs/MAPAS_FLARE.md): campos de caza y mazmorras (tiers T1-T7) al tamaño nativo del mapa original, con 3 pits de mobs
 * distintos y mobs sueltos entre medio. Los datos los genera tools/src/flare/maps.ts (CC-BY-SA 3.0, ver CREDITS) y los tiles salen del
 * atlas `flare_<hoja>.webp` (tools/src/flare/mapatlas.ts). Todo es dato fijo: cliente y server arman exactamente lo mismo.
 *   Villa de Solmar / Ciudadela de Vhar --portal--> Campos de Sal -> Bosque de Piedra -> Cañón goblin -> Pantano de Merrimead
 *   Pantano -> Altas de Nazia (Nv 4-5) y Pantano -> Cementerio de Lochport (Nv 5) -> Risco del Sur (Nv 5-6) -> La Brecha (Nv 6-7, cueva)
 *   T6-T7: Cenizas III -> Granja de Roble Negro -> Oasis de Ceniza -> Lago Kuuma -> Laguna de la Gruta -> Minas abandonadas
 *   Mazmorras de grupo (una por tier, docs/TIERS_DE_ZONA.md): Cañón goblin -> D1, Altas de Nazia -> D2, Cementerio -> D3, La Brecha -> D4, Cenizas II -> D5, Cenizas III -> D6, Lago Kuuma -> D7
 */
import type { Prop, WorldMap, Zone } from '../index';
import type { MapDef, Link, MapRect } from '../maps';
import type { MobType } from '../mobs';
import { DUNGEON_ENTRY_KEYS } from '../quests';
import { VHAR_SUFFIX, baseMapId, nationOfMap } from '../nations';
import { flareTile, type FlareMapData } from './types';
import { DATA as SALTED_FIELD } from './salted_field';
import { DATA as STONEWOOD } from './stonewood';
import { DATA as GOBLIN_CAMP } from './goblin_camp';
import { DATA as MERRIMEAD_SWAMP } from './merrimead_swamp';
import { DATA as NAZIA_HIGHLANDS } from './nazia_highlands';
import { DATA as LOCHPORT_CEMETERY } from './lochport_cemetery';
import { DATA as SOUTHERN_RIDGE } from './southern_ridge';
import { DATA as THE_BREACH } from './the_breach';
import { DATA as GOBLIN_CAVE } from './goblin_cave';
import { DATA as PERDITION_MINES } from './perdition_mines';
import { DATA as ANTLION_NEST } from './antlion_nest';
import { DATA as STORMROCK_RUINS } from './stormrock_ruins';
import { DATA as ST_MARIA_2 } from './st_maria_2';
import { DATA as ST_MARIA_3 } from './st_maria_3';
import { DATA as WIZARDS_TOWER_1 } from './wizards_tower_1';
import { DATA as WIZARDS_TOWER_2 } from './wizards_tower_2';
import { DATA as TEMPLE_OF_MEZ_1 } from './temple_of_mez_1';
import { DATA as TEMPLE_OF_MEZ_2 } from './temple_of_mez_2';
import { DATA as UNDERWORLD_STRONGHOLD_1 } from './underworld_stronghold_1';
import { DATA as THE_PIT } from './the_pit';
import { DATA as STORMROCK_PASS } from './stormrock_pass';
import { DATA as UNDERWORLD } from './underworld';
import { DATA as UNDERWORLD_CATACOMBS } from './underworld_catacombs';
import { DATA as UNDERWORLD_MINES } from './underworld_mines';
import { DATA as OASIS } from './oasis';
import { DATA as LAKE_KUUMA } from './lake_kuuma';
import { DATA as GROT_LAGOON } from './grot_lagoon';
import { DATA as BLACK_OAK_FARM } from './black_oak_farm';
import { DATA as ABANDONED_MINES } from './abandoned_mines';
import { DATA as FORT_AMIR } from './fort_amir';
import { DATA as TORTURE_CHAMBERS } from './torture_chambers';

export { flareTile, FLARE_BASE } from './types';

/**
 * Campos de Sal propios por nación (docs/CIUDADES.md §8): el de Solmar es el de siempre (`campos_de_sal`) y el de Vhar es una copia exacta
 * del mapa (`campos_de_sal_vhar`) con las zonas renombradas (el validador no admite el mismo nombre de zona en dos mapas). Cada ciudad sale a
 * su campo y los dos se juntan en el Bosque de Piedra: el de Solmar por el borde oeste de siempre, el de Vhar por una salida propia más al norte.
 */
const SALTED_FIELD_VHAR: FlareMapData = {
    ...SALTED_FIELD, id: 'salted_field_vhar', eris: 'campos_de_sal_vhar', name: 'Campos de Sal (Vhar)',
    zones: SALTED_FIELD.zones.map((z) => ({ ...z, name: `${z.name} (Vhar)` })),
    // llega al Bosque de Piedra junto a su propia salida, no junto a la de Solmar
    links: SALTED_FIELD.links.map((l) => (l.to === 'stonewood' ? { ...l, tx: 2, ty: 6 } : l)),
};
const STONEWOOD_2: FlareMapData = {
    ...STONEWOOD,
    extras: [...STONEWOOD.extras, { to: SALTED_FIELD_VHAR.eris, cell: { x: 1, y: 6 }, kind: 'walk', arrive: { x: 56, y: 12 } }, { to: 'canon_goblin_vhar', cell: { x: 51, y: 77 }, kind: 'walk', arrive: { x: 5, y: 2 } }],
};
/**
 * Mapas de leveo propios de cada nación (src/nations.ts): Solmar usa los de siempre y Vhar tiene una copia de cada uno (zonas renombradas,
 * porque el validador no admite el mismo nombre de zona en dos mapas) con sus salidas y mazmorras hacia las copias de Vhar. Los puntos de
 * contacto con mapas compartidos (el Bosque de Piedra y el Pantano de Merrimead) tienen una puerta aparte para cada nación.
 */
const SPLIT_BASE = [GOBLIN_CAMP, GOBLIN_CAVE, PERDITION_MINES, MERRIMEAD_SWAMP, NAZIA_HIGHLANDS, ANTLION_NEST, STORMROCK_RUINS, LOCHPORT_CEMETERY, SOUTHERN_RIDGE, THE_BREACH, ST_MARIA_2, ST_MARIA_3, WIZARDS_TOWER_1, WIZARDS_TOWER_2];
const SPLIT_IDS = new Set(SPLIT_BASE.map((d) => d.id)), SPLIT_ERIS = new Set(SPLIT_BASE.map((d) => d.eris));
/** `linkTo`: celda de llegada propia de la copia en un mapa compartido, por destino (`id`) o por destino y celda del vínculo (`id@x,y`). */
const vharCopy = (d: FlareMapData, linkTo: Record<string, Partial<{ tx: number; ty: number }>> = {}): FlareMapData => ({
    ...d, id: d.id + VHAR_SUFFIX, eris: d.eris + VHAR_SUFFIX, name: `${d.name} (Vhar)`,
    ...(d.respawnMap ? { respawnMap: d.respawnMap + VHAR_SUFFIX } : {}),
    zones: d.zones.map((z) => ({ ...z, name: `${z.name} (Vhar)` })),
    links: d.links.map((l) => (SPLIT_IDS.has(l.to) ? { ...l, to: l.to + VHAR_SUFFIX } : { ...l, ...linkTo[l.to], ...linkTo[`${l.to}@${l.cell.x},${l.cell.y}`] })),
    extras: d.extras.map((e) => (SPLIT_ERIS.has(e.to) ? { ...e, to: e.to + VHAR_SUFFIX } : e)),
});
// llega a los mapas compartidos (el Bosque de Piedra y el Paso de Stormrock) junto a la puerta de su nación, no junto a la de Solmar
const VHAR_OVER: Record<string, Parameters<typeof vharCopy>[1]> = {
    goblin_camp: { stonewood: { tx: 51, ty: 76 } },
    the_breach: { 'stormrock_pass@7,62': { tx: 28, ty: 81 }, 'stormrock_pass@92,89': { tx: 100, ty: 106 } },
};
const VHAR_COPIES = SPLIT_BASE.map((d) => vharCopy(d, VHAR_OVER[d.id]));
const THE_BREACH_VHAR = VHAR_COPIES.find((d) => d.id === 'the_breach_vhar')!;
const STORMROCK_PASS_2: FlareMapData = {
    ...STORMROCK_PASS,
    extras: [...STORMROCK_PASS.extras,
        { to: THE_BREACH_VHAR.eris, cell: { x: 28, y: 80 }, kind: 'walk', arrive: { x: 5, y: 59 } },
        { to: THE_BREACH_VHAR.eris, cell: { x: 100, y: 105 }, kind: 'walk', arrive: { x: 89, y: 87 } }],
};
export type { FlareMapData } from './types';

/** En el orden de la cadena: la primera es la que une el portal de las ciudades. */
export const FLARE_DATA: FlareMapData[] = [SALTED_FIELD, SALTED_FIELD_VHAR, STONEWOOD_2, GOBLIN_CAMP, MERRIMEAD_SWAMP, NAZIA_HIGHLANDS, LOCHPORT_CEMETERY, SOUTHERN_RIDGE, THE_BREACH, GOBLIN_CAVE, PERDITION_MINES, ANTLION_NEST, STORMROCK_RUINS, ST_MARIA_2, ST_MARIA_3, WIZARDS_TOWER_1, WIZARDS_TOWER_2, TEMPLE_OF_MEZ_1, TEMPLE_OF_MEZ_2, UNDERWORLD_STRONGHOLD_1, THE_PIT, STORMROCK_PASS_2, UNDERWORLD, UNDERWORLD_CATACOMBS, UNDERWORLD_MINES, BLACK_OAK_FARM, OASIS, LAKE_KUUMA, GROT_LAGOON, ABANDONED_MINES, FORT_AMIR, TORTURE_CHAMBERS, ...VHAR_COPIES];
const byFlareId = new Map(FLARE_DATA.map((d) => [d.id, d]));
const byEris = new Map(FLARE_DATA.map((d) => [d.eris, d]));
export const FLARE_FIRST = FLARE_DATA[0];
/** Campo de entrada de cada facción (el primer mapa de caza, nivel 1-2) y sus ids de ERIS. */
export const FLARE_FIELD: Record<string, FlareMapData> = { solmar: SALTED_FIELD, vhar: SALTED_FIELD_VHAR };
const FIELD_ERIS = new Set(Object.values(FLARE_FIELD).map((d) => d.eris));
/** Nación de cada campo de entrada: solo esa nación entra al campo y usa su portal de vuelta. */
const FIELD_FACTION: Record<string, string> = Object.fromEntries(Object.entries(FLARE_FIELD).map(([f, d]) => [d.eris, f]));

/** Radio de la zona segura (sin mobs) alrededor de la entrada y de cada vínculo. */
const SAFE_R = 5;
/** Segundos de reaparición: pits y sueltos. */
const PIT_RESPAWN = 10, LOOSE_RESPAWN = 22;
/**
 * Densidad de las mazmorras del corte (docs/MAZMORRAS.md): sin reaparición, los pisos de Flare traían demasiados mobs (D1 75, D2 141).
 * Primera pasada automática: se queda uno de cada `every` packs (en orden), con `n` mobs cada uno, y se sacan los sueltos. El jefe no se toca.
 * Queda D1 ≈ 25 y D2 ≈ 40, como en `mecanicas-de-jefe.md` §2, D3-D6 en 49, 49, 55 y 55 y D7 en 58. La ubicación fina de packs y élites se hace a mano sobre el mapa.
 */
export const DUNGEON_DENSITY: Record<string, { every: number; n: number }> = {
    cueva_goblin: { every: 2, n: 2 }, minas_goblin: { every: 2, n: 2 },
    nido_hormiga_leon: { every: 3, n: 3 }, ruinas_de_stormrock: { every: 3, n: 3 },
    // D3-D6: sube de a poco por tramo (49, 49, 55 y 55)
    cripta_olvidada: { every: 2, n: 3 }, sepulcro_profundo: { every: 2, n: 3 },
    torre_del_hechicero: { every: 3, n: 3 }, camaras_de_investigacion: { every: 3, n: 3 },
    templo_de_mez: { every: 2, n: 3 }, salon_de_mez: { every: 2, n: 3 },
    fortaleza_infernal: { every: 2, n: 3 }, foso_del_demonio: { every: 2, n: 3 },
    // D7 (el tope): la mazmorra más cargada, 58 con packs de 4 (con 3 quedaba en 52, debajo de D5 y D6)
    fuerte_amir: { every: 2, n: 4 }, camaras_de_tortura: { every: 2, n: 4 },
};
function thinZones<T extends { kind: string; n: number }>(eris: string, zones: T[]): T[] {
    const k = DUNGEON_DENSITY[baseMapId(eris)]; if (!k) return zones;
    let pit = 0;
    return zones.flatMap((z) => (z.kind === 'boss' ? [z] : z.kind === 'pit' && pit++ % k.every === 0 ? [{ ...z, n: Math.min(z.n, k.n) }] : []));
}

export interface Cell { x: number; y: number }
const walk = (d: FlareMapData, x: number, y: number): boolean => x >= 0 && y >= 0 && x < d.size && y < d.size && d.blocked[y][x] === 0;
/** Celda caminable más cercana a (x, y), o la misma si ya lo es. */
export function nearestWalkable(d: FlareMapData, x: number, y: number, avoid: Cell[] = []): Cell {
    for (let r = 0; r <= 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = { x: x + dx, y: y + dy };
        if (walk(d, c.x, c.y) && !avoid.some((a) => a.x === c.x && a.y === c.y)) return c;
    }
    throw new Error(`${d.id}: no hay celdas caminables cerca de (${x}, ${y})`);
}

/** Vínculos propios del mapa hacia los otros de Flare (los de Flare que apuntan a mapas que no importamos se descartan). */
function flareLinks(d: FlareMapData): Link[] {
    const out: Link[] = [], seen = new Map<string, number>();
    for (const l of d.links) {
        const to = byFlareId.get(l.to); if (!to) continue;
        const arrive = nearestWalkable(to, l.tx, l.ty, to.links.map((b) => b.cell));
        const n = seen.get(to.eris) ?? 0; seen.set(to.eris, n + 1);
        out.push({ id: `${d.eris}_a_${to.eris}${n ? `_${n + 1}` : ''}`, map: d.eris, x: l.cell.x, y: l.cell.y, to: { map: to.eris, ...arrive }, kind: l.gate ? 'door' : 'walk', ...(l.gate ? { gate: { lvl: l.gate } } : {}), msg: l.gate ? `Bajás a ${to.name}.` : `Seguís el camino hacia ${to.name}.` });
    }
    // Conexiones que Flare no trae: portales de piedra en dos sentidos (cada mapa declara la suya).
    for (const e of d.extras) {
        const to = byEris.get(e.to); if (!to) throw new Error(`${d.id}: la conexión extra apunta a '${e.to}', que no existe`);
        const avoid = [...to.links.map((b) => b.cell), ...to.extras.map((b) => b.cell), ...(FIELD_ERIS.has(to.eris) ? [FLARE_BACK] : [])];
        const n = seen.get(to.eris) ?? 0; seen.set(to.eris, n + 1);
        out.push({ id: `${d.eris}_a_${to.eris}${n ? `_${n + 1}` : ''}`, map: d.eris, x: e.cell.x, y: e.cell.y, to: { map: to.eris, ...nearestWalkable(to, e.arrive?.x ?? to.entry.x, e.arrive?.y ?? to.entry.y, avoid) }, kind: e.kind, ...(e.gate ? { gate: { lvl: e.gate } } : {}), msg: e.kind === 'walk' ? `Seguís el camino hacia ${to.name}.` : e.kind === 'door' ? `Bajás a ${to.name}.` : `Cruzás el portal hacia ${to.name}.` });
    }
    return out;
}

/** Celda de llegada desde las ciudades (la entrada del primer mapa) y celda del portal de vuelta (a unos pasos de ahí). */
export const FLARE_ARRIVAL: Cell = { ...FLARE_FIRST.entry };
export const FLARE_BACK: Cell = (() => {
    const taken = [FLARE_FIRST.entry, ...FLARE_FIRST.links.map((l) => l.cell)];
    for (const [dx, dy] of [[3, 0], [0, 3], [-3, 0], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3], [4, 0], [0, 4]] as const) {
        const x = FLARE_FIRST.entry.x + dx, y = FLARE_FIRST.entry.y + dy;
        if (walk(FLARE_FIRST, x, y) && !taken.some((t) => t.x === x && t.y === y)) return { x, y };
    }
    throw new Error('Campos de Sal: no hay celda para el portal de vuelta');
})();

/** Arma el mapa desde los datos importados. */
export function buildFlareMap(d: FlareMapData): WorldMap {
    const N = d.size;
    // El agua es la de Flare, teñida al armar el atlas (tools/src/flare/mapatlas.ts): conserva sus orillas, puentes y acantilados.
    const tiles = d.layers.background.map((row) => row.map((id) => (id ? flareTile(d.tileset, id) : 0)));
    const blocked = d.blocked.map((row) => row.map((v) => v === 1));
    const props: Prop[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const id = d.layers.object[y][x]; if (id) props.push({ id: flareTile(d.tileset, id), x, y }); }
    const safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const disc = (c: Cell, r: number) => { for (let y = Math.max(0, c.y - r); y <= Math.min(N - 1, c.y + r); y++) for (let x = Math.max(0, c.x - r); x <= Math.min(N - 1, c.x + r); x++) if (Math.hypot(x - c.x, y - c.y) <= r + 0.5) safe[y][x] = true; };
    disc(d.entry, SAFE_R);
    for (const l of d.links) disc(l.cell, SAFE_R);
    for (const e of d.extras) disc(e.cell, SAFE_R);
    if (FIELD_ERIS.has(d.eris)) disc(FLARE_BACK, SAFE_R);
    const zones: Zone[] = thinZones(d.eris, d.zones).map((z) => ({ type: z.type as MobType, x: z.x, y: z.y, r: z.r, n: z.n, name: z.name, lvl: z.lvl, ...(d.dungeon && z.kind !== 'boss' ? { tier: 'dungeon' as const } : {}), respawn: z.kind === 'pit' ? PIT_RESPAWN : LOOSE_RESPAWN, aggro: z.kind === 'pit' ? 3 : 4 }));
    return { size: N, tiles, blocked, safe, props, decals: [], zones, buildings: [], npcs: [], spawn: { ...d.entry }, fire: { x: -50, y: -50 }, ...(d.dungeon ? { dungeon: { x0: 0, y0: 0, x1: N - 1, y1: N - 1 } } : {}) };
}

/** A dónde vuelve quien se desconecta o sale de una mazmorra: la celda de llegada del mapa de superficie al que lleva (se sigue la cadena de pisos). */
function surfaceRest(d: FlareMapData, seen = new Set<string>()): { map: string; x: number; y: number } | undefined {
    seen.add(d.eris);
    for (const l of d.links) { const to = byFlareId.get(l.to); if (to && !to.dungeon) return { map: to.eris, ...nearestWalkable(to, l.tx, l.ty, [...to.links.map((b) => b.cell), ...to.extras.map((b) => b.cell)]) }; }
    for (const l of d.links) { const to = byFlareId.get(l.to); if (!to || !to.dungeon || seen.has(to.eris)) continue; const r = surfaceRest(to, seen); if (r) return r; }
    for (const e of d.extras) {
        const to = byEris.get(e.to); if (!to || seen.has(to.eris)) continue;
        if (!to.dungeon) return { map: to.eris, ...nearestWalkable(to, to.entry.x, to.entry.y, [...to.links.map((b) => b.cell), ...to.extras.map((b) => b.cell)]) };
        const r = surfaceRest(to, seen); if (r) return r;
    }
    return undefined;
}

/** Tramo intermedio 60–80 (D.5): mapas compartidos donde solo una parte es zona roja (PvP entre naciones); la entrada y los pits de leveo son zona abierta. */
export const RED_RECTS: Record<string, MapRect[]> = {
    paso_de_stormrock: [{ x0: 0, y0: 0, x1: 131, y1: 57 }], // norte: pit C y salida a Cenizas I; al sur, las puertas de la Brecha y los pits A/B son zona abierta
    cenizas_i: [{ x0: 71, y0: 0, x1: 119, y1: 119 }], // este: pits B/C y salida; al oeste, la entrada y el pit A
    cenizas_ii: [{ x0: 0, y0: 0, x1: 119, y1: 65 }], // norte: pits B/C y salidas; al sur, la entrada y el pit A
};

/** Definiciones de mapa de los mapas de Flare. `hub` = vínculo de vuelta del primero a la ciudad que lo une (lo pone maps.ts). */
export function flareMaps(hubs: Record<string, { map: string; to: Cell }>): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    for (const d of FLARE_DATA) {
        const links = flareLinks(d);
        // puertas con llave (docs/LLAVES.md): la entrada desde la superficie al primer piso pide la llave de esa mazmorra
        if (!d.dungeon) for (const l of links) { const k = DUNGEON_ENTRY_KEYS[baseMapId(l.to.map)]; if (k) l.gate = { ...(l.gate ?? {}), key: k }; }
        const hub = hubs[d.eris];
        if (hub) links.push({ id: d === FLARE_FIRST ? 'campos_a_ciudad' : `${d.eris}_a_ciudad`, map: d.eris, ...FLARE_BACK, to: { map: hub.map, ...hub.to }, kind: 'portal', gate: { faction: FIELD_FACTION[d.eris] }, msg: 'Cruzás el portal de vuelta a la ciudad.' });
        // al campo de una nación se entra desde el Bosque de Piedra solo siendo de esa nación (las ciudades ya llevan a la suya)
        for (const l of links) { const f = FIELD_FACTION[l.to.map] ?? nationOfMap(l.to.map); if (f && !FIELD_ERIS.has(d.eris)) l.gate = { ...(l.gate ?? {}), faction: f }; }
        const def: MapDef = {
            id: d.eris, name: d.name, region: d.region, size: d.size, lvl: d.lvl, tier: d.tier, pvp: d.pvp, safe: false,
            spawn: { ...d.entry }, respawn: { ...d.entry }, links, build: () => buildFlareMap(byEris.get(d.eris)!),
        };
        if (RED_RECTS[d.eris]) def.redRects = RED_RECTS[d.eris];
        if (d.dungeon) {
            // mazmorra: la posición no se guarda (al reconectar volvés a la superficie) y al morir reaparecés en la entrada del piso 1
            const rest = surfaceRest(d); if (!rest) throw new Error(`${d.id}: la mazmorra no lleva a ningún mapa de superficie`);
            const first = d.respawnMap ? byEris.get(d.respawnMap) : undefined;
            def.temporary = true; def.rest = rest;
            if (first) def.respawn = { map: first.eris, ...first.entry };
        }
        out[d.eris] = def;
    }
    return out;
}
