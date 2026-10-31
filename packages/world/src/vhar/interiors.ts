/**
 * Interiores de la Ciudadela de Vhar: un mapa chico por edificio, en corte (como los de Solmar: paredes altas al fondo, muro bajo
 * adelante con el hueco de la salida) pero de hierro y brasas: paredes de ladrillo y piedra oscuros con troneras, pisos de placas,
 * adoquín y ladrillo, braseros, estandartes de Vhar, yunques y estantes de armas. La salida lleva de vuelta a la calle, frente a la puerta.
 */
import type { WorldMap } from '../index';
import { CRATES_METAL, KENNEY_FURNITURE, TOWN_PROPS, townCoping, townFurniture, townPillar, townWall, vharTile } from '../town';
import { TownMap } from '../solmar/kit';
import { roomOf, type Interior, type Room } from '../solmar/interiors';

export function buildVharInterior(it: Interior): WorldMap {
    const r = roomOf(it), t = new TownMap(r.N, it.seed, 0, true), { pick, w } = t;
    t.rect(r.x0, r.y0, r.x1, r.y1, (x, y) => { t.tile(x, y, pick(it.floor)); t.block(x, y, false); });
    t.tile(r.exit.x, r.exit.y, pick(it.floor)); t.block(r.exit.x, r.exit.y, false);
    t.reserve(r.exit.x, r.y1 - 2, r.exit.x, r.exit.y);
    // paredes del fondo: altas y casi ciegas (una tronera cada cuatro), pilares de esquina
    const v = (i: number) => (i % 4 === 1 ? 'ventana' : 'liso');
    for (let x = r.x0; x <= r.x1; x++) t.prop(townWall(it.wall, v(x), '\\'), x, r.y0, false, x + r.y0 - 0.6);
    for (let y = r.y0; y <= r.y1; y++) t.prop(townWall(it.wall, v(y + 1), '/'), r.x0, y, false, r.x0 + y - 0.6);
    t.prop(townPillar(it.wall), r.x0, r.y1 + 1, false, r.x0 + r.y1 + 0.4);
    t.prop(townPillar(it.wall), r.x1 + 1, r.y0, false, r.x1 + r.y0 + 0.4);
    // adelante, un muro bajo de piedra, con el hueco de la puerta y braseros a los lados
    for (let x = r.x0; x <= r.x1; x++) if (x !== r.exit.x) t.prop(townCoping('muro', '\\'), x, r.y1 + 1, false, x + r.y1 + 1 - 0.4);
    for (let y = r.y0; y <= r.y1; y++) t.prop(townCoping('muro', '/'), r.x1 + 1, y, false, r.x1 + 1 + y - 0.4);
    t.decal(TOWN_PROPS.alfombraV, r.exit.x, r.y1);
    t.prop(TOWN_PROPS.brasero, r.exit.x - 1, r.y1, true); t.prop(TOWN_PROPS.brasero, r.exit.x + 1, r.y1, true);
    it.deco(t, r);
    w.spawn = { ...r.arrive };
    w.cities = [{ faction: 'vhar', name: it.name, x0: 0, y0: 0, x1: r.N - 1, y1: r.N - 1 }];
    if (w.fire.x < 0) w.fire = { x: r.cx, y: r.y0 + 2 };
    return w;
}

type FurnitureName = (typeof KENNEY_FURNITURE)[number];
const K = (n: FurnitureName, o: 'N' | 'E' | 'S' | 'W' = 'S') => townFurniture(n, o);
const P = TOWN_PROPS;
const floor = (...c: number[]) => c.map(vharTile);
const columns = (t: TownMap, xs: number[], ys: number[]) => { for (const y of ys) for (const x of xs) t.prop(K('stoneColumn'), x, y); };
const runner = (t: TownMap, r: Room, y0: number) => { for (let y = y0; y <= r.y1; y++) t.decal(P.alfombraV, r.cx, y); };

