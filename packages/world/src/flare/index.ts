/**
 * Mapas importados de Flare (docs/MAPAS_FLARE.md): campos de caza de nivel 1-3 al tamaño nativo del mapa original, con 3 pits de mobs
 * distintos y mobs sueltos entre medio. Los datos los genera tools/src/flare/maps.ts (CC-BY-SA 3.0, ver CREDITS) y los tiles salen del
 * atlas `flare_<hoja>.webp` (tools/src/flare/mapatlas.ts). Todo es dato fijo: cliente y server arman exactamente lo mismo.
 *   Villa de Solmar / Ciudadela de Vhar --portal--> Campos de Sal -> Bosque de Piedra -> Cañón goblin
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

export { flareTile, FLARE_BASE } from './types';
export type { FlareMapData } from './types';

/** En el orden de la cadena: la primera es la que une el portal de las ciudades. */
export const FLARE_DATA: FlareMapData[] = [SALTED_FIELD, STONEWOOD, GOBLIN_CAMP];
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
        out.push({ id: `${d.eris}_a_${to.eris}${n ? `_${n + 1}` : ''}`, map: d.eris, x: l.cell.x, y: l.cell.y, to: { map: to.eris, ...arrive }, kind: 'walk', msg: `Seguís el camino hacia ${to.name}.` });
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
    if (d === FLARE_FIRST) disc(FLARE_BACK, SAFE_R);
    const zones: Zone[] = d.zones.map((z) => ({ type: z.type as MobType, x: z.x, y: z.y, r: z.r, n: z.n, name: z.name, lvl: z.lvl, respawn: z.kind === 'pit' ? PIT_RESPAWN : LOOSE_RESPAWN, aggro: z.kind === 'pit' ? 3 : 4 }));
    return { size: N, tiles, blocked, safe, props, decals: [], zones, buildings: [], npcs: [], spawn: { ...d.entry }, fire: { x: -50, y: -50 } };
}

/** Definiciones de mapa de los mapas de Flare. `hub` = vínculo de vuelta del primero a la ciudad que lo une (lo pone maps.ts). */
export function flareMaps(hub: { map: string; to: Cell }): Record<string, MapDef> {
    const out: Record<string, MapDef> = {};
    for (const d of FLARE_DATA) {
        const links = flareLinks(d);
        if (d === FLARE_FIRST) links.push({ id: 'campos_a_ciudad', map: d.eris, ...FLARE_BACK, to: { map: hub.map, ...hub.to }, kind: 'portal', msg: 'Cruzás el portal de vuelta a la ciudad.' });
        out[d.eris] = {
            id: d.eris, name: d.name, region: d.region, size: d.size, lvl: d.lvl, pvp: d.pvp, safe: false,
            spawn: { ...d.entry }, respawn: { ...d.entry }, links, build: () => buildFlareMap(byEris.get(d.eris)!),
        };
    }
    return out;
}
