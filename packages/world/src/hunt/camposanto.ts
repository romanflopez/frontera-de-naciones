/**
 * Camposanto Viejo (Fase 3 de docs/MUNDO.md): 144x144, Nv 5, PvP de facción. Pasto muerto, niebla y árboles secos; al noroeste el
 * Cementerio viejo (lápidas en hileras dentro de un muro bajo), al noreste los Mausoleos, al sur las Ruinas del nigromante y la
 * Capilla en ruinas. Entrada desde La Frontera por el norte, junto a la Capilla del guardián (campamento seguro, respawn), y
 * portón sur hacia el Páramo Reseco.
 */
import type { WorldMap, Zone } from '../index';
import { kenney } from '../frontier';
import { townTile, townWallLow } from '../town';
import { HuntMap, roadZones, type Cell } from './kit';

export const CAMPOSANTO = {
    id: 'camposanto', size: 144,
    toFrontera: { x: 72, y: 2 }, fromFrontera: { x: 72, y: 6 },
    toParamo: { x: 72, y: 141 }, fromParamo: { x: 72, y: 137 },
    camp: { x0: 62, y0: 8, x1: 82, y1: 20 }, fire: { x: 67, y: 12 }, respawn: { x: 67, y: 14 },
    arrivals: { cementerio: { x: 53, y: 54 }, nigromante: { x: 55, y: 97 } } as Record<string, Cell>,
};

const DEAD_GRASS = [1131, 1127, 1135, 1122, 1131];
const DARK_GRASS = [1140, 1141, 1193, townTile('forest', 1), townTile('forest', 7)];
const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const FOREST = Array.from({ length: 18 }, (_, i) => townTile('forest', i)).filter((_, i) => i !== 5 && i !== 15 && i !== 16);
const ROAD = [1226, 1218, 1237, 1226];
const ROAD_EDGE = [townTile('terrain1', 4), townTile('terrain1', 7), 1193];
const GRAVEL = [1218, 1237, 1235, townTile('terrain2', 0), townTile('terrain2', 14)];
const RUIN_FLOOR = [1218, 1237, 1235, 1218, 1226];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const DEAD = [244, 245, 246, 247];
const PINES = [248, 249, 250, 251];
const GRAVES = [140, 141, 142, 143];
const ROCKS = [128, 129, 130, 131];
const WEEDS = [114, 115, 122, 123, 125, 127];
const RUINS = ['stoneWallBroken', 'stoneWallHalf', 'stoneWallRoundBroken', 'stoneWallAged', 'stoneWallBrokenLeft', 'stoneWallBrokenRight', 'stoneColumn', 'stoneWallColumn'];

