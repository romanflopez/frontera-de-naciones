/**
 * Llanos del Alba (Fase 3 de docs/MUNDO.md): 128x128, Nv 1-2, sin PvP. Zona de principiantes al este de la Villa de Solmar:
 * praderas, granjas tomadas por los goblins, una laguna y bosquecillos, rodeados de bosque. Cuatro pits de goblins con
 * reaparición rápida y goblins sueltos por los caminos.
 *   - Oeste: llegada desde el portón este de la villa y el Puesto del Alba (campamento seguro con fogata, respawn del mapa).
 *   - Norte: camino a las Tierras de Solmar (el mapa viejo; por ahí se sigue hacia Vhar).
 *   - Este: Paso de la Frontera (a La Frontera).
 */
import type { WorldMap, Zone } from '../index';
import { townTile } from '../town';
import { HuntMap, roadZones, type Cell } from './kit';

export const LLANOS = {
    id: 'llanos_alba', size: 128,
    /** Portón oeste: vínculo a la villa y llegada desde ella. */
    toVilla: { x: 2, y: 64 }, fromVilla: { x: 6, y: 64 },
    /** Camino norte: a las Tierras de Solmar (mapa viejo). */
    toLegacy: { x: 64, y: 2 }, fromLegacy: { x: 64, y: 6 },
    /** Paso de la Frontera (este). */
    toFrontera: { x: 125, y: 72 }, fromFrontera: { x: 121, y: 72 },
    camp: { x0: 8, y0: 56, x1: 21, y1: 72 }, fire: { x: 14, y: 60 }, respawn: { x: 14, y: 62 },
    /** Llegadas del menú del Portal de Frontera (por id de TRAINING). */
    arrivals: { goblins: { x: 40, y: 77 }, avanzada: { x: 89, y: 49 } } as Record<string, Cell>,
};

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const MEADOW = [townTile('terrain1', 0), townTile('terrain1', 1), townTile('terrain1', 2), townTile('terrain1', 9), townTile('terrain1', 10)];
const ROAD = [townTile('terrain1', 11), townTile('terrain1', 16), townTile('terrain1', 11)];
const ROAD_EDGE = [townTile('terrain1', 4), townTile('terrain1', 7), townTile('terrain1', 8)];
const DIRT = [townTile('terrain1', 11), townTile('terrain1', 16), townTile('terrain1', 5), townTile('terrain1', 6), 1001];
const FIELD = [townTile('terrain1', 3), townTile('terrain1', 12), townTile('terrain1', 7), townTile('terrain1', 12)];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const FOREST = Array.from({ length: 18 }, (_, i) => townTile('forest', i)).filter((_, i) => i !== 5 && i !== 15 && i !== 16);
const LEAFY = [240, 241, 242, 243, 252, 253, 254, 255];
const PINES = [248, 249, 250, 251];
const FLOWERS = [112, 113, 116, 117, 118, 119, 120, 121, 122, 123];
const TALL = [114, 115, 124, 125, 126, 127];
const ROCKS = [128, 129, 130, 131];
const WATER = [townTile('water', 1), townTile('water', 4)], WATER_DEEP = [townTile('water', 13), townTile('water', 16)];
const FOAM = { ne: 3470, se: 3471, sw: 3472, nw: 3473 };
const TENTS = [72, 75], CRATES = [76, 77, 96, 97, 98, 99, 100, 101];

