/**
 * Mapas importados de Flare (docs/MAPAS_FLARE.md): campos de caza de nivel 1-3 al tamaño nativo del mapa original, con 3 pits de mobs
 * distintos y mobs sueltos entre medio. Los datos los genera tools/src/flare/maps.ts (CC-BY-SA 3.0, ver CREDITS) y los tiles salen del
 * atlas `flare_<hoja>.webp` (tools/src/flare/mapatlas.ts). Todo es dato fijo: cliente y server arman exactamente lo mismo.
 *   Villa de Solmar / Ciudadela de Vhar --portal--> Campos de Sal -> Bosque de Piedra -> Cañón goblin -> Pantano de Merrimead
 *   Pantano -> Altas de Nazia (Nv 4-5) y Pantano -> Cementerio de Lochport (Nv 5) -> Risco del Sur (Nv 5-6) -> La Brecha (Nv 6-7, cueva)
 *   Cañón goblin --puerta Nv 2--> Cueva goblin -> Minas goblin (D1, mazmorra de grupo con jefe final)
 */
import type { Prop, WorldMap, Zone } from '../index';
import type { MapDef, Link } from '../maps';
import type { MobType } from '../mobs';
import { townTile } from '../town';
import { noise2 } from '../solmar/kit';
import { flareTile, isFlareWater, type FlareMapData } from './types';
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

export { flareTile, FLARE_BASE } from './types';
export type { FlareMapData } from './types';

/** En el orden de la cadena: la primera es la que une el portal de las ciudades. */
export const FLARE_DATA: FlareMapData[] = [SALTED_FIELD, STONEWOOD, GOBLIN_CAMP, MERRIMEAD_SWAMP, NAZIA_HIGHLANDS, LOCHPORT_CEMETERY, SOUTHERN_RIDGE, THE_BREACH, GOBLIN_CAVE, PERDITION_MINES, ANTLION_NEST, STORMROCK_RUINS, ST_MARIA_2, ST_MARIA_3, WIZARDS_TOWER_1, WIZARDS_TOWER_2, TEMPLE_OF_MEZ_1, TEMPLE_OF_MEZ_2, UNDERWORLD_STRONGHOLD_1, THE_PIT, STORMROCK_PASS, UNDERWORLD, UNDERWORLD_CATACOMBS, UNDERWORLD_MINES];
const byFlareId = new Map(FLARE_DATA.map((d) => [d.id, d]));
const byEris = new Map(FLARE_DATA.map((d) => [d.eris, d]));
export const FLARE_FIRST = FLARE_DATA[0];

const WATER_SHALLOW = [1, 4], WATER_DEEP = [13, 16];
/** Radio de la zona segura (sin mobs) alrededor de la entrada y de cada vínculo. */
const SAFE_R = 5;
/** Segundos de reaparición: pits y sueltos. */
const PIT_RESPAWN = 10, LOOSE_RESPAWN = 22;

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
        const avoid = [...to.links.map((b) => b.cell), ...to.extras.map((b) => b.cell), ...(to === FLARE_FIRST ? [FLARE_BACK] : [])];
        out.push({ id: `${d.eris}_a_${to.eris}`, map: d.eris, x: e.cell.x, y: e.cell.y, to: { map: to.eris, ...nearestWalkable(to, to.entry.x, to.entry.y, avoid) }, kind: e.kind, ...(e.gate ? { gate: { lvl: e.gate } } : {}), msg: e.kind === 'door' ? `Bajás a ${to.name}.` : `Cruzás el portal hacia ${to.name}.` });
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
    // El agua de Flare es casi negra: se cambia por el agua del kit de ciudad (orilla clara; profunda si todo alrededor es agua).
    const isWater = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < N && y < N && isFlareWater(d.tileset, d.layers.background[y][x]);
    const tiles = d.layers.background.map((row, y) => row.map((id, x) => {
        if (!id) return 0;
        if (!isWater(x, y)) return flareTile(d.tileset, id);
        const deep = isWater(x - 1, y) && isWater(x + 1, y) && isWater(x, y - 1) && isWater(x, y + 1);
        return townTile('water', (deep ? WATER_DEEP : WATER_SHALLOW)[noise2(x, y, 91, 6) < 0.5 ? 0 : 1]); // manchones suaves, sin dibujo de tablero
    }));
    const blocked = d.blocked.map((row) => row.map((v) => v === 1));
    const props: Prop[] = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const id = d.layers.object[y][x]; if (id) props.push({ id: flareTile(d.tileset, id), x, y }); }
    const safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const disc = (c: Cell, r: number) => { for (let y = Math.max(0, c.y - r); y <= Math.min(N - 1, c.y + r); y++) for (let x = Math.max(0, c.x - r); x <= Math.min(N - 1, c.x + r); x++) if (Math.hypot(x - c.x, y - c.y) <= r + 0.5) safe[y][x] = true; };
    disc(d.entry, SAFE_R);
    for (const l of d.links) disc(l.cell, SAFE_R);
    for (const e of d.extras) disc(e.cell, SAFE_R);
    if (d === FLARE_FIRST) disc(FLARE_BACK, SAFE_R);
    const zones: Zone[] = d.zones.map((z) => ({ type: z.type as MobType, x: z.x, y: z.y, r: z.r, n: z.n, name: z.name, lvl: z.lvl, ...(d.dungeon && z.kind !== 'boss' ? { tier: 'dungeon' as const } : {}), respawn: z.kind === 'pit' ? PIT_RESPAWN : LOOSE_RESPAWN, aggro: z.kind === 'pit' ? 3 : 4 }));
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

/** Definiciones de mapa de los mapas de Flare. `hub` = vínculo de vuelta del primero a la ciudad que lo une (lo pone maps.ts). */
export function flareMaps(hub: { map: string; to: Cell }): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    for (const d of FLARE_DATA) {
        const links = flareLinks(d);
        if (d === FLARE_FIRST) links.push({ id: 'campos_a_ciudad', map: d.eris, ...FLARE_BACK, to: { map: hub.map, ...hub.to }, kind: 'portal', msg: 'Cruzás el portal de vuelta a la ciudad.' });
        const def: MapDef = {
            id: d.eris, name: d.name, region: d.region, size: d.size, lvl: d.lvl, pvp: d.pvp, safe: false,
            spawn: { ...d.entry }, respawn: { ...d.entry }, links, build: () => buildFlareMap(byEris.get(d.eris)!),
        };
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