export function buildCamposanto(): WorldMap {
    const C = CAMPOSANTO, t = new HuntMap(C.size, 20261103, DEAD_GRASS[0]);
    const { rnd, pick, w } = t;
    // 1) suelo: pasto muerto con manchones oscuros
    t.rect(0, 0, t.N - 1, t.N - 1, (x, y) => { const n = t.n(x, y, 5, 11); t.paint(x, y, n > 0.6 ? DARK_GRASS : n < 0.25 ? GRASS : DEAD_GRASS, 7, 6); });
    // 2) borde de pinos oscuros y arboledas secas
    t.border(5, 4, FOREST);
    for (const [x, y, rx, ry] of [[72, 32, 5, 4], [20, 76, 6, 9], [124, 76, 6, 9], [72, 122, 6, 4], [100, 74, 4, 4], [40, 76, 4, 3], [28, 130, 6, 4], [116, 130, 6, 4]] as const) t.thicket(x, y, rx, ry, FOREST);
    // 3) caminos de piedra
    const X: Cell = { x: 72, y: 72 };
    t.path([{ x: 72, y: 0 }, { x: 72, y: 22 }, { x: 70, y: 48 }, X], 3, ROAD, ROAD_EDGE);
    t.path([X, { x: 74, y: 100 }, { x: 72, y: 120 }, { x: 72, y: 143 }], 3, ROAD, ROAD_EDGE);
    t.path([X, { x: 60, y: 62 }, { x: 54, y: 55 }], 2, ROAD, ROAD_EDGE);
    t.path([{ x: 70, y: 44 }, { x: 82, y: 42 }, { x: 89, y: 42 }], 2, ROAD, ROAD_EDGE);
    t.path([X, { x: 60, y: 88 }, { x: 54, y: 96 }], 2, ROAD, ROAD_EDGE);
    t.path([{ x: 74, y: 100 }, { x: 84, y: 104 }, { x: 91, y: 105 }], 2, ROAD, ROAD_EDGE);
    // 4) Capilla del guardián
    t.camp(C.camp.x0, C.camp.y0, C.camp.x1, C.camp.y1, STONE, C.fire);
    for (const c of [C.toFrontera, C.fromFrontera, C.toParamo, C.fromParamo, ...Object.values(C.arrivals)]) t.reserveDisc(c.x, c.y, 1.5);
    // 5) pits
    const zones: Zone[] = [
        { type: 'skeleton', x: 38, y: 44, r: 12, n: 60, name: 'Cementerio viejo', respawn: 12, aggro: 3 },
        { type: 'skeleton', x: 104, y: 42, r: 11, n: 45, name: 'Mausoleos', respawn: 12, aggro: 3 },
        { type: 'skeleton_mage', x: 38, y: 104, r: 12, n: 55, name: 'Ruinas del nigromante', respawn: 12, aggro: 3 },
        { type: 'skeleton_mage', x: 106, y: 106, r: 11, n: 45, name: 'Capilla en ruinas', respawn: 12, aggro: 3 },
    ];
    // el cementerio tiene lápidas en hileras (pasillos de 2 celdas): el claro sin lápidas es chico
    const pits = [t.pit(zones[0], 4, GRAVEL), t.pit(zones[1], 7, GRAVEL), t.pit(zones[2], 8, RUIN_FLOOR), t.pit(zones[3], 7, RUIN_FLOOR)];
    // Cementerio viejo: muro bajo de piedra con portones y lápidas en hileras
    const wall = (x0: number, y0: number, x1: number, y1: number, gates: (x: number, y: number) => boolean) => {
        const D = -0.6;
        for (let x = x0; x <= x1; x++) {
            if (!gates(x, y0) && t.free(x, y0 - 1)) { t.prop(townWallLow('piedra', '\\'), x, y0, false, x + y0 + D); t.solidify(x, y0 - 1); t.taken[y0 - 1][x] = true; }
            if (!gates(x, y1) && t.free(x, y1 + 1)) { t.prop(townWallLow('piedra', '\\'), x, y1 + 1, false, x + y1 + 1 + D); t.block(x, y1 + 1); }
        }
        for (let y = y0; y <= y1; y++) {
            if (!gates(x0, y) && t.free(x0 - 1, y)) { t.prop(townWallLow('piedra', '/'), x0, y, false, x0 + y + D); t.solidify(x0 - 1, y); t.taken[y][x0 - 1] = true; }
            if (!gates(x1, y) && t.free(x1 + 1, y)) { t.prop(townWallLow('piedra', '/'), x1 + 1, y, false, x1 + 1 + y + D); t.block(x1 + 1, y); }
        }
    };
    wall(24, 30, 52, 58, (x, y) => Math.abs(x - 38) <= 1 || Math.abs(y - 44) <= 1 || (x >= 50 && y >= 50));
    const z0 = zones[0];
    for (let y = z0.y - z0.r - 1; y <= z0.y + z0.r + 1; y++) for (let x = z0.x - z0.r - 1; x <= z0.x + z0.r + 1; x++) {
        if (y % 2 !== 0 || x % 3 === 0 || !t.free(x, y) || t.road[y][x]) continue;
        if (Math.abs(x - z0.x) <= 1 || Math.abs(y - z0.y) <= 1) continue; // cruz central de pasillos
        if (rnd() < 0.82) t.prop(pick(GRAVES), x, y);
    }
    // Mausoleos: criptas de piedra en anillo, lápidas sueltas y columnas
    for (const [x, y] of [[92, 30], [112, 28], [118, 40], [114, 52], [94, 52], [100, 26]] as const) {
        let ok = true; t.rect(x, y, x + 2, y + 2, (cx, cy) => { if (!t.free(cx, cy)) ok = false; });
        if (ok) t.building('sm_torre_muralla', x, y, 3, 3);
    }
    // Ruinas del nigromante y Capilla en ruinas: pedazos de muro y columnas de piedra alrededor del claro
    const ruins = (cx: number, cy: number, r0: number, r1: number, k: number) => {
        for (let i = 0; i < k; i++) {
            const a = (i / k) * Math.PI * 2 + rnd() * 0.3, rr = r0 + rnd() * (r1 - r0), x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr);
            // un tramo corto de muro roto (2-3 piezas) siguiendo la tangente
            const along = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? [0, 1] : [1, 0], len = 2 + Math.floor(rnd() * 2);
            for (let j = 0; j < len; j++) {
                const px = x + along[0] * j, py = y + along[1] * j; if (!t.free(px, py)) continue;
                t.prop(kenney(pick(RUINS), along[0] ? 'S' : 'E'), px, py);
            }
        }
    };
    ruins(38, 104, 9, 13, 14); ruins(106, 106, 8, 11, 10);
    for (const [cx, cy] of [[38, 104], [106, 106]] as const) for (const [dx, dy] of [[-4, -4], [4, -4], [-4, 4], [4, 4]] as const) t.decor(kenney('stoneColumn'), cx + dx, cy + dy);
    // mobs sueltos
    zones.push(...roadZones('Senderos del camposanto', 'skeleton', undefined, [{ x: 70, y: 46 }, { x: 72, y: 86 }, { x: 58, y: 66 }], 5, 15));
    zones.push(...roadZones('Fosas abiertas', 'skeleton_mage', undefined, [{ x: 88, y: 72 }], 5, 15));
    for (const z of zones.slice(4)) t.w.zones.push(z);
    // 6) decorado
    const inPit = (x: number, y: number) => pits.some((p) => Math.hypot(x - p.zone.x, y - p.zone.y) <= p.zone.r + 1);
    t.decorate((x, y, deep) => {
        const r = rnd();
        if (deep && r < 0.5) return null;
        return r < 0.6 ? pick(PINES) : r < 0.92 ? pick(DEAD) : pick(ROCKS);
    }, (x, y) => {
        const r = rnd(), pit = inPit(x, y);
        if (!pit && r < 0.03) t.prop(pick(DEAD), x, y);
        else if (!pit && r < 0.042) t.prop(pick(GRAVES), x, y);
        else if (!pit && r < 0.048) t.prop(pick(ROCKS), x, y);
        else if (r < (pit ? 0.03 : 0.11)) t.decor(pick(WEEDS), x, y);
    });
    w.spawn = { ...C.fromFrontera };
    w.fog = 0.5;
    t.finish(C.fromFrontera);
    return w;
}
