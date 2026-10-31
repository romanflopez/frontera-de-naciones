/**
 * Páramo Reseco (Fase 3 de docs/MUNDO.md): 160x160, Nv 5, PvP de facción. Desierto agrietado de arcilla, arena y roca, con
 * peñascos, árboles secos y restos de columnas. Cuatro pits de hormigas león Nv5. Entrada desde el Camposanto por el norte junto
 * al Oasis del Páramo (campamento seguro con una charca, respawn) y, al sur, la escalera sellada de la Cripta olvidada (que
 * todavía vive en el mapa viejo: el vínculo lleva a su sala de entrada y pide la llave de la cripta, que se consume al cruzar).
 */
import type { WorldMap, Zone } from '../index';
import { kenney, sbs, SBS, CLAY, DRY, ROCKY, SAND } from '../frontier';
import { townTile } from '../town';
import { HuntMap, roadZones, type Cell } from './kit';

export const PARAMO = {
    id: 'paramo', size: 160,
    toCamposanto: { x: 80, y: 2 }, fromCamposanto: { x: 80, y: 6 },
    camp: { x0: 68, y0: 9, x1: 92, y1: 22 }, fire: { x: 74, y: 14 }, respawn: { x: 74, y: 16 },
    /** Escalera sellada a la Cripta olvidada (mapa viejo). */
    crypt: { x: 80, y: 146 },
    arrivals: {} as Record<string, Cell>,
};

const flat = (set: readonly (readonly [number, readonly number[]])[]) => set.flatMap(([s, cells]) => cells.map((c) => sbs(s, c)));
const T_DRY = flat(DRY), T_ROCKY = flat(ROCKY);
const T_SAND = [1000, 1006, 1022, 1006], T_CLAY = [1012, 1017, 1003, 1017];
void SAND; void CLAY;
const CRACKED = [1016, 1012, 1017, townTile('terrain1', 17), 1003];
const OASIS = [townTile('terrain1', 9), townTile('terrain1', 10), townTile('terrain1', 2), 1108, 1109];
const ROAD = [sbs(SBS.dry1, 12), sbs(SBS.dry1, 17), sbs(SBS.dry1, 12)];
const ROAD_EDGE = [sbs(SBS.dry1, 13), sbs(SBS.dry1, 7)];
const WATER = [townTile('water', 1), townTile('water', 4)];
const FOAM = { ne: 3470, se: 3471, sw: 3472, nw: 3473 };
const ROCKS = [128, 129, 130, 131];
const DEAD = [244, 245, 246, 247];
const GRAVES = [140, 141, 142, 143];
const LEAFY = [240, 241, 242, 243];
const DRYGRASS = [124, 125, 126, 127];