export function buildLlanos(): WorldMap {
    const L = LLANOS, t = new HuntMap(L.size, 20261101, GRASS[0]);
    const { rnd, pick, w } = t;
    // 1) suelo: pasto con manchones de pradera
    t.rect(0, 0, t.N - 1, t.N - 1, (x, y) => t.paint(x, y, t.n(x, y, 5, 14) > 0.62 ? MEADOW : GRASS, 7, 6));
    // 2) borde de bosque y bosquecillos
    t.border(4, 4, FOREST);
    for (const [x, y, rx, ry] of [[82, 18, 7, 4], [20, 102, 7, 6], [72, 42, 4, 3], [118, 22, 5, 7], [84, 118, 6, 4], [116, 118, 6, 5], [8, 30, 5, 8], [56, 108, 4, 6], [112, 84, 3, 4]] as const) t.thicket(x, y, rx, ry, FOREST);
    t.pond(72, 98, 8, 6, WATER, WATER_DEEP, FOAM);
    // 3) caminos
    const C: Cell = { x: 56, y: 66 };
    t.path([{ x: 0, y: 64 }, { x: 22, y: 64 }, { x: 40, y: 63 }, C], 3, ROAD, ROAD_EDGE);
    t.path([C, { x: 58, y: 44 }, { x: 62, y: 22 }, { x: 64, y: 0 }], 3, ROAD, ROAD_EDGE);
    t.path([C, { x: 80, y: 70 }, { x: 104, y: 68 }, { x: 127, y: 72 }], 3, ROAD, ROAD_EDGE);
    t.path([{ x: 40, y: 63 }, { x: 41, y: 72 }, { x: 40, y: 80 }], 2, ROAD, ROAD_EDGE); // al Campamento goblin
    t.path([{ x: 58, y: 44 }, { x: 48, y: 38 }, { x: 42, y: 32 }], 2, ROAD, ROAD_EDGE); // a las granjas
    t.path([{ x: 80, y: 70 }, { x: 86, y: 58 }, { x: 89, y: 46 }], 2, ROAD, ROAD_EDGE); // a la avanzada
    t.path([{ x: 104, y: 68 }, { x: 103, y: 80 }, { x: 101, y: 88 }], 2, ROAD, ROAD_EDGE); // a la empalizada
    // 4) Puesto del Alba (seguro, respawn)
    const respawn = t.camp(L.camp.x0, L.camp.y0, L.camp.x1, L.camp.y1, STONE, L.fire);
    void respawn;
    for (const c of [L.toVilla, L.fromVilla, L.toLegacy, L.fromLegacy, L.toFrontera, L.fromFrontera, ...Object.values(L.arrivals)]) t.reserveDisc(c.x, c.y, 1.5);
    // 5) pits (zonas densas, reaparición rápida, aggro corto)
    const zones: Zone[] = [
        { type: 'goblin', x: 40, y: 94, r: 12, n: 45, name: 'Campamento goblin', respawn: 8, aggro: 3 },
        { type: 'goblin', x: 31, y: 30, r: 12, n: 40, name: 'Granjas tomadas', respawn: 8, aggro: 3 },
        { type: 'goblin_elite', x: 98, y: 34, r: 13, n: 50, name: 'Avanzada goblin', respawn: 10, aggro: 3 },
        { type: 'goblin_elite', x: 100, y: 101, r: 11, n: 35, name: 'Empalizada goblin', respawn: 10, aggro: 3 },
    ];
    const pits = [t.pit(zones[0], 9, DIRT), t.pit(zones[1], 9, MEADOW), t.pit(zones[2], 10, DIRT), t.pit(zones[3], 8, DIRT)];
    // granjas: campos arados alrededor, casas y cercos
    for (const [x0, y0, x1, y1] of [[14, 14, 22, 20], [40, 14, 48, 22], [14, 40, 22, 46], [44, 42, 52, 50]] as const) {
        t.rect(x0, y0, x1, y1, (x, y) => { if (!t.road[y][x] && !t.w.blocked[y][x]) t.paint(x, y, FIELD, 23, 3); });
        for (let x = x0; x <= x1; x++) { if (x % 4 !== 1 && t.free(x, y0 - 1)) t.prop(107, x, y0 - 1); }
        for (let y = y0; y <= y1; y++) { if (y % 4 !== 2 && t.free(x1 + 1, y)) t.prop(104, x1 + 1, y); }
    }
    t.building('sm_almacen', 12, 34, 6, 5);
    t.building('sm_casa_c', 51, 14, 6, 4);
    t.building('sm_casa_a', 26, 46, 5, 4);
    for (const [x, y] of [[19, 33], [19, 36], [44, 15], [33, 50], [52, 24]] as const) t.prop(pick([100, 101, 96, 98]), x, y);
    // campamentos goblin: empalizada, tiendas y cajas alrededor del claro
    t.palisade(40, 94, 13.5, [90, 270, 200], 30);
    t.palisade(98, 34, 14.5, [150, 230, 320, 60], 28);
    t.palisade(100, 101, 12.5, [250, 120], 34);
    const camp = (cx: number, cy: number, r: number, k: number) => {
        for (let i = 0; i < k; i++) {
            const a = (i / k) * Math.PI * 2 + 0.4, x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
            if (t.free(x, y)) t.prop(pick(TENTS), x, y);
            const x2 = x + (rnd() < 0.5 ? 1 : -1), y2 = y + (rnd() < 0.5 ? 1 : -1); if (t.free(x2, y2)) t.prop(pick(CRATES), x2, y2);
        }
    };
    camp(40, 94, 11, 7); camp(98, 34, 12, 9); camp(100, 101, 10, 6);
    // un fuego apagado (leña) y troncos en el centro de cada campamento: no bloquean el claro
    for (const p of pits) { t.decor(136, p.zone.x + 2, p.zone.y - 1); t.decor(137, p.zone.x - 2, p.zone.y + 2); }
    // carteles en los cruces
    for (const [x, y] of [[54, 63], [60, 47], [78, 73], [42, 61]] as const) if (t.free(x, y)) t.prop(138 + (x % 2), x, y);
    // goblins sueltos por los caminos
    zones.push(...roadZones('Caminos del Alba', 'goblin', undefined, [{ x: 48, y: 66 }, { x: 59, y: 52 }, { x: 74, y: 69 }, { x: 62, y: 30 }], 5, 15));
    for (const z of zones.slice(4)) t.w.zones.push(z);
    // 6) decorado
    const inPit = (x: number, y: number) => pits.some((p) => Math.hypot(x - p.zone.x, y - p.zone.y) <= p.zone.r + 2);
    t.decorate((x, y, deep) => {
        const r = rnd();
        if (deep && r < 0.55) return null;
        return r < 0.9 ? pick(t.n(x, y, 77, 9) > 0.5 ? PINES : LEAFY) : pick(ROCKS);
    }, (x, y) => {
        const r = rnd(), pit = inPit(x, y);
        if (!pit && r < 0.022) t.prop(pick(LEAFY), x, y);
        else if (!pit && r < 0.028) t.prop(pick(ROCKS), x, y);
        else if (r < (pit ? 0.04 : 0.1)) t.decor(pick(t.n(x, y, 3, 8) > 0.5 ? FLOWERS : TALL), x, y);
    });
    // 7) datos del mapa
    w.spawn = { ...L.fromVilla };
    t.finish(L.fromVilla);
    return w;
}
