/**
 * Constructor común de las dos ciudades rediseñadas (docs/CIUDADES.md): Villa de Solmar y Ciudadela de Vhar comparten la planta y
 * cambian de materiales, de clima y de lado del portón. Mapa de 58x58: recinto amurallado de 38x38 con cuatro torres, plaza central
 * con el Portal de Frontera, ocho edificios con interior (los de `buildings`), tres casas de relleno y calles de adoquín.
 *
 * Los edificios son sprites pre-renderizados (`sm2_*` / `vh2_*`, de tools/src/iso3d/city_edificios.py). Cada uno tiene la puerta en la
 * cara sur ('S') o este ('E'): las dos que mira la cámara. Los de `buildings` tienen la puerta sobre la plaza o sobre una avenida.
 *
 * Coordenadas: x crece hacia abajo-derecha de la pantalla, y hacia abajo-izquierda. La muralla norte es y = 9, la oeste x = 9, la sur
 * y = 48 y la este x = 48 (las dos últimas son las que se ven).
 */
import type { WorldMap } from '../index';
import { kenney } from '../frontier';
import { CRATES_WOOD, FOAM, TOWN_PROPS, townTile } from '../town';
import { noise2, TownMap } from './kit';

export const CITY_N = 58;
/** Planta común: esquina norte (x, y) de cada edificio con interior. */
export const CITY_BUILDINGS = {
    templo: { x: 18, y: 14 }, ayuntamiento: { x: 26, y: 15 }, torre: { x: 36, y: 17 }, deposito: { x: 42, y: 16 },
    tienda: { x: 15, y: 23 }, joyeria: { x: 16, y: 30 }, cuartel: { x: 13, y: 35 }, herreria: { x: 41, y: 23 },
} as const;
export type CityBuilding = keyof typeof CITY_BUILDINGS;
/** Casas de relleno: [sprite, x, y]. */
const HOUSES: readonly [string, number, number][] = [['casa_b', 24, 40], ['casa_b', 24, 44], ['casa_c', 33, 40]];
/** Aparición, portal y portón de cada lado. El portón este (Solmar) da a x = 56; el sur (Vhar), a y = 56. */
export const CITY_SPAWN = { x: 29, y: 32 }, CITY_PORTAL = { x: 29, y: 27 };
export const GATE_EAST = { toLegacy: { x: 56, y: 28 }, fromLegacy: { x: 52, y: 28 } };
export const GATE_SOUTH = { toLegacy: { x: 28, y: 56 }, fromLegacy: { x: 28, y: 52 } };

const SAND = [townTile('terrain2', 17)];
const WATER_SHALLOW = [townTile('water', 14), townTile('water', 17)];
const WATER = [townTile('water', 1), townTile('water', 4)];
const WATER_DEEP = [townTile('water', 13), townTile('water', 16)];
const PLANKS = [kenney('planks', 'N'), kenney('planks', 'S')];

export interface CityCfg {
    id: string; seed: number;
    /** Lado del mapa en celdas (por defecto CITY_N); las ciudades con costa tienen más lugar al sur para el mar. */
    size?: number;
    /** Costa al sur con playa, mar, muelle y un segundo portón (el del puerto) sobre la avenida sur. */
    harbor?: boolean; prefix: 'sm2_' | 'vh2_'; faction: 'solmar' | 'vhar'; name: string;
    /** Lado del portón: 'E' (en la muralla este) o 'S' (en la sur). */
    gate: 'E' | 'S';
    ground: readonly number[]; cobble: readonly number[]; plaza: readonly number[]; ring: readonly number[];
    /** Pisos del exterior de la muralla (con su propio ruido: bosque, nieve...). */
    outsideTile: (x: number, y: number, pick: <T>(a: readonly T[]) => T) => number;
    /** Árboles, flores y piedras sueltas (ids de props) para jardines y exterior. */
    trees: readonly number[]; outsideTrees: readonly number[]; flowers: readonly number[]; rocks: readonly number[];
    lamp: number; flag: number;
    /** Densidad de árboles afuera de la muralla y adentro (por celda libre). */
    treeDensity?: { out: number; in: number };
    guards: readonly [string, string, number, number, number][];
}