export function buildParamo(): WorldMap {
    const P = PARAMO, t = new HuntMap(P.size, 20261104, T_DRY[0]);
    const { rnd, pick, w } = t;
    // 1) suelo: arcilla agrietada, arena y roca por ruido
    t.rect(0, 0, t.N - 1, t.N - 1, (x, y) => {
        const a = t.n(x, y, 11, 13), b = t.n(x, y, 23, 9);
        t.paint(x, y, a > 0.7 ? T_ROCKY : a < 0.22 ? CRACKED : b > 0.64 ? T_SAND : b < 0.26 ? T_CLAY : T_DRY, 51, 6);
    });
    // 2) borde de peñascos y mesetas de roca
    t.border(5, 5, T_ROCKY);
    for (const [x, y, rx, ry] of [[80, 40, 6, 4], [24, 90, 7, 10], [136, 90, 7, 10], [80, 100, 5, 5], [52, 86, 4, 3], [108, 86, 4, 3], [80, 130, 4, 3], [30, 26, 5, 4], [130, 26, 5, 4], [26, 146, 6, 4], [134, 146, 6, 4]] as const) t.thicket(x, y, rx, ry, T_ROCKY);
    // 3) caminos de tierra
    const X: Cell = { x: 80, y: 80 };
    t.path([{ x: 80, y: 0 }, { x: 80, y: 24 }, { x: 77, y: 56 }, X], 3, ROAD, ROAD_EDGE);
    t.path([X, { x: 82, y: 112 }, { x: 80, y: 140 }, { x: 80, y: 147 }], 3, ROAD, ROAD_EDGE);
    t.path([X, { x: 62, y: 66 }, { x: 54, y: 62 }], 2, ROAD, ROAD_EDGE);
    t.path([X, { x: 98, y: 66 }, { x: 104, y: 62 }], 2, ROAD, ROAD_EDGE);
    t.path([{ x: 82, y: 112 }, { x: 70, y: 118 }, { x: 66, y: 122 }], 2, ROAD, ROAD_EDGE);
    t.path([{ x: 82, y: 112 }, { x: 94, y: 120 }, { x: 102, y: 123 }], 2, ROAD, ROAD_EDGE);
    // 4) Oasis del Páramo: campamento con pasto y una charca
    t.camp(P.camp.x0, P.camp.y0, P.camp.x1, P.camp.y1, OASIS, P.fire);
    t.pond(86, 17, 3, 2.2, WATER, WATER, FOAM);
    for (const [x, y] of [[90, 12], [83, 20], [90, 20], [70, 20]] as const) t.prop(pick(LEAFY), x, y);
    for (const c of [P.toCamposanto, P.fromCamposanto, P.crypt]) t.reserveDisc(c.x, c.y, 1.5);
    // escalera de caracol sellada entre dos columnas
    t.keep[P.crypt.y][P.crypt.x] = false;
    t.prop(kenney('stairsSpiral', 'S'), P.crypt.x, P.crypt.y, false);
    t.keep[P.crypt.y - 1][P.crypt.x + 1] = false; t.keep[P.crypt.y + 1][P.crypt.x - 1] = false;
    t.prop(kenney('stoneColumn', 'S'), P.crypt.x + 1, P.crypt.y - 1); t.prop(kenney('stoneColumn', 'S'), P.crypt.x - 1, P.crypt.y + 1);
    for (const [dx, dy] of [[-3, -2], [3, 2], [-2, 3], [3, -3]] as const) if (t.free(P.crypt.x + dx, P.crypt.y + dy)) t.prop(kenney(pick(['stoneWallBroken', 'stoneWallHalf', 'stoneColumn'])), P.crypt.x + dx, P.crypt.y + dy);
    // 5) pits de hormigas león Nv5
    const zones: Zone[] = [
        { type: 'antlion', x: 40, y: 56, r: 12, n: 60, name: 'Páramo reseco', lvl: 5, respawn: 12, aggro: 3 },
        { type: 'antlion', x: 120, y: 56, r: 12, n: 55, name: 'Grietas del páramo', lvl: 5, respawn: 12, aggro: 3 },
        { type: 'antlion', x: 54, y: 124, r: 11, n: 50, name: 'Hondonada de los huesos', lvl: 5, respawn: 12, aggro: 3 },
        { type: 'antlion', x: 112, y: 125, r: 11, n: 45, name: 'Llano de las calaveras', lvl: 5, respawn: 12, aggro: 3 },
    ];
    const pits = [t.pit(zones[0], 10, T_SAND), t.pit(zones[1], 10, CRACKED), t.pit(zones[2], 9, T_CLAY), t.pit(zones[3], 8, T_SAND)];
    // hondonadas: restos de columnas y lápidas viejas en el borde de los pits
    for (const p of pits) for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rnd(), rr = p.zone.r + rnd() * 2, x = Math.round(p.zone.x + Math.cos(a) * rr), y = Math.round(p.zone.y + Math.sin(a) * rr);
        if (t.free(x, y)) t.prop(rnd() < 0.4 ? kenney(pick(['stoneColumn', 'stoneWallBroken', 'stoneWallHalf'])) : rnd() < 0.5 ? pick(GRAVES) : pick(ROCKS), x, y);
    }
    zones.push(...roadZones('Camino del páramo', 'antlion', 5, [{ x: 78, y: 40 }, { x: 81, y: 96 }, { x: 64, y: 78 }, { x: 96, y: 78 }], 5, 15));
    for (const z of zones.slice(4)) t.w.zones.push(z);
    // 6) decorado: rocas y árboles secos; pasto seco
    const inPit = (x: number, y: number) => pits.some((p) => Math.hypot(x - p.zone.x, y - p.zone.y) <= p.zone.r + 1);
    t.decorate((x, y, deep) => {
        const r = rnd();
        if (deep && r < 0.6) return null;
        return r < 0.75 ? pick(ROCKS) : pick(DEAD);
    }, (x, y) => {
        const r = rnd(), pit = inPit(x, y);
        if (!pit && r < 0.02) t.prop(pick(ROCKS), x, y);
        else if (!pit && r < 0.034) t.prop(pick(DEAD), x, y);
        else if (!pit && r < 0.037) t.prop(pick(GRAVES), x, y);
        else if (r < (pit ? 0.01 : 0.05)) t.decor(pick(DRYGRASS), x, y);
    });
    w.spawn = { ...P.fromCamposanto };
    t.finish(P.fromCamposanto);
    return w;
}
