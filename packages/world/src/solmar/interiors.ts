/**
 * Interiores de la Villa de Solmar: un mapa chico por edificio, en corte ("cutaway"): las paredes del fondo (norte y oeste) son
 * altas y con ventanas, las de adelante (sur y este) son muretes bajos, así el jugador se ve siempre. La salida es el hueco del
 * murete sur (celda disparadora) y lleva de vuelta a la calle, frente a la puerta.
 */
import type { WorldMap } from '../index';
import { CRATES_METAL, CRATES_WOOD, KENNEY_FURNITURE, TOWN_PROPS, townCoping, townFurniture, townPillar, townWall, type WallStyle } from '../town';
import { TownMap, type Cell } from './kit';
import type { VillaBuilding } from './villa';

export interface Interior {
    id: string; name: string; building: VillaBuilding;
    w: number; h: number; floor: number[]; wall: WallStyle; seed: number;
    deco(t: TownMap, r: Room): void;
}
/** Habitación armada: rectángulo de piso, celda de salida (disparadora) y de llegada (adentro). */
export interface Room { x0: number; y0: number; x1: number; y1: number; exit: Cell; arrive: Cell; cx: number; N: number }

const O = 3;
export function roomOf(it: Interior): Room {
    const x0 = O, y0 = O, x1 = O + it.w - 1, y1 = O + it.h - 1, dx = x0 + Math.floor(it.w / 2);
    return { x0, y0, x1, y1, exit: { x: dx, y: y1 + 1 }, arrive: { x: dx, y: y1 - 1 }, cx: dx, N: Math.max(16, Math.max(it.w, it.h) + O + 4) };
}

export function buildInterior(it: Interior): WorldMap {
    const r = roomOf(it), t = new TownMap(r.N, it.seed, 0, true), { pick, w } = t;
    t.rect(r.x0, r.y0, r.x1, r.y1, (x, y) => { t.tile(x, y, pick(it.floor)); t.block(x, y, false); });
    t.tile(r.exit.x, r.exit.y, pick(it.floor)); t.block(r.exit.x, r.exit.y, false);
    // pasillo de la entrada libre
    t.reserve(r.exit.x, r.y1 - 2, r.exit.x, r.exit.y);
    // paredes del fondo (altas, con ventanas) y pilares en las puntas
    const v = (i: number) => (i % 3 === 1 ? 'ventana' : i % 3 === 2 ? 'ventana2' : 'liso');
    for (let x = r.x0; x <= r.x1; x++) t.prop(townWall(it.wall, v(x), '\\'), x, r.y0, false, x + r.y0 - 0.6);
    for (let y = r.y0; y <= r.y1; y++) t.prop(townWall(it.wall, v(y + 1), '/'), r.x0, y, false, r.x0 + y - 0.6);
    t.prop(townPillar(it.wall), r.x0, r.y1 + 1, false, r.x0 + r.y1 + 0.4);
    t.prop(townPillar(it.wall), r.x1 + 1, r.y0, false, r.x1 + r.y0 + 0.4);
    // muretes de adelante, con el hueco de la puerta
    for (let x = r.x0; x <= r.x1; x++) if (x !== r.exit.x) t.prop(townCoping('murete', '\\'), x, r.y1 + 1, false, x + r.y1 + 1 - 0.4);
    for (let y = r.y0; y <= r.y1; y++) t.prop(townCoping('murete', '/'), r.x1 + 1, y, false, r.x1 + 1 + y - 0.4);
    t.decal(TOWN_PROPS.alfombra, r.exit.x, r.y1);
    it.deco(t, r);
    w.spawn = { ...r.arrive };
    w.cities = [{ faction: 'solmar', name: it.name, x0: 0, y0: 0, x1: r.N - 1, y1: r.N - 1 }];
    if (w.fire.x < 0) w.fire = { x: r.cx, y: r.y0 + 2 };
    return w;
}

type FurnitureName = (typeof KENNEY_FURNITURE)[number];
const K = (n: FurnitureName, o: 'N' | 'E' | 'S' | 'W' = 'S') => townFurniture(n, o);
/** Fila de columnas de piedra. */
const columns = (t: TownMap, xs: number[], ys: number[]) => { for (const y of ys) for (const x of xs) t.prop(K('stoneColumn'), x, y); };
/** Alfombra de pasillo (decals) desde la puerta hasta `y`. */
const runner = (t: TownMap, r: Room, y0: number) => { for (let y = y0; y <= r.y1; y++) t.decal(TOWN_PROPS.alfombra, r.cx, y); };

