/**
 * La Frontera (Fase 3 de docs/MUNDO.md): 160x160, Nv 3-4, PvP de facción. Bosque cerrado y cruce de caminos compartido:
 * al oeste los arenales de los Hoyos de hormiga león, al este el Pantano muerto con sus charcas, y al sur el camino al
 * Camposanto Viejo. La Posta de la Frontera (campamento seguro, respawn) está junto al Paso, en la entrada desde los Llanos.
 */
import type { WorldMap, Zone } from '../index';
import { townTile } from '../town';
import { HuntMap, roadZones, type Cell } from './kit';

export const FRONTERA = {
    id: 'la_frontera', size: 160,
    toLlanos: { x: 2, y: 80 }, fromLlanos: { x: 6, y: 80 },
    toCamposanto: { x: 80, y: 157 }, fromCamposanto: { x: 80, y: 153 },
    camp: { x0: 8, y0: 72, x1: 21, y1: 89 }, fire: { x: 14, y: 76 }, respawn: { x: 14, y: 78 },
    arrivals: { hoyos: { x: 53, y: 49 }, pantano: { x: 111, y: 54 } } as Record<string, Cell>,
};

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const FOREST = Array.from({ length: 18 }, (_, i) => townTile('forest', i)).filter((_, i) => i !== 5 && i !== 15 && i !== 16);
const ROAD = [townTile('terrain1', 11), townTile('terrain1', 16), townTile('terrain1', 11)];
const ROAD_EDGE = [townTile('terrain1', 4), townTile('terrain1', 7), townTile('terrain1', 8)];
const SAND = [1000, 1006, 1022, 1004, 1000];
const SAND_DARK = [1003, 1013, 1007, 1001];
const HOLES = [1188, 1197, 1188];
const MUD = [1019, 1025, townTile('forest', 7), townTile('forest', 15), 1193, 1019];
const SWAMP_WATER = [townTile('water', 8), townTile('water', 11)];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const LEAFY = [240, 241, 242, 243, 252, 253, 254, 255];
const PINES = [248, 249, 250, 251];
const DEAD = [244, 245, 246, 247];
const REEDS = [114, 115, 124, 126];
const BUSH = [112, 113, 116, 117, 120, 121, 122, 123];
const ROCKS = [128, 129, 130, 131];

