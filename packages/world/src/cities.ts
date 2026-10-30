/**
 * Las dos ciudades, grandes y con barrios: Solmar (la villa del campamento, ahora con plaza, mercado, herrería, patio de
 * entrenamiento y empalizada con tres portones) y Vhar (un pueblo fortificado de tierras secas al noreste, que se conecta
 * con el mundo por una puerta al sur). Se arman con el arte de Flare (CC-BY-SA 3.0): cabañas de troncos de varias piezas
 * (como en Lochport y Black Oak City de la campaña Empyrean), vallas, fogatas, yunque, tiendas, cofres y el círculo rúnico de la plaza.
 * Cada ciudad tiene vendedores y servicios (ids `rol_s` / `rol_v`; el cliente decide qué vende cada rol).
 * Corre al final de buildSolmar, igual en cliente y server, con su propia semilla.
 */
import type { WorldMap, Prop, Npc } from './index';
import { sbs, SBS, PATH, ROCKS, DEAD, kenney } from './frontier';

export interface City { faction: 'solmar' | 'vhar'; name: string; x0: number; y0: number; x1: number; y1: number }
export const CITIES: City[] = [
    { faction: 'solmar', name: 'Ciudad de Solmar', x0: 1, y0: 1, x1: 18, y1: 22 },
    { faction: 'vhar', name: 'Ciudad de Vhar', x0: 63, y0: 1, x1: 94, y1: 25 },
];
export const HUBS: Record<string, { x: number; y: number }> = { solmar: { x: 7, y: 8 }, vhar: { x: 78, y: 13 } };
export const cityAt = (x: number, y: number): City | undefined => CITIES.find((c) => x >= c.x0 && x < c.x1 + 1 && y >= c.y0 && y < c.y1 + 1);

/** Celdas que tienen que quedar libres: los portales de entrenamiento actuales (training.ts), el 3x3 a la derecha de cada HUB (portal único) y las escaleras de la arena. */
const RESERVED: [number, number][] = [
    [1, 5], [1, 3], [2, 1], [4, 1], [6, 1], [8, 1], [13, 1], [13, 3], [13, 5], [12, 6],
    [67, 4], [69, 4], [71, 4], [73, 4], [76, 4], [78, 4], [80, 4], [83, 4], [85, 4], [87, 4],
    [9, 9], [10, 9],
];
for (const h of Object.values(HUBS)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) RESERVED.push([h.x + 3 + dx, h.y + dy], [h.x, h.y]);

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const DRY_GROUND = [sbs(SBS.rocky1, 1), sbs(SBS.rocky1, 2), sbs(SBS.rocky1, 7), sbs(SBS.rocky1, 10), sbs(SBS.rocky1, 12), sbs(SBS.dry1, 13)];
const FLOWERS = [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125];

