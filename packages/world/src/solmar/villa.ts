/**
 * Villa de Solmar (Fase 2 de docs/MUNDO.md): ciudad costera de 128x128, hogar de la facción Solmar. Muralla de piedra con
 * torres y portón al este (camino a las tierras de caza del mapa viejo), plaza central con el Portal de Frontera, calles
 * empedradas, jardines, mercado, patio del cuartel, paseo marítimo con balaustrada, playa, tres muelles y un faro.
 * Los edificios con interior (Ayuntamiento, Templo, Herrería, Tienda, Joyería, Depósito, Torre de magia y Cuartel) tienen la
 * puerta en la cara sur o este (las que se ven) y un vínculo `enter` en la celda de la puerta.
 *
 * Arte: pisos y paredes de Screaming Brain Studios (CC0, town.webp/terrain.webp), árboles, flores, tiendas y cajas de Flare
 * (CC-BY-SA, world.webp), tablones y barriles de Kenney (CC0, dungeon.webp).
 */
import type { WorldMap } from '../index';
import { kenney } from '../frontier';
import { CRATES_METAL, CRATES_WOOD, FOAM, TOWN_PROPS, townBuilding, townCoping, townStairs, townTile, townWall } from '../town';
import { noise2, TownMap, type Cell } from './kit';

export const VILLA_ID = 'solmar_villa';
export const VILLA_N = 128;
/** Edificios con interior: id del mapa interior, fachada y esquina norte en la villa. */
export const VILLA_BUILDINGS = {
    ayuntamiento: { map: 'solmar_ayuntamiento', facade: 'sm_ayuntamiento', x: 62, y: 30 },
    templo: { map: 'solmar_templo', facade: 'sm_templo', x: 47, y: 29 },
    joyeria: { map: 'solmar_joyeria', facade: 'sm_joyeria', x: 39, y: 41 },
    tienda: { map: 'solmar_tienda', facade: 'sm_tienda', x: 38, y: 57 },
    herreria: { map: 'solmar_herreria', facade: 'sm_herreria', x: 77, y: 45 },
    deposito: { map: 'solmar_deposito', facade: 'sm_deposito', x: 88, y: 45 },
    cuartel: { map: 'solmar_cuartel', facade: 'sm_cuartel', x: 76, y: 56 },
    torre: { map: 'solmar_torre', facade: 'sm_torre', x: 98, y: 37 },
} as const;
export type VillaBuilding = keyof typeof VILLA_BUILDINGS;

export const VILLA = {
    /** Aparición de personajes nuevos y destino del Portal de Frontera ("volver a la ciudad"): al sur del portal de la plaza. */
    spawn: { x: 60, y: 56 },
    portal: { x: 60, y: 52 },
    /** Camino al mapa viejo (afuera del portón este) y llegada desde allá. */
    toLegacy: { x: 125, y: 52 }, fromLegacy: { x: 122, y: 52 },
};

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const FLOWERS = [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127];
const LEAFY = [240, 241, 242, 243, 252, 253, 254, 255];
const PINES = [248, 249, 250, 251];
const COBBLE = [1218, 1237, 1238, 1218];
const PLAZA = [1266, 1265, 1266];
const PLAZA_RING = [1258];
const PROMENADE = [1258];
const SAND = [townTile('terrain2', 17)];
const WATER_SHALLOW = [townTile('water', 14), townTile('water', 17)];
const WATER = [townTile('water', 1), townTile('water', 4)];
const WATER_DEEP = [townTile('water', 13), townTile('water', 16)];
const FOREST = Array.from({ length: 18 }, (_, i) => townTile('forest', i)).filter((_, i) => i !== 5 && i !== 15 && i !== 16);
const PLANKS = [kenney('planks', 'N'), kenney('planks', 'S')];
const MARKET_TENTS = [72, 73, 74, 75];

/** Puerta de un edificio con interior: la celda de la puerta (disparadora) y la de llegada al salir (un paso hacia la calle). */
export function villaDoor(k: VillaBuilding): { door: Cell; out: Cell } {
    const v = VILLA_BUILDINGS[k], b = townBuilding(v.facade), d = b.door!;
    const door = d.side === 'S' ? { x: v.x + d.i, y: v.y + b.h } : { x: v.x + b.w, y: v.y + d.i };
    return { door, out: d.side === 'S' ? { x: door.x, y: door.y + 1 } : { x: door.x + 1, y: door.y } };
}