export const VHAR_INTERIORS: Interior[] = [
    {
        id: 'vhar_concejo', name: 'Casa de Concejo', building: 'ayuntamiento', w: 14, h: 10, floor: floor(9, 10, 9, 9), wall: 'carbon', seed: 201,
        deco(t, r) {
            runner(t, r, r.y0 + 1);
            columns(t, [r.cx - 2, r.cx + 2], [r.y0 + 3, r.y0 + 6]);
            // despacho del Capitán (oeste): escritorio de guerra, estante de armas y estandartes
            t.npc('capitan_v', 'Capitán Kharos', r.x0 + 2, r.y0 + 2, 6);
            t.prop(K('tableShort', 'E'), r.x0 + 2, r.y0 + 4); t.prop(K('chair', 'S'), r.x0 + 1, r.y0 + 2);
            t.prop(P.estandarte, r.x0 + 1, r.y0); t.prop(P.perchero, r.x0 + 3, r.y0); t.prop(K('chestClosed', 'E'), r.x0, r.y0 + 4);
            t.prop(P.lingotes, r.x0, r.y1 - 1); t.prop(P.brasero, r.x0 + 1, r.y1 - 2);
            // casa de subastas (este): mostradores de hierro y el Subastador
            t.npc('subastador_v', 'Subastador Morvek', r.x1 - 2, r.y0 + 2, 6);
            t.prop(K('tableShort', 'S'), r.x1 - 3, r.y0 + 4); t.prop(K('tableShort', 'S'), r.x1 - 1, r.y0 + 4);
            t.prop(K('chestOpen', 'S'), r.x1 - 1, r.y0); t.prop(K('chestClosed', 'S'), r.x1 - 3, r.y0); t.prop(t.pick(CRATES_METAL), r.x1, r.y0 + 1);
            t.prop(t.pick(CRATES_METAL), r.x1, r.y0 + 2); t.prop(P.lingotes, r.x1, r.y1 - 1); t.prop(P.brasero, r.x1 - 1, r.y1 - 2);
            t.prop(P.estandarte, r.cx, r.y0); t.prop(P.monolito, r.cx - 3, r.y0 + 1); t.prop(P.monolito, r.cx + 3, r.y0 + 1);
            t.npc('guardia_v6', 'Guardia del Concejo', r.cx - 2, r.y1, 2);
            t.w.fire = { x: r.cx, y: r.y0 + 2 };
        },
    },
    {
        id: 'vhar_santuario', name: 'Santuario de Ceniza', building: 'templo', w: 13, h: 11, floor: floor(3, 4, 3, 5), wall: 'basalto', seed: 202,
        deco(t, r) {
            columns(t, [r.x0 + 2, r.x1 - 2], [r.y0 + 2, r.y0 + 5, r.y0 + 8]);
            runner(t, r, r.y0 + 6);
            t.tile(r.cx, r.y0 + 4, vharTile(11)); // círculo de runas frente al altar (el punto de reaparición)
            for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) t.decal(P.alfombraV, r.cx + dx * 2, r.y0 + 4 + dy * 2);
            // altar de forja al fondo: yunque, brasas y la Sanadora
            t.prop(K('tableShort', 'S'), r.cx - 1, r.y0); t.prop(K('tableShort', 'S'), r.cx + 1, r.y0);
            t.prop(P.brasero, r.cx - 2, r.y0 + 1); t.prop(P.brasero, r.cx + 2, r.y0 + 1);
            t.npc('sanador_v', 'Sacerdotisa Nerya', r.cx, r.y0 + 1, 6);
            for (const y of [r.y0 + 6, r.y0 + 8]) for (const x of [r.x0 + 4, r.x1 - 4]) t.prop(K('tableShortChairs', 'S'), x, y);
            t.prop(P.estandarte, r.x0, r.y0); t.prop(P.estandarte, r.x1, r.y0);
            t.prop(P.monolito, r.x0 + 1, r.y0 + 4); t.prop(P.monolito, r.x1 - 1, r.y0 + 4);
            t.prop(P.obsidiana, r.x0, r.y1 - 1); t.prop(P.obsidiana, r.x1, r.y1 - 1);
            t.w.fire = { x: r.cx, y: r.y0 + 2 };
        },
    },
    {
        id: 'vhar_forja', name: 'Forja de Hierro', building: 'herreria', w: 12, h: 9, floor: floor(17, 17, 9, 17), wall: 'herrumbre', seed: 203,
        deco(t, r) {
            // la gran fragua al fondo, yunques y leña (armero, oeste); mesas de trabajo y armaduras (armadurero, este)
            t.prop(P.forja, r.x0, r.y0); t.prop(P.forja, r.x0 + 2, r.y0); t.prop(P.yunque, r.x0 + 2, r.y0 + 2); t.prop(K('woodenPile'), r.x0, r.y0 + 2);
            t.npc('armero_v', 'Armero Kragen', r.x0 + 2, r.y0 + 4, 6);
            t.prop(P.lingotes, r.x0, r.y1 - 1); t.prop(t.pick(CRATES_METAL), r.x0, r.y1); t.prop(P.yunque, r.x0 + 1, r.y1 - 2);
            t.npc('armadurero_v', 'Armadurero Dovan', r.x1 - 2, r.y0 + 4, 6);
            t.prop(P.forja, r.x1, r.y0); t.prop(K('tableShort', 'S'), r.x1 - 2, r.y0 + 2); t.prop(P.perchero, r.x1 - 4, r.y0);
            for (const y of [r.y0 + 4, r.y0 + 6]) t.prop(t.pick(CRATES_METAL), r.x1, y);
            t.prop(P.lingotes, r.x1, r.y1); t.prop(P.brasero, r.cx, r.y0); t.prop(P.brasero, r.x0, r.y0 + 6);
            t.w.fire = { x: r.cx, y: r.y0 + 2 };
        },
    },
    {
        id: 'vhar_bazar', name: 'Bazar del Yunque', building: 'tienda', w: 12, h: 8, floor: floor(6, 7, 8, 6), wall: 'hollin', seed: 204,
        deco(t, r) {
            // estantes de hierro con mercancía al fondo, mostradores delante de cada vendedor
            for (let x = r.x0; x <= r.x1; x++) if (Math.abs(x - r.cx) > 1) t.prop(t.pick([K('barrelsStacked'), t.pick(CRATES_METAL), K('barrels'), P.lingotes, P.perchero]), x, r.y0);
            t.npc('mercader_v', 'Mercader Orlak', r.x0 + 2, r.y0 + 2, 6);
            t.prop(K('tableShort', 'S'), r.x0 + 1, r.y0 + 3); t.prop(K('tableShort', 'S'), r.x0 + 3, r.y0 + 3);
            t.npc('alquimista_v', 'Alquimista Vexa', r.x1 - 2, r.y0 + 2, 6);
            t.prop(K('tableRoundItemsChairs', 'S'), r.x1 - 1, r.y0 + 4); t.prop(K('tableShort', 'S'), r.x1 - 3, r.y0 + 3);
            t.prop(P.lingotes, r.x0, r.y1 - 1); t.prop(t.pick(CRATES_METAL), r.x1, r.y1); t.prop(K('barrel'), r.x1, r.y1 - 1);
            t.prop(P.brasero, r.x0, r.y0 + 3); t.prop(P.estandarte, r.cx, r.y0);
        },
    },
    {
        id: 'vhar_orfebreria', name: 'Orfebrería de Vhar', building: 'joyeria', w: 10, h: 8, floor: floor(9, 9, 11, 10), wall: 'sangre', seed: 205,
        deco(t, r) {
            runner(t, r, r.y0 + 3);
            t.npc('joyero_v', 'Joyero Sethra', r.cx, r.y0 + 1, 6);
            t.prop(K('tableShort', 'S'), r.cx - 1, r.y0 + 2); t.prop(K('tableShort', 'S'), r.cx + 1, r.y0 + 2);
            t.prop(K('chestClosed', 'S'), r.x0, r.y0); t.prop(K('chestOpen', 'S'), r.x1, r.y0); t.prop(K('chestClosed', 'E'), r.x0, r.y1 - 1);
            t.prop(P.brasero, r.x0 + 1, r.y0); t.prop(P.brasero, r.x1 - 1, r.y0); t.prop(P.obsidiana, r.x1, r.y1 - 1);
            t.prop(P.estandarte, r.x0 + 3, r.y0); t.prop(P.estandarte, r.x1 - 3, r.y0);
        },
    },
    {
        id: 'vhar_camara', name: 'Cámara Fuerte', building: 'deposito', w: 12, h: 9, floor: floor(10, 9, 10, 10), wall: 'hierro', seed: 206,
        deco(t, r) {
            t.npc('depositario_v', 'Depositaria Ilsa', r.cx, r.y0 + 2, 6);
            t.prop(K('tableShort', 'S'), r.cx - 1, r.y0 + 3); t.prop(K('tableShort', 'S'), r.cx + 1, r.y0 + 3);
            // cofres de hierro y pilas de lingotes contra las paredes
            for (let y = r.y0; y <= r.y1 - 1; y++) { if (t.rnd() < 0.85) t.prop(t.pick(CRATES_METAL), r.x0, y); if (t.rnd() < 0.85) t.prop(t.rnd() < 0.5 ? t.pick(CRATES_METAL) : P.lingotes, r.x1, y); }
            for (let x = r.x0 + 1; x <= r.x1 - 1; x++) if (Math.abs(x - r.cx) > 1) t.prop(t.rnd() < 0.5 ? t.pick(CRATES_METAL) : K('chestClosed', 'S'), x, r.y0);
            t.prop(P.lingotes, r.x0 + 2, r.y0 + 2); t.prop(P.lingotes, r.x1 - 2, r.y0 + 2); t.prop(K('chestClosed', 'E'), r.x0 + 1, r.y1);
            t.prop(P.brasero, r.cx - 3, r.y0 + 5); t.prop(P.brasero, r.cx + 3, r.y0 + 5);
        },
    },
    {
        id: 'vhar_torre', name: 'Torre de las Brasas', building: 'torre', w: 9, h: 9, floor: floor(0, 11, 1, 2), wall: 'pizarra', seed: 207,
        deco(t, r) {
            t.tile(r.cx, r.y0 + 4, vharTile(11));
            for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) t.decal(P.alfombraV, r.cx + dx, r.y0 + 4 + dy);
            t.npc('mago_v', 'Archimago Zorvak', r.cx, r.y0 + 1, 6);
            t.prop(K('tableRoundItemsChairs', 'S'), r.x0 + 1, r.y0 + 1); t.prop(K('chestClosed', 'S'), r.x1, r.y0);
            t.prop(P.obsidiana, r.x0, r.y1 - 1); t.prop(P.obsidiana, r.x1, r.y1 - 1); t.prop(P.brasero, r.x0, r.y0 + 3); t.prop(P.brasero, r.x1 - 1, r.y0);
            columns(t, [r.x0 + 1, r.x1 - 1], [r.y0 + 6]);
            t.w.fire = { x: r.cx, y: r.y0 + 4 };
        },
    },
    {
        id: 'vhar_cuartel', name: 'Cuartel de Hierro', building: 'cuartel', w: 14, h: 10, floor: floor(6, 8, 7, 6), wall: 'sangre', seed: 208,
        deco(t, r) {
            for (const y of [r.y0 + 2, r.y0 + 4, r.y0 + 6]) t.prop(K('tableShortChairs', 'E'), r.x0 + 1, y);
            for (let y = r.y0; y <= r.y0 + 6; y += 2) t.prop(t.pick(CRATES_METAL), r.x1, y);
            t.prop(P.perchero, r.x1 - 2, r.y0); t.prop(P.perchero, r.x1 - 4, r.y0); t.prop(P.forja, r.x1 - 6, r.y0); t.prop(K('woodenPile'), r.x1 - 3, r.y1 - 1);
            for (let x = r.x0; x <= r.x0 + 4; x += 2) t.prop(P.perchero, x, r.y0);
            t.npc('guardia_v7', 'Sargento Kroth', r.cx, r.y0 + 2, 6);
            t.npc('guardia_v8', 'Recluta de Hierro', r.cx + 3, r.y0 + 4, 4);
            t.npc('guardia_v9', 'Veterana de Vhar', r.x0 + 4, r.y0 + 5, 0);
            t.prop(P.estandarte, r.cx - 2, r.y0); t.prop(P.estandarte, r.cx + 2, r.y0); t.prop(P.pinchos, r.x0 + 1, r.y1 - 1); t.prop(P.pinchos, r.x1 - 1, r.y1 - 2);
            t.w.fire = { x: r.x1 - 6, y: r.y0 + 1 };
        },
    },
];
export const vharInteriorById = (id: string): Interior | undefined => VHAR_INTERIORS.find((i) => i.id === id);
/** Punto de reaparición de Vhar: en el Santuario de Ceniza, sobre el círculo de runas, frente al altar (lejos de la salida). */
export const VHAR_RESPAWN = (() => { const r = roomOf(VHAR_INTERIORS.find((i) => i.id === 'vhar_santuario')!); return { x: r.cx, y: r.y0 + 4 }; })();
