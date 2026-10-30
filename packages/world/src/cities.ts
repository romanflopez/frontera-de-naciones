/**
 * Las dos ciudades: Solmar (la villa del campamento, ampliada) y Vhar (un pueblo fortificado de tierras secas
 * al noreste, que se conecta con el mundo por una puerta). Se arman con el arte de Flare (CC-BY-SA 3.0):
 * cabañas de troncos de varias piezas (como en Lochport y Black Oak City de la campaña Empyrean),
 * vallas, fogatas, yunque, tiendas, el pozo de piedra y el círculo rúnico de la plaza.
 * Corre al final de buildSolmar, igual en cliente y server, con su propia semilla.
 */
import type { WorldMap, Prop, Npc } from './index';
import { sbs, SBS, PATH, ROCKS, DEAD } from './frontier';

export interface City { faction: 'solmar' | 'vhar'; name: string; x0: number; y0: number; x1: number; y1: number }
export const CITIES: City[] = [
    { faction: 'solmar', name: 'Ciudad de Solmar', x0: 1, y0: 1, x1: 14, y1: 14 },
    { faction: 'vhar', name: 'Ciudad de Vhar', x0: 66, y0: 3, x1: 90, y1: 21 },
];
export const HUBS: Record<string, { x: number; y: number }> = { solmar: { x: 7, y: 8 }, vhar: { x: 78, y: 13 } };
export const cityAt = (x: number, y: number): City | undefined => CITIES.find((c) => x >= c.x0 && x < c.x1 + 1 && y >= c.y0 && y < c.y1 + 1);

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const DRY_GROUND = [sbs(SBS.rocky1, 1), sbs(SBS.rocky1, 2), sbs(SBS.rocky1, 7), sbs(SBS.rocky1, 10), sbs(SBS.rocky1, 12), sbs(SBS.dry1, 13)];
const FLOWERS = [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125];