export const INTERIORS: Interior[] = [
    {
        id: 'solmar_ayuntamiento', name: 'Ayuntamiento de Solmar', building: 'ayuntamiento', w: 13, h: 9, floor: [1266, 1265, 1266], wall: 'cal', seed: 101,
        deco(t, r) {
            runner(t, r, r.y0 + 1);
            columns(t, [r.cx - 2, r.cx + 2], [r.y0 + 3, r.y0 + 6]);
            // despacho del Capitán (oeste): escritorio, cofres y estandarte
            t.npc('capitan_s', 'Capitán Aldric', r.x0 + 2, r.y0 + 2, 6);
            t.prop(K('tableShort', 'E'), r.x0 + 2, r.y0 + 4); t.prop(K('chair', 'S'), r.x0 + 1, r.y0 + 2);
            t.prop(TOWN_PROPS.bandera, r.x0 + 1, r.y0); t.prop(K('chestClosed', 'E'), r.x0, r.y0 + 4); t.prop(K('barrels'), r.x0, r.y1 - 1);
            t.prop(TOWN_PROPS.farol, r.x0 + 3, r.y0); t.prop(K('tableRoundChairs'), r.x0 + 1, r.y1 - 1);
            // casa de subastas (este): mostrador, cofres y la Subastadora
            t.npc('subastador_s', 'Subastadora Rosalba', r.x1 - 2, r.y0 + 2, 6);
            t.prop(K('tableShort', 'S'), r.x1 - 3, r.y0 + 4); t.prop(K('tableShort', 'S'), r.x1 - 1, r.y0 + 4);
            t.prop(K('chestOpen', 'S'), r.x1 - 1, r.y0); t.prop(K('chestClosed', 'S'), r.x1 - 3, r.y0); t.prop(K('woodenCrates'), r.x1, r.y0 + 1);
            t.prop(t.pick(CRATES_WOOD), r.x1, r.y0 + 2); t.prop(K('barrelsStacked'), r.x1, r.y1 - 1); t.prop(t.pick(CRATES_WOOD), r.x1 - 1, r.y1);
            t.prop(TOWN_PROPS.bandera, r.cx, r.y0);
            t.npc('guardia_s6', 'Guardia del Ayuntamiento', r.cx - 2, r.y1, 2);
            t.w.fire = { x: r.cx, y: r.y0 + 2 };
        },
    },
    {
        id: 'solmar_templo', name: 'Templo de la Marea', building: 'templo', w: 12, h: 10, floor: [1294, 1295, 1294], wall: 'crema', seed: 102,
        deco(t, r) {
            columns(t, [r.x0 + 2, r.x1 - 2], [r.y0 + 2, r.y0 + 5, r.y0 + 8]);
            runner(t, r, r.y0 + 6);
            for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const) t.decal(TOWN_PROPS.alfombra, r.cx + dx, r.y0 + 4 + dy); // cruz de alfombras frente al altar
            // altar al fondo con faroles, bancos a los costados
            t.prop(K('tableShort', 'S'), r.cx - 1, r.y0); t.prop(K('tableShort', 'S'), r.cx + 1, r.y0);
            t.prop(TOWN_PROPS.farol, r.cx - 2, r.y0); t.prop(TOWN_PROPS.farol, r.cx + 2, r.y0);
            t.npc('sanador_s', 'Hermana Celina', r.cx, r.y0 + 1, 6);
            for (const y of [r.y0 + 6, r.y0 + 8]) for (const x of [r.x0 + 4, r.x1 - 4]) t.prop(K('tableShortChairs', 'S'), x, y);
            t.prop(TOWN_PROPS.bandera, r.x0, r.y0); t.prop(TOWN_PROPS.bandera, r.x1, r.y0);
            t.prop(TOWN_PROPS.farol, r.x0, r.y0 + 4); t.prop(TOWN_PROPS.farol, r.x1, r.y0 + 4);
            t.w.fire = { x: r.cx, y: r.y0 + 1 };
        },
    },
    {
        id: 'solmar_herreria', name: 'Herrería de Solmar', building: 'herreria', w: 10, h: 8, floor: [1306, 1306, 1307], wall: 'piedra', seed: 103,
        deco(t, r) {
            // fragua y yunque (armero, oeste); mesas y cajas de metal (armadurero, este)
            t.prop(102, r.x0, r.y0); t.prop(103, r.x0 + 2, r.y0 + 1); t.prop(K('woodenPile'), r.x0, r.y0 + 2); t.prop(K('barrel'), r.x0 + 1, r.y0);
            t.npc('armero_s', 'Armero Teodoro', r.x0 + 2, r.y0 + 3, 6);
            t.prop(t.pick(CRATES_METAL), r.x0, r.y1 - 1); t.prop(t.pick(CRATES_METAL), r.x0, r.y1); t.prop(K('barrels'), r.x0 + 1, r.y1);
            t.npc('armadurero_s', 'Armadurero Evaristo', r.x1 - 2, r.y0 + 3, 6);
            t.prop(K('tableShort', 'S'), r.x1 - 2, r.y0 + 1); t.prop(K('tableShort', 'S'), r.x1, r.y0 + 1);
            for (const y of [r.y0 + 3, r.y0 + 5]) t.prop(t.pick(CRATES_METAL), r.x1, y);
            t.prop(K('chestClosed', 'W'), r.x1, r.y1); t.prop(TOWN_PROPS.farol, r.cx, r.y0); t.prop(TOWN_PROPS.farol, r.x0, r.y0 + 5);
            t.w.fire = { x: r.x0, y: r.y0 };
        },
    },
    {
        id: 'solmar_tienda', name: 'Tienda de Solmar', building: 'tienda', w: 10, h: 8, floor: [1261, 1262, 1261], wall: 'madera_clara', seed: 104,
        deco(t, r) {
            // estanterías (barriles y cajas) contra el fondo, mostradores delante de cada vendedor
            for (let x = r.x0; x <= r.x1; x++) if (Math.abs(x - r.cx) > 1) t.prop(t.pick([K('barrelsStacked'), K('woodenCrates'), K('barrels'), K('woodenCrate')]), x, r.y0);
            t.npc('mercader_s', 'Mercader Ilario', r.x0 + 2, r.y0 + 2, 6);
            t.prop(K('tableShort', 'S'), r.x0 + 1, r.y0 + 3); t.prop(K('tableShort', 'S'), r.x0 + 3, r.y0 + 3);
            t.npc('alquimista_s', 'Alquimista Celeste', r.x1 - 2, r.y0 + 2, 6);
            t.prop(K('tableRoundItemsChairs', 'S'), r.x1 - 1, r.y0 + 4); t.prop(K('tableShort', 'S'), r.x1 - 3, r.y0 + 3);
            t.prop(98, r.x0, r.y1 - 1); t.prop(99, r.x0, r.y1); t.prop(t.pick(CRATES_WOOD), r.x1, r.y1); t.prop(K('barrel'), r.x1, r.y1 - 1);
            t.prop(TOWN_PROPS.farol, r.x0, r.y0 + 3); t.prop(TOWN_PROPS.farol, r.cx, r.y0);
        },
    },
    {
        id: 'solmar_joyeria', name: 'Joyería de Solmar', building: 'joyeria', w: 9, h: 7, floor: [1355, 1355, 1343], wall: 'cal', seed: 105,
        deco(t, r) {
            runner(t, r, r.y0 + 3);
            t.npc('joyero_s', 'Joyera Marisol', r.cx, r.y0 + 1, 6);
            t.prop(K('tableShort', 'S'), r.cx - 1, r.y0 + 2); t.prop(K('tableShort', 'S'), r.cx + 1, r.y0 + 2);
            t.prop(K('chestClosed', 'S'), r.x0, r.y0); t.prop(K('chestOpen', 'S'), r.x1, r.y0); t.prop(K('chestClosed', 'E'), r.x0, r.y1 - 1);
            t.prop(TOWN_PROPS.farol, r.x0 + 1, r.y0); t.prop(TOWN_PROPS.farol, r.x1 - 1, r.y0); t.prop(TOWN_PROPS.bandera, r.x1, r.y1 - 1);
        },
    },
    {
        id: 'solmar_deposito', name: 'Depósito de Solmar', building: 'deposito', w: 10, h: 8, floor: [1272, 1273, 1272], wall: 'madera', seed: 106,
        deco(t, r) {
            t.npc('depositario_s', 'Depositario Bruno', r.cx, r.y0 + 2, 6);
            t.prop(K('tableShort', 'S'), r.cx - 1, r.y0 + 3); t.prop(K('tableShort', 'S'), r.cx + 1, r.y0 + 3);
            // pilas de cajas y barriles a los costados y al fondo
            for (let y = r.y0; y <= r.y1 - 1; y++) { if (t.rnd() < 0.85) t.prop(t.pick(CRATES_WOOD), r.x0, y); if (t.rnd() < 0.85) t.prop(t.rnd() < 0.5 ? t.pick(CRATES_WOOD) : K('barrels'), r.x1, y); }
            for (let x = r.x0 + 1; x <= r.x1 - 1; x++) if (Math.abs(x - r.cx) > 1) t.prop(t.rnd() < 0.6 ? t.pick(CRATES_WOOD) : t.pick(CRATES_METAL), x, r.y0);
            t.prop(K('woodenCrates'), r.x0 + 2, r.y0 + 2); t.prop(K('barrelsStacked'), r.x1 - 2, r.y0 + 2); t.prop(K('woodenPile'), r.x0 + 1, r.y1);
            t.prop(TOWN_PROPS.farol, r.cx - 3, r.y0 + 4); t.prop(TOWN_PROPS.farol, r.cx + 3, r.y0 + 4);
        },
    },
    {
        id: 'solmar_torre', name: 'Torre de Magia', building: 'torre', w: 8, h: 8, floor: [1297, 1297, 1314], wall: 'lila', seed: 107,
        deco(t, r) {
            for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) t.decal(TOWN_PROPS.alfombra, r.cx + dx, r.y0 + 4 + dy);
            t.npc('mago_s', 'Archimaga Ondina', r.cx, r.y0 + 1, 6);
            t.prop(K('tableRoundItemsChairs', 'S'), r.x0 + 1, r.y0 + 1); t.prop(K('chestClosed', 'S'), r.x1, r.y0);
            t.prop(K('woodenCrates'), r.x0, r.y1 - 1); t.prop(TOWN_PROPS.farol, r.x0, r.y0 + 3); t.prop(TOWN_PROPS.farol, r.x1 - 1, r.y0);
            columns(t, [r.x0 + 1, r.x1 - 1], [r.y0 + 6]);
            t.w.fire = { x: r.cx, y: r.y0 + 4 };
        },
    },
    {
        id: 'solmar_cuartel', name: 'Cuartel de Solmar', building: 'cuartel', w: 12, h: 9, floor: [1306, 1308, 1306], wall: 'piedra', seed: 108,
        deco(t, r) {
            for (const y of [r.y0 + 2, r.y0 + 4, r.y0 + 6]) t.prop(K('tableShortChairs', 'E'), r.x0 + 1, y);
            for (let y = r.y0; y <= r.y0 + 6; y += 2) t.prop(t.pick(CRATES_METAL), r.x1, y);
            t.prop(K('barrels'), r.x1, r.y1 - 1); t.prop(102, r.x1 - 2, r.y0); t.prop(K('woodenPile'), r.x1 - 3, r.y0);
            for (let x = r.x0; x <= r.x0 + 4; x += 2) t.prop(t.pick(CRATES_WOOD), x, r.y0);
            t.npc('guardia_s7', 'Sargento Marcial', r.cx, r.y0 + 2, 6);
            t.npc('guardia_s8', 'Guardia Novato', r.cx + 3, r.y0 + 4, 4);
            t.npc('guardia_s9', 'Guardia Veterana', r.x0 + 3, r.y0 + 5, 0);
            t.prop(TOWN_PROPS.bandera, r.cx - 2, r.y0); t.prop(TOWN_PROPS.bandera, r.cx + 2, r.y0); t.prop(TOWN_PROPS.farol, r.x0, r.y1 - 1);
            t.w.fire = { x: r.x1 - 2, y: r.y0 };
        },
    },
];
export const interiorById = (id: string): Interior | undefined => INTERIORS.find((i) => i.id === id);
/** Punto de reaparición de Solmar: en el templo, sobre el círculo de piedra, frente al altar (lejos de la salida). */
export const TEMPLE_RESPAWN = (() => { const r = roomOf(INTERIORS.find((i) => i.id === 'solmar_templo')!); return { x: r.cx, y: r.y0 + 4 }; })();