export function buildCity(cfg: CityCfg): WorldMap {
    const N = cfg.size ?? CITY_N, t = new TownMap(N, cfg.seed, cfg.ground[0]);
    const isWater = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const coast = (x: number) => 54 + Math.round(noise2(x, 0, 7, 9) * 2);
    const { rnd, pick, w } = t;
    const gate = cfg.gate === 'E' ? GATE_EAST : GATE_SOUTH;
    const id = (n: string) => cfg.prefix + n;
    // ---------- 1) suelo: adentro el de la ciudad, afuera el del clima ----------
    t.rect(0, 0, N - 1, N - 1, (x, y) => {
        if (cfg.harbor && y >= 50) {                      // al sur: playa y mar, de lado a lado del mapa
            if (y >= coast(x)) {
                isWater[y][x] = true; t.block(x, y);
                const depth = y - coast(x);
                t.tile(x, y, depth < 2 ? pick(WATER_SHALLOW) : depth < 6 ? pick(WATER) : pick(WATER_DEEP));
            } else t.tile(x, y, pick(SAND));
            return;
        }
        t.tile(x, y, x < 8 || y < 8 || x > 49 || y > 49 ? cfg.outsideTile(x, y, pick) : pick(cfg.ground));
    });
    // ---------- 2) plaza, anillo, avenidas y camino del portón (reservados) ----------
    const street = (x0: number, y0: number, x1: number, y1: number, tiles: readonly number[] = cfg.cobble) => { t.rect(x0, y0, x1, y1, (x, y) => { t.tile(x, y, pick(tiles)); t.keep[y][x] = true; }); };
    street(21, 21, 38, 38, cfg.plaza);
    t.rect(23, 23, 36, 36, (x, y) => { const d = Math.max(Math.abs(x - 29.5), Math.abs(y - 29.5)); if (d === 6.5 || d === 3.5) t.tile(x, y, pick(cfg.ring)); });
    street(10, 28, 20, 29);     // avenida oeste
    street(39, 28, 47, 31);     // avenida este (al portón este)
    street(28, 39, 31, 47);     // avenida sur (al portón sur)
    street(39, 21, 47, 22);     // calle noreste, para el depósito
    street(32, 44, 35, 45);     // vereda de la casa del sudeste
    if (cfg.gate === 'E') street(49, 28, 56, 29); else street(28, 49, 29, 56);
    if (cfg.harbor) street(28, 49, 31, 50);        // del portón del puerto al muelle
    // ---------- 3) muralla: cuatro torres y tramos de 4 celdas (el hueco del portón va en el medio del lado elegido) ----------
    for (const [x, y] of [[8, 8], [47, 8], [8, 47], [47, 47]] as const) t.building(id('torre_muralla'), x, y);
    for (let k = 0; k < 9; k++) {
        const p = 11 + 4 * k;
        t.building(id('muralla_x'), p, 9);                                        // norte
        t.building(id('muralla_y'), 9, p);                                        // oeste
        if ((cfg.gate === 'S' || cfg.harbor) && k === 4) t.building(id('porton_x'), p, 48); else t.building(id('muralla_x'), p, 48);   // sur
        if (cfg.gate === 'E' && k === 4) t.building(id('porton_y'), 48, p); else t.building(id('muralla_y'), 48, p);   // este
    }
    // el paso del portón (2 celdas) queda libre aunque el sprite ocupe toda la huella
    if (cfg.gate === 'E') { t.block(48, 28, false); t.block(48, 29, false); }
    if (cfg.gate === 'S' || cfg.harbor) { t.block(28, 48, false); t.block(29, 48, false); }
    // celdas de puerta y de llegada: nada que bloquee puede ir ahí
    const doors = new Set<string>();
    // ---------- 4) edificios con interior ----------
    for (const [k, b] of Object.entries(CITY_BUILDINGS) as [CityBuilding, { x: number; y: number }][]) {
        const d = t.building(id(k), b.x, b.y)!;
        t.tile(d.door.x, d.door.y, pick(cfg.ring)); t.tile(d.out.x, d.out.y, pick(cfg.cobble));
        doors.add(`${d.door.x},${d.door.y}`); doors.add(`${d.out.x},${d.out.y}`);
    }
    // ---------- 5) casas de relleno ----------
    for (const [n, x, y] of HOUSES) { const d = t.building(id(n), x, y); if (d) { t.tile(d.door.x, d.door.y, pick(cfg.ring)); doors.add(`${d.door.x},${d.door.y}`); doors.add(`${d.out.x},${d.out.y}`); } }
    // ---------- 6) plaza: dos fuentes, banderas y faroles ----------
    for (const [x, y] of [[24, 25], [33, 25]] as const) { t.rect(x, y, x + 2, y + 2, (cx, cy) => { t.keep[cy][cx] = false; }); t.building(id('fuente'), x, y); }
    for (const [x, y] of [[23, 23], [36, 23], [23, 36], [36, 36]] as const) { if (doors.has(`${x},${y}`)) continue; t.keep[y][x] = false; t.prop(cfg.flag, x, y); }
    for (const [x, y] of [[21, 21], [38, 21], [21, 38], [38, 38], [25, 21], [34, 21], [21, 30], [38, 30], [25, 38], [34, 38]] as const) { if (doors.has(`${x},${y}`)) continue; t.keep[y][x] = false; t.prop(cfg.lamp, x, y); }
    const lampAt = (x: number, y: number) => { if (t.in(x, y) && !w.blocked[y][x] && !t.keep[y][x]) t.prop(cfg.lamp, x, y); };
    for (let x = 12; x <= 46; x += 7) { lampAt(x, 27); lampAt(x + 3, 32); }
    for (let y = 12; y <= 46; y += 7) { lampAt(27, y); lampAt(32, y + 3); }
    // ---------- 6b) puerto: muelle de tablones sobre la avenida sur, con bolardos, cajas y botes; espuma en la orilla ----------
    if (cfg.harbor) {
        const pier = (x0: number, y0: number, x1: number, y1: number) => t.rect(x0, y0, x1, y1, (x, y) => { t.tile(x, y, pick(PLANKS)); t.block(x, y, false); isWater[y][x] = false; t.keep[y][x] = true; });
        pier(28, 51, 31, 61); pier(24, 59, 35, 61);
        for (const y of [53, 56, 59]) { t.keep[y][28] = t.keep[y][31] = false; t.prop(TOWN_PROPS.poste, 28, y); t.prop(TOWN_PROPS.poste, 31, y); }
        for (const x of [25, 34]) { t.keep[61][x] = false; t.prop(TOWN_PROPS.poste, x, 61); }
        for (const [x, y] of [[26, 60], [33, 60]] as const) { t.keep[y][x] = false; t.prop(pick(CRATES_WOOD), x, y); }
        t.keep[60][34] = false; t.prop(kenney('barrel', 'S'), 34, 60);
        for (const [pid, x, y] of [[TOWN_PROPS.bote, 25, 56], [TOWN_PROPS.bote2, 34, 57], [TOWN_PROPS.bote, 22, 61], [TOWN_PROPS.bote2, 38, 60]] as const) w.props.push({ id: pid, x: x + 0.5, y: y + 0.5 });
        t.rect(1, 50, N - 2, N - 2, (x, y) => {
            if (!isWater[y][x]) return;
            if (!isWater[y - 1][x]) t.decal(FOAM.ne, x, y);
            if (!isWater[y][x - 1]) t.decal(FOAM.nw, x, y);
            if (!isWater[y][x + 1]) t.decal(FOAM.se, x, y);
            if (!isWater[y + 1]?.[x]) t.decal(FOAM.sw, x, y);
        });
    }
    // ---------- 7) jardines adentro, bosque afuera ----------
    t.rect(1, 1, N - 2, N - 2, (x, y) => {
        if (w.blocked[y][x] || t.keep[y][x]) return;
        const outside = x < 8 || y < 8 || x > 49 || y > 49;
        if (cfg.harbor && y >= 50) { if (rnd() < 0.03) t.prop(pick(cfg.rocks), x, y); return; }
        if (outside) {
            const r = rnd(), d = cfg.treeDensity?.out ?? 0.16; if (r < d) t.prop(pick(cfg.outsideTrees), x, y); else if (r < d + 0.06) t.prop(pick(cfg.flowers), x, y, false); else if (r < d + 0.1) t.prop(pick(cfg.rocks), x, y);
            return;
        }
        const near = (dx: number, dy: number) => w.blocked[y + dy]?.[x + dx];
        const r = rnd();
        if (r < (cfg.treeDensity?.in ?? 0.05) && !near(1, 0) && !near(0, 1) && !near(-1, 0) && !near(0, -1)) t.prop(pick(cfg.trees), x, y);
        else if (r < 0.16) t.prop(pick(cfg.flowers), x, y, false);
        else if (r < 0.19) t.prop(pick(cfg.rocks), x, y);
    });
    // ---------- 8) guardias, zona segura, portal y vínculos ----------
    for (const [gid, name, x, y, dir] of cfg.guards) t.npc(gid, name, x, y, dir);
    w.safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(true));
    w.spawn = { ...CITY_SPAWN }; w.fire = { ...CITY_PORTAL };
    w.hubs = { [cfg.faction]: { ...CITY_SPAWN } };
    w.cities = [{ faction: cfg.faction, name: cfg.name, x0: 0, y0: 0, x1: N - 1, y1: N - 1 }];
    w.waypoints = [{ id: `city:${cfg.faction}`, x: CITY_PORTAL.x, y: CITY_PORTAL.y, kind: 'city', name: 'Portal de Frontera', faction: cfg.faction }];
    for (const c of [CITY_SPAWN, CITY_PORTAL, gate.toLegacy, gate.fromLegacy]) { t.block(c.x, c.y, false); }
    w.props = w.props.filter((p) => !(Math.floor(p.x) === CITY_PORTAL.x && Math.floor(p.y) === CITY_PORTAL.y) && !(Math.floor(p.x) === CITY_SPAWN.x && Math.floor(p.y) === CITY_SPAWN.y));
    return w;
}