export function buildSolmarVilla(): WorldMap {
    const N = VILLA_N, t = new TownMap(N, 20251030, GRASS[0]);
    const { rnd, pick, w } = t;
    const isWater = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    // ---------- 1) suelo base: pasto adentro, bosque afuera de la muralla, costa al sur ----------
    const coast = (x: number) => 101 + Math.round(noise2(x, 0, 7, 9) * 3);
    t.rect(0, 0, N - 1, N - 1, (x, y) => {
        const outside = x < 10 || y < 10 || x > 116;
        t.tile(x, y, outside && noise2(x, y, 3, 6) > 0.45 ? pick(FOREST) : pick(GRASS));
        if (y >= 97) t.tile(x, y, pick(SAND));
        if (y >= coast(x)) {
            isWater[y][x] = true; t.block(x, y);
            const depth = y - coast(x);
            t.tile(x, y, depth < 2 ? pick(WATER_SHALLOW) : depth < 9 ? pick(WATER) : pick(WATER_DEEP));
        }
    });
    // ---------- 2) calles, plaza y paseo (reservadas) ----------
    const street = (x0: number, y0: number, x1: number, y1: number, tiles = COBBLE) => { t.rect(x0, y0, x1, y1, (x, y) => { t.tile(x, y, pick(tiles)); t.keep[y][x] = true; }); };
    street(46, 38, 74, 65, PLAZA); // plaza mayor
    t.rect(52, 44, 68, 60, (x, y) => { const d = Math.max(Math.abs(x - 60), Math.abs(y - 52)); if (d === 8 || d === 5) t.tile(x, y, pick(PLAZA_RING)); });
    street(58, 11, 61, 37); // avenida norte (al portón norte, cerrado)
    street(11, 51, 45, 53); // avenida oeste
    street(75, 51, 115, 53); // avenida del Sol (al portón este)
    street(58, 66, 61, 92); // calle de la Marea (al puerto)
    street(11, 24, 115, 25); // calle norte
    street(11, 77, 115, 78); // calle sur
    street(31, 11, 32, 92); // calle oeste
    street(86, 54, 88, 92); // calle del cuartel
    street(102, 26, 103, 50); // calle de la torre
    street(11, 93, 115, 96, PROMENADE); // paseo marítimo
    street(116, 51, 126, 53); // camino del portón este
    // ---------- 3) muralla con torres y portón ----------
    const WALL_D = -0.6;
    for (let x = 10; x <= 116; x++) { t.block(x, 10); if (x >= 11 && x <= 115) t.prop(townWall('piedra', 'liso', '\\'), x, 11, false, x + 11 + WALL_D); }
    for (let y = 10; y <= 92; y++) { t.block(10, y); if (y >= 11) t.prop(townWall('piedra', 'liso', '/'), 11, y, false, 11 + y + WALL_D); }
    for (let y = 10; y <= 92; y++) { if (y >= 51 && y <= 53) continue; t.block(116, y); if (y >= 11) t.prop(townWall('piedra', 'liso', '/'), 116, y, false, 116 + y + WALL_D); }
    // las torres pisan la muralla: se libera la huella antes de ponerlas
    const tower = (x: number, y: number) => { t.rect(x, y, x + 2, y + 2, (cx, cy) => { t.block(cx, cy, false); }); w.props = w.props.filter((p) => !(p.x >= x && p.x < x + 3.5 && p.y >= y && p.y < y + 3.5)); t.building('sm_torre_muralla', x, y); };
    tower(9, 9); tower(115, 9); tower(9, 90); tower(115, 90); tower(115, 47); tower(115, 54); tower(57, 8);
    t.keep[51][116] = t.keep[52][116] = t.keep[53][116] = true;
    // ---------- 4) edificios con interior ----------
    for (const [k, b] of Object.entries(VILLA_BUILDINGS) as [VillaBuilding, (typeof VILLA_BUILDINGS)[VillaBuilding]][]) {
        const d = t.building(b.facade, b.x, b.y)!;
        void k;
        // camino de entrada: de la puerta a la calle más cercana
        t.tile(d.door.x, d.door.y, pick(PROMENADE)); t.tile(d.out.x, d.out.y, pick(COBBLE));
    }
    // veredas que unen las puertas sueltas con la calle
    street(98, 41, 103, 42); street(44, 41, 45, 46); street(44, 56, 45, 62); street(87, 57, 88, 61);
    // ---------- 5) casas sin interior ----------
    const houses: [string, number, number][] = [
        ['sm_casa_a', 13, 13], ['sm_casa_c', 19, 13], ['sm_casa_b', 26, 13], ['sm_casa_d', 34, 14], ['sm_casa_e', 40, 13], ['sm_casa_a', 47, 13],
        ['sm_casa_b', 63, 13], ['sm_casa_c', 69, 13], ['sm_casa_e', 77, 12], ['sm_almacen', 84, 13], ['sm_casa_d', 92, 14], ['sm_casa_a', 98, 13], ['sm_casa_c', 105, 13],
        ['sm_casa_e', 13, 28], ['sm_almacen', 20, 28], ['sm_casa_d', 13, 40], ['sm_casa_a', 19, 41], ['sm_casa_b', 26, 40], ['sm_casa_c', 34, 30],
        ['sm_casa_d', 74, 28], ['sm_casa_c', 80, 28], ['sm_casa_a', 88, 28], ['sm_casa_b', 95, 27],
        ['sm_casa_e', 33, 56], ['sm_casa_d', 34, 66], ['sm_casa_a', 39, 70], ['sm_casa_c', 13, 80], ['sm_casa_b', 21, 80], ['sm_casa_e', 25, 86], ['sm_almacen', 34, 82], ['sm_casa_d', 41, 81],
        ['sm_casa_c', 47, 68], ['sm_casa_a', 64, 68], ['sm_casa_d', 48, 81], ['sm_casa_e', 66, 81], ['sm_casa_b', 53, 84],
        ['sm_casa_a', 90, 56], ['sm_casa_b', 97, 56], ['sm_casa_d', 103, 57], ['sm_almacen', 90, 80], ['sm_casa_c', 98, 80], ['sm_casa_e', 106, 81], ['sm_casa_a', 108, 63],
        ['sm_almacen', 72, 81], ['sm_casa_c', 105, 43], ['sm_casa_d', 109, 28],
    ];
    for (const [id, x, y] of houses) { const d = t.building(id, x, y); if (d) { t.tile(d.door.x, d.door.y, pick(PROMENADE)); } }
    // ---------- 6) puerto: muelles de tablones, botes, bolardos, cajas; escollera con el faro ----------
    const pier = (x0: number, y0: number, x1: number, y1: number) => t.rect(x0, y0, x1, y1, (x, y) => { t.tile(x, y, pick(PLANKS)); t.block(x, y, false); isWater[y][x] = false; t.keep[y][x] = false; });
    pier(58, 97, 61, 118); pier(52, 114, 67, 117); pier(28, 98, 29, 111); pier(26, 108, 33, 110); pier(90, 98, 91, 110);
    // escollera de roca hasta el faro
    t.rect(103, 99, 105, 116, (x, y) => { t.tile(x, y, pick([1237])); t.block(x, y, false); isWater[y][x] = false; });
    t.rect(102, 114, 106, 119, (x, y) => { t.tile(x, y, pick([1237])); t.block(x, y, false); isWater[y][x] = false; });
    t.building('sm_faro', 103, 115);
    // balaustrada del paseo con bajadas a la playa
    const DOWN = [20, 21, 45, 46, 59, 60, 74, 75, 98, 99];
    for (let x = 11; x <= 115; x++) { if (DOWN.includes(x)) continue; t.prop(townCoping('balaustrada', '\\'), x, 97, false, x + 97 - 0.45); }
    for (const x of DOWN) if (x % 2 === 0 || x === 45 || x === 99) t.prop(townStairs('piedra', '/'), x, 96, false, x + 96 - 0.3);
    // bolardos y cajas en los muelles
    for (const y of [100, 104, 108, 112]) { t.prop(TOWN_PROPS.poste, 58, y); t.prop(TOWN_PROPS.poste, 61, y); }
    for (const x of [53, 57, 62, 66]) t.prop(TOWN_PROPS.poste, x, 117);
    t.prop(TOWN_PROPS.poste, 28, 101); t.prop(TOWN_PROPS.poste, 29, 105); t.prop(TOWN_PROPS.poste, 91, 102); t.prop(TOWN_PROPS.poste, 90, 107);
    for (const [x, y] of [[52, 114], [53, 114], [52, 115], [66, 114], [67, 115], [26, 108], [27, 108], [33, 110]] as const) t.prop(pick(CRATES_WOOD), x, y);
    for (const [x, y] of [[67, 114], [26, 109], [91, 109]] as const) t.prop(kenney(pick(['barrel', 'barrels']), 'S'), x, y);
    // botes amarrados (sobre el agua, que ya es sólida)
    for (const [id, x, y] of [[TOWN_PROPS.bote, 56, 105], [TOWN_PROPS.bote2, 63, 109], [TOWN_PROPS.bote, 64, 101], [TOWN_PROPS.bote2, 31, 104], [TOWN_PROPS.bote, 93, 103], [TOWN_PROPS.bote2, 50, 119], [TOWN_PROPS.bote, 70, 112]] as const) w.props.push({ id, x: x + 0.5, y: y + 0.5 });
    // playa: rocas y redes (cajas) sueltas
    for (let x = 12; x <= 114; x++) for (let y = 97; y < coast(x); y++) if (!t.keep[y][x] && !w.blocked[y][x] && t.w.tiles[y][x] !== PLANKS[0] && t.w.tiles[y][x] !== PLANKS[1] && rnd() < 0.025) t.prop(pick([128, 129, 130, 131]), x, y);
    // espuma: lado del rombo de agua que da a tierra (o a un muelle)
    t.rect(1, 90, N - 2, N - 2, (x, y) => {
        if (!isWater[y][x]) return;
        if (!isWater[y - 1][x]) t.decal(FOAM.ne, x, y);
        if (!isWater[y][x - 1]) t.decal(FOAM.nw, x, y);
        if (!isWater[y][x + 1]) t.decal(FOAM.se, x, y);
        if (!isWater[y + 1]?.[x]) t.decal(FOAM.sw, x, y);
    });
    // ---------- 7) plaza: portal (lo dibuja el cliente), maceteros con árboles, banderas y faroles ----------
    t.reserve(57, 49, 63, 55); // el portal y su entorno
    const planter = (x: number, y: number) => {
        t.prop(pick(LEAFY), x, y);
        t.prop(townCoping('murete', '\\'), x, y, false, x + y - 0.6); t.prop(townCoping('murete', '/'), x, y, false, x + y - 0.6);
        t.prop(townCoping('murete', '\\'), x, y + 1, false, x + y + 0.6); t.prop(townCoping('murete', '/'), x + 1, y, false, x + y + 0.6);
        t.tile(x, y, pick(GRASS));
    };
    for (const [x, y] of [[49, 41], [71, 41], [49, 63], [71, 63], [49, 52], [71, 52]] as const) { t.keep[y][x] = false; planter(x, y); }
    for (const [x, y] of [[52, 44], [68, 44], [52, 60], [68, 60]] as const) { t.keep[y][x] = false; t.prop(TOWN_PROPS.bandera, x, y); }
    for (const [x, y] of [[56, 40], [64, 40], [56, 64], [64, 64], [47, 47], [47, 57], [73, 47], [73, 57]] as const) { t.keep[y][x] = false; t.prop(TOWN_PROPS.farol, x, y); }
    // ---------- 8) faroles a lo largo de las calles (en el borde, sin cortar el paso) ----------
    const lampAt = (x: number, y: number) => { if (t.in(x, y) && !w.blocked[y][x] && !t.keep[y][x]) t.prop(TOWN_PROPS.farol, x, y); };
    for (let x = 14; x <= 112; x += 9) { lampAt(x, 50); lampAt(x + 4, 54); lampAt(x, 23); lampAt(x + 4, 79); }
    for (let y = 14; y <= 90; y += 9) { lampAt(57, y); lampAt(62, y + 4); lampAt(30, y); lampAt(33, y + 4); }
    for (let x = 14; x <= 112; x += 8) if (!DOWN.includes(x)) lampAt(x, 92);
    // ---------- 9) mercado (suroeste de la plaza): tiendas de lona, cajas, cofres ----------
    street(12, 56, 29, 75, [1238, 1238, 1218]);
    for (const [x, y] of [[14, 58], [19, 58], [24, 58], [14, 64], [19, 64], [24, 64], [14, 70], [19, 70], [24, 70]] as const) {
        t.keep[y][x] = false; t.prop(pick(MARKET_TENTS), x, y);
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) { t.keep[y + dy][x + dx] = false; t.prop(rnd() < 0.5 ? pick(CRATES_WOOD) : pick([76, 77, 96, 97, 98, 99, 100, 101]), x + dx, y + dy); }
        t.keep[y + 1][x + 1] = false;
        if (rnd() < 0.5) t.prop(kenney(pick(['barrel', 'barrels', 'barrelsStacked']), 'S'), x + 1, y + 1);
    }
    // ---------- 10) patio de armas del cuartel ----------
    t.rect(75, 63, 85, 75, (x, y) => t.tile(x, y, pick([1009, 1013, 1001])));
    for (let x = 75; x <= 85; x++) { t.prop(107, x, 63); t.prop(107, x, 75); }
    for (let y = 64; y <= 74; y++) { t.prop(104, 75, y); if (y !== 69 && y !== 70) t.prop(104, 85, y); }
    for (const [id, x, y] of [[132, 78, 66], [133, 81, 66], [134, 78, 71], [135, 81, 71], [137, 83, 73]] as const) t.prop(id, x, y);
    t.prop(pick(CRATES_METAL), 77, 73); t.prop(pick(CRATES_METAL), 76, 74);
    t.rect(86, 69, 86, 70, (x, y) => t.tile(x, y, pick(COBBLE)));
    // ---------- 11) jardines: árboles, flores, setos de murete; bosque afuera de la muralla ----------
    t.rect(1, 1, N - 2, N - 2, (x, y) => {
        if (w.blocked[y][x] || t.keep[y][x] || y >= 93) return;
        const tl = w.tiles[y][x]; if (!(tl >= 16 && tl <= 31) && !FOREST.includes(tl)) return;
        const outside = x < 10 || y < 10 || x > 116;
        if (outside) {
            if (x > 116 && y >= 49 && y <= 55) return; // el camino del portón
            const r = rnd(); if (r < 0.16) t.prop(pick(r < 0.08 ? PINES : LEAFY), x, y); else if (r < 0.24) t.prop(pick(FLOWERS), x, y, false); else if (r < 0.27) t.prop(pick([128, 129, 130, 131]), x, y);
            return;
        }
        // adentro: árboles junto a las casas y en los patios, flores en el pasto
        const near = (dx: number, dy: number) => w.blocked[y + dy]?.[x + dx];
        const r = rnd();
        if (r < 0.06 && !near(1, 0) && !near(0, 1) && !near(-1, 0) && !near(0, -1)) t.prop(pick(LEAFY), x, y);
        else if (r < 0.2) t.prop(pick(FLOWERS), x, y, false);
    });
    // ---------- 12) NPCs de la calle (guardias) ----------
    t.npc('guardia_s1', 'Guardia del Portón', 114, 50, 4);
    t.npc('guardia_s2', 'Guardia del Portón', 114, 54, 4);
    t.npc('guardia_s3', 'Guardia de la Plaza', 66, 47, 6);
    t.npc('guardia_s4', 'Guardia del Puerto', 62, 95, 2);
    t.npc('guardia_s5', 'Vigía del Faro', 104, 113, 2);
    // ---------- 13) zona segura, portal y vínculos ----------
    w.safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(true));
    w.spawn = { ...VILLA.spawn }; w.fire = { x: VILLA.portal.x, y: VILLA.portal.y };
    w.hubs = { solmar: { ...VILLA.spawn } };
    w.cities = [{ faction: 'solmar', name: 'Villa de Solmar', x0: 0, y0: 0, x1: N - 1, y1: N - 1 }];
    w.waypoints = [{ id: 'city:solmar', x: VILLA.portal.x, y: VILLA.portal.y, kind: 'city', name: 'Portal de Frontera', faction: 'solmar' }];
    for (const c of [VILLA.spawn, VILLA.portal, VILLA.toLegacy, VILLA.fromLegacy]) { t.block(c.x, c.y, false); }
    t.block(N - 1, 52, true);
    return w;
}