export function extendCities(w: WorldMap): WorldMap {
    let seed = 424242;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

    const prop = (id: number, x: number, y: number, block = true) => { w.props.push({ id, x: x + 0.5, y: y + 0.5 }); if (block) w.blocked[y][x] = true; };
    /** Cabaña de troncos de Flare, variante con la puerta hacia el sur: tres piezas en fila (x-2..x) y el techo en (x, y-1). Ocupa 3x2 celdas. */
    const cabinA = (x: number, y: number) => { prop(212, x - 2, y); prop(213, x - 1, y); prop(214, x, y); prop(215, x, y - 1); w.blocked[y - 1][x - 2] = w.blocked[y - 1][x - 1] = true; };
    /** Variante con la puerta hacia el este: (x, y), (x, y+1) y dos piezas en la fila de abajo. Ocupa 2x3 celdas. */
    const cabinB = (x: number, y: number) => { prop(211, x, y); prop(210, x, y + 1); prop(208, x - 1, y + 2); prop(209, x, y + 2); w.blocked[y][x - 1] = w.blocked[y + 1][x - 1] = true; };

    // limpia lo que había dentro de cada ciudad (el campamento viejo, vegetación suelta, mobs no hay: es zona segura)
    for (const c of CITIES) {
        const keep = (p: { x: number; y: number }) => !(p.x >= c.x0 && p.x <= c.x1 + 1 && p.y >= c.y0 && p.y <= c.y1 + 1);
        w.props = w.props.filter(keep); w.decals = w.decals.filter(keep); w.buildings = w.buildings.filter(keep); w.npcs = w.npcs.filter(keep);
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { w.blocked[y][x] = false; w.safe[y][x] = true; }
    }

    // ================= Solmar =================
    {
        const c = CITIES[0];
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
            const plaza = x >= 5 && x <= 10 && y >= 5 && y <= 10, road = (x === 7 || x === 8 || y === 7 || y === 8) && !(x < 3 && y < 3);
            w.tiles[y][x] = plaza || road ? pick(STONE) : pick(GRASS);
        }
        // empalizada: este y sur, con tres portones; norte y oeste son el borde del mapa
        for (let i = 1; i <= 14; i++) {
            if (i !== 5 && i !== 6 && i !== 11) prop(104, 14, i);
            if (i !== 7 && i !== 8 && i < 14) prop(107, i, 14);
        }
        for (const [px, py] of [[15, 5], [15, 6], [15, 11], [7, 15], [8, 15]] as const) w.tiles[py][px] = pick(PATH);
        w.decals.push({ id: 265, x: 7.5 + 0.5, y: 7.5 + 0.5 });
        w.buildings = [{ id: 'fantasy_house', x: 9, y: 2, w: 3, h: 3 }];
        for (const b of w.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) w.blocked[y][x] = true;
        cabinA(6, 4); cabinA(13, 8); cabinA(5, 13); cabinA(12, 13); cabinB(2, 6); cabinB(2, 10);
        prop(296, 12, 11); // pozo de piedra
        prop(102, 10, 10); // fogata
        prop(103, 4, 11); // yunque
        for (const [id, x, y] of [[98, 10, 6], [100, 11, 6], [96, 4, 8], [99, 4, 9], [76, 3, 3], [77, 3, 4], [72, 12, 5], [75, 3, 13]] as const) prop(id, x, y);
        for (const [x, y] of [[2, 2], [13, 2], [3, 12], [11, 12], [6, 9], [9, 6]] as const) prop(pick(FLOWERS), x, y, false);
        for (const [x, y] of [[1, 1], [14, 1]] as const) prop(pick([252, 253, 254, 255]), x, y);
        const npcs: Npc[] = [{ id: 'mercader', name: 'Mercader', x: 9, y: 7, dir: 6 }, { id: 'capitan', name: 'Capitán Aldric', x: 6, y: 9, dir: 2 }];
        for (const n of npcs) { w.blocked[n.y][n.x] = true; w.npcs.push(n); }
        w.spawn = { ...HUBS.solmar }; w.fire = { x: 10, y: 10 };
    }

    // ================= Vhar =================
    {
        const c = CITIES[1];
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
            const plaza = x >= 74 && x <= 82 && y >= 9 && y <= 16, road = (x === 77 || x === 78 || x === 79 || y === 12 || y === 13) && !(y < 5);
            w.tiles[y][x] = plaza ? pick(STONE) : road ? pick(PATH) : rnd() < 0.22 ? pick(DRY_GROUND) : pick(STONE);
        }
        // muralla de vallas con una puerta al sur (la que conecta con el resto del mundo)
        for (let x = c.x0; x <= c.x1; x++) { prop(107, x, c.y0); if (x < 77 || x > 79) prop(107, x, c.y1); }
        for (let y = c.y0 + 1; y < c.y1; y++) { prop(104, c.x0, y); prop(104, c.x1, y); }
        w.decals.push({ id: 264, x: 78 + 0.5, y: 12.5 + 0.5 });
        cabinA(71, 7); cabinA(76, 7); cabinA(85, 7); cabinA(88, 9); cabinA(70, 18); cabinA(86, 18); cabinB(68, 12); cabinB(88, 13); cabinB(72, 14);
        prop(296, 83, 5); prop(102, 76, 11); prop(102, 80, 14); prop(103, 87, 16); prop(103, 69, 8);
        for (const [id, x, y] of [[96, 75, 16], [98, 76, 16], [100, 82, 10], [99, 83, 10], [101, 84, 11], [72, 82, 17], [75, 73, 17], [73, 81, 4]] as const) prop(id, x, y);
        for (const [x, y] of [[68, 5], [89, 4], [67, 20], [89, 20], [74, 4], [81, 19], [70, 11], [86, 12]] as const) prop(pick(DEAD), x, y);
        for (const [x, y] of [[72, 20], [84, 19], [69, 15], [87, 7]] as const) prop(pick(ROCKS), x, y);
        for (const [x, y] of [[68, 17], [71, 19], [88, 5]] as const) prop(pick([140, 141, 142, 143]), x, y);
        const npcs: Npc[] = [{ id: 'mercader', name: 'Mercader de Vhar', x: 80, y: 11, dir: 6 }, { id: 'capitan', name: 'Capitán Kharos', x: 76, y: 14, dir: 2 }];
        for (const n of npcs) { w.blocked[n.y][n.x] = true; w.npcs.push(n); }
    }

    // puertas entre el mundo y Vhar (pisar el tile y pasar al otro lado)
    w.portals = [...(w.portals ?? []),
        { x: 34, y: 14, tx: 78, ty: 19, msg: 'Cruzás la puerta hacia la Ciudad de Vhar.' },
        { x: 78, y: 20, tx: 34, ty: 15, msg: 'Salís de la Ciudad de Vhar.' }];
    w.tiles[14][34] = pick(STONE); w.tiles[20][78] = pick(STONE);
    w.blocked[14][34] = w.blocked[20][78] = false; w.blocked[15][34] = w.blocked[19][78] = false;
    w.props.push({ id: 138, x: 33 + 0.5, y: 14 + 0.5 } satisfies Prop, { id: 138, x: 35 + 0.5, y: 14 + 0.5 } satisfies Prop); w.blocked[14][33] = w.blocked[14][35] = true;
    w.hubs = HUBS; w.cities = CITIES;
    return w;
}