export function buildFrontera(): WorldMap {
    const F = FRONTERA, t = new HuntMap(F.size, 20261102, GRASS[0]);
    const { rnd, pick, w } = t;
    const sandy = (x: number, y: number) => x < 66 && (Math.hypot(x - 40, y - 36) < 24 || Math.hypot(x - 40, y - 124) < 22) && t.n(x, y, 3, 6) > 0.25;
    const swampy = (x: number, y: number) => x > 92 && (Math.hypot(x - 120, y - 42) < 26 || Math.hypot(x - 122, y - 120) < 24);
    // 1) suelo: bosque oscuro con claros de pasto; arena al oeste, barro al este
    t.rect(0, 0, t.N - 1, t.N - 1, (x, y) => {
        if (sandy(x, y)) t.paint(x, y, t.n(x, y, 9, 7) > 0.55 ? SAND_DARK : SAND, 11, 5);
        else if (swampy(x, y)) t.paint(x, y, MUD, 13, 4);
        else t.paint(x, y, t.n(x, y, 5, 12) > 0.45 ? FOREST : GRASS, 7, 6);
    });
    // 2) borde y bosque denso entre las regiones
    t.border(5, 4, FOREST);
    for (const [x, y, rx, ry] of [[80, 30, 10, 12], [62, 98, 6, 8], [100, 92, 7, 9], [36, 80, 5, 4], [130, 80, 9, 7], [20, 56, 5, 7], [20, 104, 5, 7], [80, 136, 6, 4], [106, 140, 7, 5], [52, 144, 6, 4], [146, 66, 5, 6]] as const) t.thicket(x, y, rx, ry);
    // charcas del pantano (afuera del claro de cada pit)
    for (const [x, y, rx, ry] of [[136, 30, 5, 4], [104, 32, 4, 3], [132, 56, 4, 5], [108, 128, 4, 3], [138, 112, 5, 4], [124, 140, 4, 3], [96, 46, 3, 3]] as const) t.pond(x, y, rx, ry, SWAMP_WATER, SWAMP_WATER);
    // 3) caminos
    const C: Cell = { x: 80, y: 80 };
    t.path([{ x: 0, y: 80 }, { x: 22, y: 80 }, { x: 50, y: 78 }, C], 3, ROAD, ROAD_EDGE);
    t.path([C, { x: 98, y: 66 }, { x: 111, y: 54 }], 3, ROAD, ROAD_EDGE);
    t.path([C, { x: 66, y: 62 }, { x: 53, y: 48 }], 3, ROAD, ROAD_EDGE);
    t.path([C, { x: 80, y: 112 }, { x: 80, y: 140 }, { x: 80, y: 159 }], 3, ROAD, ROAD_EDGE);
    t.path([{ x: 80, y: 110 }, { x: 64, y: 116 }, { x: 54, y: 120 }], 2, ROAD, ROAD_EDGE);
    t.path([{ x: 80, y: 110 }, { x: 98, y: 116 }, { x: 108, y: 119 }], 2, ROAD, ROAD_EDGE);
    // 4) Posta de la Frontera
    t.camp(F.camp.x0, F.camp.y0, F.camp.x1, F.camp.y1, STONE, F.fire);
    for (const c of [F.toLlanos, F.fromLlanos, F.toCamposanto, F.fromCamposanto, ...Object.values(F.arrivals)]) t.reserveDisc(c.x, c.y, 1.5);
    // 5) pits
    const zones: Zone[] = [
        { type: 'antlion', x: 40, y: 36, r: 13, n: 50, name: 'Hoyos de hormiga león', respawn: 10, aggro: 3 },
        { type: 'antlion', x: 40, y: 124, r: 12, n: 40, name: 'Arenal de los hoyos', respawn: 10, aggro: 3 },
        { type: 'zombie', x: 121, y: 42, r: 13, n: 50, name: 'Pantano muerto', respawn: 10, aggro: 3 },
        { type: 'zombie', x: 122, y: 120, r: 12, n: 40, name: 'Ciénaga honda', respawn: 10, aggro: 3 },
    ];
    const pits = [t.pit(zones[0], 10), t.pit(zones[1], 9), t.pit(zones[2], 10), t.pit(zones[3], 9)];
    // hoyos: hondonadas de arena en el piso y rocas en el borde del arenal
    // cada hoyo: centro de arena oscura y un anillo de piedritas sueltas (no bloquean: los mobs y jugadores pasan por encima)
    for (const p of pits.slice(0, 2)) for (let i = 0; i < 16; i++) {
        const a = rnd() * Math.PI * 2, rr = rnd() * p.zone.r, hx = Math.round(p.zone.x + Math.cos(a) * rr), hy = Math.round(p.zone.y + Math.sin(a) * rr);
        t.rect(hx - 1, hy - 1, hx + 1, hy + 1, (x, y) => { if (!t.road[y][x] && !t.w.blocked[y][x]) t.tile(x, y, (x === hx && y === hy) ? pick(HOLES) : pick(SAND_DARK)); });
        for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -2], [2, 1]] as const) if (rnd() < 0.6 && t.free(hx + dx, hy + dy)) t.decor(pick([129, 131]), hx + dx, hy + dy);
    }
    zones.push(...roadZones('Senda de los hoyos', 'antlion', undefined, [{ x: 36, y: 79 }, { x: 64, y: 64 }], 5, 15));
    zones.push(...roadZones('Senda del pantano', 'zombie', undefined, [{ x: 96, y: 68 }, { x: 80, y: 98 }], 5, 15));
    for (const z of zones.slice(4)) t.w.zones.push(z);
    // carteles en el cruce
    for (const [x, y] of [[77, 77], [83, 84], [47, 76]] as const) if (t.free(x, y)) t.prop(138 + (x % 2), x, y);
    // 6) decorado: pinos y frondosos en el bosque, árboles secos en el pantano, rocas en el arenal
    const inPit = (x: number, y: number) => pits.some((p) => Math.hypot(x - p.zone.x, y - p.zone.y) <= p.zone.r + 1);
    t.decorate((x, y, deep) => {
        const r = rnd();
        if (deep && r < 0.5) return null;
        if (sandy(x, y)) return r < 0.6 ? pick(ROCKS) : pick(DEAD);
        if (swampy(x, y)) return r < 0.7 ? pick(DEAD) : pick(PINES);
        return r < 0.92 ? pick(t.n(x, y, 77, 9) > 0.45 ? PINES : LEAFY) : pick(ROCKS);
    }, (x, y) => {
        const r = rnd(), pit = inPit(x, y);
        if (sandy(x, y)) { if (!pit && r < 0.02) t.prop(pick(ROCKS), x, y); else if (r < (pit ? 0.008 : 0.03)) t.prop(pick(DEAD), x, y); else if (r < 0.05) t.decor(pick([125, 127]), x, y); return; }
        if (swampy(x, y)) { if (r < (pit ? 0.006 : 0.04)) t.prop(pick(DEAD), x, y); else if (r < 0.14) t.decor(pick(REEDS), x, y); return; }
        if (r < 0.05) t.prop(pick(t.n(x, y, 77, 9) > 0.45 ? PINES : LEAFY), x, y);
        else if (r < 0.058) t.prop(pick(ROCKS), x, y);
        else if (r < 0.062) t.prop(pick([136, 137]), x, y);
        else if (r < 0.14) t.decor(pick(BUSH), x, y);
    });
    w.spawn = { ...F.fromLlanos };
    t.finish(F.fromLlanos);
    return w;
}