export function extendCities(w: WorldMap): WorldMap {
    let seed = 424242;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
    const reserved = new Set(RESERVED.map(([x, y]) => `${x},${y}`));
    const isRes = (x: number, y: number) => reserved.has(`${x},${y}`);
    const STAIRS = kenney('stairsSpiral', 'S');

    const prop = (id: number, x: number, y: number, blocks = true) => { if (isRes(x, y)) return; w.props.push({ id, x: x + 0.5, y: y + 0.5 }); if (blocks) w.blocked[y][x] = true; };
    const block = (x: number, y: number) => { if (!isRes(x, y)) w.blocked[y][x] = true; };
    /** Cabaña de troncos de Flare, variante con la puerta hacia el sur: tres piezas en fila (x-2..x) y el techo en (x, y-1). Ocupa 3x2 celdas. */
    const cabinA = (x: number, y: number) => { prop(212, x - 2, y); prop(213, x - 1, y); prop(214, x, y); prop(215, x, y - 1); block(x - 2, y - 1); block(x - 1, y - 1); };
    /** Variante con la puerta hacia el este: (x, y), (x, y+1) y dos piezas en la fila de abajo. Ocupa 2x3 celdas. */
    const cabinB = (x: number, y: number) => { prop(211, x, y); prop(210, x, y + 1); prop(208, x - 1, y + 2); prop(209, x, y + 2); block(x - 1, y); block(x - 1, y + 1); };
    const rectF = (x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y); };
    const npcs: Npc[] = [];
    const npc = (id: string, name: string, x: number, y: number, dir: number) => npcs.push({ id, name, x, y, dir });
    /** Cercas con huecos (portones): `gaps` son las coordenadas libres a lo largo de la cerca. */
    const fenceH = (x0: number, x1: number, y: number, gaps: number[] = []) => { for (let x = x0; x <= x1; x++) if (!gaps.includes(x)) prop(107, x, y); };
    const fenceV = (x: number, y0: number, y1: number, gaps: number[] = []) => { for (let y = y0; y <= y1; y++) if (!gaps.includes(y)) prop(104, x, y); };

    // limpia lo que había dentro de cada ciudad (el campamento viejo, vegetación suelta; mobs no hay: es zona segura)
    for (const c of CITIES) {
        const keep = (p: { x: number; y: number }) => !(p.x >= c.x0 && p.x <= c.x1 + 1 && p.y >= c.y0 && p.y <= c.y1 + 1);
        w.props = w.props.filter(keep); w.decals = w.decals.filter(keep); w.buildings = w.buildings.filter(keep); w.npcs = w.npcs.filter(keep);
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { w.blocked[y][x] = false; w.safe[y][x] = true; }
    }
    /** Despeja (props y bloqueos) una franja fuera de la ciudad y la pavimenta con camino: así los portones siempre conectan con el mundo. */
    const clearStrip = (x0: number, y0: number, x1: number, y1: number) => {
        w.props = w.props.filter((p) => !(p.x >= x0 && p.x < x1 + 1 && p.y >= y0 && p.y < y1 + 1));
        rectF(x0, y0, x1, y1, (x, y) => { w.blocked[y][x] = false; w.tiles[y][x] = pick(PATH); });
    };

    // ================= Solmar: plaza con círculo rúnico, mercado, herrería, patio de entrenamiento, empalizada con portones =================
    {
        const c = CITIES[0];
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
            const plaza = x >= 4 && x <= 13 && y >= 6 && y <= 11;
            const avenue = x === 7 || x === 8 || ((y === 8 || y === 9) && x >= 3);
            const street = ((y === 15 || y === 16) && x >= 2 && x <= 17) || (y === 5 && x >= 3 && x <= 13) || (x >= 3 && x <= 6 && y >= 17 && y <= 21);
            const yard = x >= 13 && x <= 17 && y >= 17 && y <= 21;
            w.tiles[y][x] = plaza || avenue ? pick(STONE) : street || yard ? pick(PATH) : pick(GRASS);
        }
        // empalizada: este y sur con portones (este: y 8-9 y 15-16; sur: x 7-8); norte y oeste son el borde del mapa
        fenceV(18, 1, 22, [8, 9, 15, 16]); fenceH(1, 17, 22, [7, 8]);
        clearStrip(19, 8, 22, 9); clearStrip(19, 15, 22, 16); clearStrip(7, 23, 8, 26);
        // plaza central
        w.decals.push({ id: 265, x: 8, y: 8 });
        prop(102, 4, 6); prop(102, 13, 10); prop(102, 4, 11); prop(137, 12, 6);
        // calle norte: dos cabañas y la casa del Capitán; casa del joyero al este
        cabinA(6, 4); cabinA(11, 4);
        w.buildings = [{ id: 'fantasy_house', x: 15, y: 2, w: 3, h: 3 }];
        for (const b of w.buildings) rectF(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, (x, y) => block(x, y));
        cabinA(17, 6);
        // oeste: casas
        cabinB(2, 8); cabinB(2, 12);
        // este: casas del alquimista y vecinos
        cabinA(17, 13); cabinA(17, 11);
        // mercader de pociones: toldo en la plaza
        prop(72, 5, 7); prop(98, 4, 8); prop(99, 4, 9);
        // armadurero: toldo y perchas
        prop(75, 5, 13); prop(76, 3, 14); prop(100, 6, 12);
        // herrería (armero): yunque, fogata, leña y la torre de piedra al fondo
        prop(103, 4, 18); prop(102, 3, 20); prop(101, 5, 21); prop(100, 2, 17); prop(98, 6, 19); prop(296, 2, 21);
        prop(77, 11, 14); prop(99, 12, 14);
        // patio de entrenamiento: cerca con un acceso por el oeste, postes y troncos
        fenceH(13, 17, 17); fenceV(13, 18, 21, [19]);
        for (const [id, x, y] of [[132, 15, 18], [133, 17, 19], [137, 15, 21], [134, 16, 20], [137, 17, 21]] as const) prop(id, x, y);
        // árboles de borde y plantas
        for (const [x, y] of [[1, 1], [15, 1], [17, 1], [1, 17], [1, 19], [3, 21], [10, 21], [12, 21], [14, 21], [17, 20]] as const) prop(pick([248, 249, 250, 251, 252, 253, 254, 255, 240, 241]), x, y);
        rectF(c.x0, c.y0, c.x1, c.y1, (x, y) => { if (!w.blocked[y][x] && w.tiles[y][x] >= 16 && w.tiles[y][x] <= 31 && rnd() < 0.07) prop(pick(FLOWERS), x, y, false); });
        npc('mercader_s', 'Mercader Ilario', 6, 7, 6);
        npc('armero_s', 'Armero Teodoro', 5, 18, 0);
        npc('armadurero_s', 'Armadurero Evaristo', 6, 14, 6);
        npc('joyero_s', 'Joyera Marisol', 16, 8, 6);
        npc('alquimista_s', 'Alquimista Celeste', 16, 14, 6);
        npc('capitan_s', 'Capitán Aldric', 6, 10, 2);
        npc('guardia_s1', 'Guardia del Faro', 17, 7, 4);
        npc('guardia_s2', 'Guardia de la Marea', 17, 10, 4);
        npc('guardia_s3', 'Guardia del Puerto', 6, 21, 2);
        w.spawn = { ...HUBS.solmar }; w.fire = { x: 4, y: 6 };
    }

    // ================= Vhar: muralla, plaza de hierro, forja, mercado del sur, patio de armas =================
    {
        const c = CITIES[1];
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
            const promenade = y >= 2 && y <= 5 && x >= 64 && x <= 93;
            const plaza = x >= 72 && x <= 85 && y >= 8 && y <= 17;
            const road = (x >= 77 && x <= 79 && y >= 6) || ((y === 12 || y === 13) && x >= 64 && x <= 93);
            const yard = x >= 83 && x <= 92 && y >= 18 && y <= 23;
            w.tiles[y][x] = plaza || promenade ? pick(STONE) : road ? pick(PATH) : yard ? pick(DRY_GROUND.slice(0, 3)) : rnd() < 0.3 ? pick(STONE) : pick(DRY_GROUND);
        }
        // muralla de vallas con una puerta al sur (la que conecta con el resto del mundo)
        fenceH(c.x0, c.x1, c.y0); fenceH(c.x0, c.x1, c.y1, [77, 78, 79]); fenceV(c.x0, c.y0 + 1, c.y1 - 1); fenceV(c.x1, c.y0 + 1, c.y1 - 1);
        w.decals.push({ id: 264, x: 78.5, y: 13 });
        // plaza: braseros
        prop(102, 73, 9); prop(102, 84, 9); prop(102, 73, 16); prop(102, 84, 16); prop(103, 85, 13);
        // barrio oeste: casas, armadurero (toldo) y la forja del armero
        cabinA(70, 9); cabinA(70, 16); cabinB(65, 7);
        prop(72, 66, 10); prop(98, 65, 11); prop(76, 64, 14);
        prop(103, 66, 18); prop(102, 66, 20); prop(101, 64, 19); prop(100, 69, 19); prop(99, 65, 22); prop(98, 69, 21); prop(296, 71, 23);
        // plaza noreste: casa del Capitán
        w.buildings = [{ id: 'fantasy_house', x: 88, y: 7, w: 3, h: 3 }];
        for (const b of w.buildings) rectF(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, (x, y) => block(x, y));
        // barrio este: joyero y alquimista
        cabinA(92, 16); cabinA(92, 11); cabinB(86, 21);
        prop(76, 88, 15); prop(77, 89, 15); prop(98, 93, 18); prop(99, 93, 19);
        // mercader de pociones: toldo al oeste de la plaza
        prop(75, 75, 10); prop(98, 74, 11); prop(100, 75, 15); prop(99, 74, 15);
        // mercado del sur
        prop(72, 71, 21); prop(75, 75, 20); prop(75, 81, 20); prop(72, 85, 18); prop(77, 82, 22); prop(98, 74, 22); prop(100, 80, 22);
        // patio de armas: postes y troncos de práctica
        fenceH(83, 92, 18, [87]); fenceV(83, 19, 23, [21]);
        for (const [id, x, y] of [[132, 85, 20], [133, 88, 20], [134, 91, 20], [137, 86, 22], [137, 90, 22]] as const) prop(id, x, y);
        for (const [x, y] of [[65, 3], [92, 3], [64, 24], [93, 24], [76, 8], [81, 8], [64, 9], [93, 22], [68, 24], [83, 24], [90, 24]] as const) prop(pick(DEAD), x, y);
        for (const [x, y] of [[66, 2], [88, 2], [72, 23], [93, 14], [64, 17], [87, 24], [67, 24]] as const) prop(pick(ROCKS), x, y);
        for (const [x, y] of [[66, 9], [92, 5], [64, 23]] as const) prop(pick([140, 141, 142, 143]), x, y);
        npc('mercader_v', 'Mercader Orlak', 74, 10, 6);
        npc('armero_v', 'Armero Kragen', 67, 18, 0);
        npc('armadurero_v', 'Armadurero Dovan', 67, 11, 6);
        npc('joyero_v', 'Joyero Sethra', 91, 17, 6);
        npc('alquimista_v', 'Alquimista Vexa', 91, 12, 6);
        npc('capitan_v', 'Capitán Kharos', 89, 11, 2);
        npc('guardia_v1', 'Guardia de Ceniza', 76, 24, 2);
        npc('guardia_v2', 'Guardia de Hierro', 80, 24, 2);
        npc('guardia_v3', 'Centinela de la Muralla', 82, 6, 6);
    }
    for (const n of npcs) { w.blocked[n.y][n.x] = true; w.npcs.push(n); }

    // celdas reservadas: portales, 3x3 del portal único y escaleras de la arena siempre libres (props y bloqueos fuera)
    for (const [x, y] of RESERVED) { w.blocked[y][x] = false; w.safe[y][x] = true; }
    w.props = w.props.filter((p) => !(isRes(Math.floor(p.x), Math.floor(p.y)) && p.id !== STAIRS));
    if (!w.props.some((p) => p.id === STAIRS && Math.floor(p.x) === 10 && Math.floor(p.y) === 9)) w.props.push({ id: STAIRS, x: 10.5, y: 9.5 }); // escalera a la arena de arena (el portal está en frontier.ts)

    // puertas entre el mundo y Vhar (pisar el tile y pasar al otro lado)
    w.portals = [...(w.portals ?? []),
        { x: 34, y: 14, tx: 78, ty: 23, msg: 'Cruzás la puerta hacia la Ciudad de Vhar.' },
        { x: 78, y: 24, tx: 34, ty: 15, msg: 'Salís de la Ciudad de Vhar.' }];
    w.tiles[14][34] = pick(STONE); w.tiles[24][78] = pick(STONE);
    w.blocked[14][34] = w.blocked[24][78] = false; w.blocked[15][34] = w.blocked[23][78] = false;
    w.props.push({ id: 138, x: 33 + 0.5, y: 14 + 0.5 } satisfies Prop, { id: 138, x: 35 + 0.5, y: 14 + 0.5 } satisfies Prop); w.blocked[14][33] = w.blocked[14][35] = true;
    w.hubs = HUBS; w.cities = CITIES;
    return w;
}
