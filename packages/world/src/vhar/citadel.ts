/**
 * Ciudadela de Vhar (Fase 2 de docs/MUNDO.md): la segunda ciudad, hogar de la facción Vhar. Es la opuesta a la Villa de Solmar:
 * en vez de una villa abierta sobre el mar, una fortaleza cuadrada de 128x128 en tierra volcánica, con una muralla de piedra negra
 * y torres rodeada por un foso de lava, calles de adoquín oscuro, una plaza de placas de hierro con el Portal de Frontera,
 * fraguas, hornos y un pozo de fundición. La única salida es el portón del sur, con un puente sobre el foso, que sigue por el
 * camino de ceniza hasta las tierras de caza del mapa viejo.
 *
 * Los edificios con interior (Casa de Concejo, Santuario de Ceniza, Forja de Hierro, Bazar del Yunque, Orfebrería, Cámara Fuerte,
 * Torre de las Brasas y Cuartel de Hierro) tienen la puerta en la cara sur o este (las que se ven) y un vínculo `enter`.
 *
 * Arte: kit CC0 de Screaming Brain Studios (town.webp: paredes oscuras, pisos de ceniza, adoquín y lava; ver tools/src/town/atlas.ts)
 * y objetos de Flare (CC-BY-SA, world.webp) para árboles secos y postes de práctica.
 */
import type { WorldMap } from '../index';
import { CRATES_METAL, TOWN_PROPS, townBuilding, townWall, townWallLow, vharTiles, type WallStyle } from '../town';
import { TownMap, type Cell } from '../solmar/kit';

export const VHAR_CITADEL_ID = 'vhar_ciudadela';
export const VHAR_N = 128;
/** Edificios con interior: id del mapa interior, fachada y esquina norte en la ciudadela. */
export const VHAR_BUILDINGS = {
    ayuntamiento: { map: 'vhar_concejo', facade: 'vh_concejo', x: 58, y: 36 },
    templo: { map: 'vhar_santuario', facade: 'vh_santuario', x: 35, y: 52 },
    joyeria: { map: 'vhar_orfebreria', facade: 'vh_orfebreria', x: 38, y: 40 },
    tienda: { map: 'vhar_bazar', facade: 'vh_bazar', x: 52, y: 82 },
    herreria: { map: 'vhar_forja', facade: 'vh_forja', x: 82, y: 89 },
    deposito: { map: 'vhar_camara', facade: 'vh_camara', x: 36, y: 73 },
    cuartel: { map: 'vhar_cuartel', facade: 'vh_cuartel', x: 84, y: 36 },
    torre: { map: 'vhar_torre', facade: 'vh_torre', x: 100, y: 26 },
} as const;
export type VharBuilding = keyof typeof VHAR_BUILDINGS;

export const VHAR = {
    /** Aparición de personajes nuevos y destino del Portal de Frontera ("volver a la ciudad"): al sur del portal de la plaza. */
    spawn: { x: 63, y: 67 },
    portal: { x: 63, y: 62 },
    /** Camino al mapa viejo (afuera del portón sur, sobre el camino de ceniza) y llegada desde allá. */
    toLegacy: { x: 63, y: 125 }, fromLegacy: { x: 63, y: 122 },
};

const ASH = vharTiles('ceniza'), ROCK = vharTiles('roca'), COBBLE = vharTiles('adoquin'), PLATE = vharTiles('placa'), RUNE = vharTiles('runa');
const LAVA = vharTiles('lava'), CRUST = vharTiles('costra'), BRICK = vharTiles('ladrillo');
const DEAD = [244, 245, 246, 247];
const WALL: WallStyle = 'basalto';

/** Puerta de un edificio con interior: la celda de la puerta (disparadora) y la de llegada al salir (un paso hacia la calle). */
export function vharDoor(k: VharBuilding): { door: Cell; out: Cell } {
    const v = VHAR_BUILDINGS[k], b = townBuilding(v.facade), d = b.door!;
    const door = d.side === 'S' ? { x: v.x + d.i, y: v.y + b.h } : { x: v.x + b.w, y: v.y + d.i };
    return { door, out: d.side === 'S' ? { x: door.x, y: door.y + 1 } : { x: door.x + 1, y: door.y } };
}

/** Calles: columnas y filas de 2 a 4 celdas de ancho entre la ronda de la muralla (17..110). */
const V_STREETS: [number, number][] = [[30, 31], [45, 47], [62, 65], [80, 81], [97, 98]];
const H_STREETS: [number, number][] = [[31, 32], [47, 48], [62, 65], [79, 80], [95, 96]];
const IN0 = 17, IN1 = 110;

export function buildVharCiudadela(): WorldMap {
    const N = VHAR_N, t = new TownMap(N, 20251031, ASH[0]);
    const { rnd, pick, w } = t;
    const occ = Array.from({ length: N }, () => new Array<boolean>(N).fill(false)); // celdas de edificios (para dejar callejones)
    const lava = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const WL = 14, WR = 113, WB = 113; // muralla: filas/columnas bloqueadas
    // ---------- 1) suelo base: ceniza y roca; foso de lava alrededor de la muralla ----------
    t.rect(0, 0, N - 1, N - 1, (x, y) => { t.tile(x, y, rnd() < 0.22 ? pick(ROCK) : pick(ASH)); });
    const inMoat = (x: number, y: number) => { const d = Math.max(Math.abs(x - 63.5), Math.abs(y - 63.5)); return d > 50 && d < 55.5; }; // anillo 51..55 desde el centro
    t.rect(1, 1, N - 2, N - 2, (x, y) => {
        if (!inMoat(x, y)) return;
        lava[y][x] = true; t.block(x, y);
        const edge = !inMoat(x - 1, y) || !inMoat(x + 1, y) || !inMoat(x, y - 1) || !inMoat(x, y + 1);
        t.tile(x, y, edge && rnd() < 0.7 ? pick(CRUST) : pick(LAVA));
    });
    // ---------- 2) calles, plaza y rondas (reservadas) ----------
    const street = (x0: number, y0: number, x1: number, y1: number, tiles = COBBLE) => { t.rect(x0, y0, x1, y1, (x, y) => { t.tile(x, y, pick(tiles)); t.keep[y][x] = true; }); };
    for (const [a, b] of H_STREETS) street(IN0, a, IN1, b);
    for (const [a, b] of V_STREETS) street(a, IN0, b, IN1);
    // Via Real: el Concejo corta la calle central al norte
    t.rect(62, 36, 65, 43, (x, y) => { t.keep[y][x] = false; });
    street(62, 33, 65, 35); // plazoleta norte (cierra la calle)
    // plaza de hierro
    street(50, 50, 77, 77, [PLATE[0], PLATE[0], PLATE[0], PLATE[0], PLATE[1]]);
    t.rect(50, 50, 77, 77, (x, y) => {
        const d = Math.max(Math.abs(x - 63.5), Math.abs(y - 63.5));
        if (d > 11 && d < 13) t.tile(x, y, pick(COBBLE));
        if (d > 7 && d < 9 && (x === 63 || x === 64 || y === 63 || y === 64)) t.tile(x, y, pick(COBBLE));
    });
    for (const [x, y] of [[56, 56], [71, 56], [56, 71], [71, 71]] as const) t.tile(x, y, RUNE[0]);
    street(62, 111, 65, 113); // portón (abre la calle central en la muralla)
    // ---------- 3) muralla: N y O de piedra alta, S y E más baja (para no tapar a los jugadores), puente y camino de ceniza ----------
    const D = -0.6;
    for (let x = WL; x <= WR; x++) { t.block(x, WL); if (x > WL) t.tile(x, WL, pick(ROCK)); }
    for (let y = WL; y <= WB; y++) t.block(WL, y);
    for (let x = WL; x <= WR; x++) if (!(x >= 62 && x <= 65)) t.block(x, WB);
    for (let y = WL; y <= WB; y++) t.block(WR, y);
    for (let x = WL + 1; x <= WR - 1; x++) t.prop(townWall(WALL, x % 4 === 1 ? 'ventana' : 'liso', '\\'), x, WL + 1, false, x + WL + 1 + D);
    for (let y = WL + 1; y <= WB - 1; y++) t.prop(townWall(WALL, y % 4 === 1 ? 'ventana' : 'liso', '/'), WL + 1, y, false, WL + 1 + y + D);
    for (let x = WL + 1; x <= WR - 1; x++) if (!(x >= 62 && x <= 65)) t.prop(townWallLow(WALL, '\\'), x, WB, false, x + WB - D);
    for (let y = WL + 1; y <= WB - 1; y++) t.prop(townWallLow(WALL, '/'), WR, y, false, WR + y - D);
    // rondas de la muralla sur y este: libres de paso (decoradas más abajo), así la muralla no tapa a nadie
    for (let x = WL + 1; x <= WR - 1; x++) for (const y of [111, 112]) if (!t.keep[y][x]) t.block(x, y);
    for (let y = WL + 1; y <= WB - 1; y++) for (const x of [111, 112]) if (!t.keep[y][x]) t.block(x, y);
    // torres: se libera la huella (muralla, foso) y se pone el edificio sobre un piso de placas
    const tower = (id: string, x: number, y: number) => {
        const b = townBuilding(id);
        t.rect(x, y, x + b.w - 1, y + b.h - 1, (cx, cy) => { t.block(cx, cy, false); t.keep[cy][cx] = false; lava[cy][cx] = false; t.tile(cx, cy, pick(PLATE)); });
        w.props = w.props.filter((p) => !(p.x >= x && p.x < x + b.w + 0.01 && p.y >= y && p.y < y + b.h + 0.01));
        t.building(id, x, y);
        t.rect(x, y, x + b.w - 1, y + b.h - 1, (cx, cy) => { occ[cy][cx] = true; });
    };
    for (const [x, y] of [[11, 11], [110, 11], [11, 110], [110, 110]] as const) tower('vh_torreon', x, y);
    tower('vh_torreon', 56, 109); tower('vh_torreon', 66, 109); // portón del sur
    for (const p of [28, 45, 80, 96]) { tower('vh_torre_muralla', p, 12); tower('vh_torre_muralla', 12, p); tower('vh_torre_muralla', p, 111); tower('vh_torre_muralla', 111, p); }
    tower('vh_torreon', 58, 10); tower('vh_torreon', 64, 10); // puerta norte sellada: dos torreones juntos
    // puente sobre el foso y camino de ceniza hasta el borde
    t.rect(62, 113, 65, 118, (x, y) => { lava[y][x] = false; t.block(x, y, false); t.tile(x, y, PLATE[0]); t.keep[y][x] = true; });
    t.rect(61, 119, 66, 126, (x, y) => { t.block(x, y, false); t.tile(x, y, pick(COBBLE)); t.keep[y][x] = true; });
    t.rect(62, 119, 65, 126, (x, y) => { t.keep[y][x] = true; });
    for (let y = 114; y <= 118; y++) { t.prop(TOWN_PROPS.brasero, 61, y, y % 2 === 0, 61 + y + 0.3); t.prop(TOWN_PROPS.brasero, 66, y, y % 2 === 0, 66 + y + 0.3); }
    // ---------- 4) edificios con interior ----------
    for (const b of Object.values(VHAR_BUILDINGS)) {
        const bb = townBuilding(b.facade);
        t.rect(b.x, b.y, b.x + bb.w - 1, b.y + bb.h - 1, (x, y) => { occ[y][x] = true; });
        const d = t.building(b.facade, b.x, b.y)!;
        t.tile(d.door.x, d.door.y, pick(COBBLE)); t.tile(d.out.x, d.out.y, pick(COBBLE));
    }
    // ---------- 6) pozo de fundición (lava con pinchos), patio de armas y patio de la forja ----------
    t.rect(100, 100, 105, 105, (x, y) => { t.keep[y][x] = false; t.block(x, y, true); t.tile(x, y, pick(LAVA)); lava[y][x] = true; });
    t.rect(99, 99, 106, 106, (x, y) => { if (!lava[y][x]) t.tile(x, y, pick(CRUST)); });
    for (let x = 99; x <= 106; x++) for (const y of [98, 107]) t.prop(TOWN_PROPS.pinchos, x, y, true);
    for (let y = 99; y <= 106; y++) for (const x of [99, 106]) t.prop(TOWN_PROPS.pinchos, x, y, true);
    t.rect(95, 97, 108, 109, (x, y) => { occ[y][x] = true; });
    t.rect(100, 36, 110, 52, (x, y) => { occ[y][x] = true; });
    t.rect(100, 36, 110, 52, (x, y) => { if (!t.keep[y][x] && !occ[y][x]) { t.tile(x, y, pick(BRICK)); } });
    for (const [id, x, y] of [[132, 102, 38], [133, 105, 38], [134, 102, 43], [135, 105, 43], [137, 108, 41], [132, 103, 49], [133, 107, 49]] as const) t.prop(id, x, y);
    t.prop(TOWN_PROPS.perchero, 109, 37); t.prop(TOWN_PROPS.perchero, 109, 50); t.prop(TOWN_PROPS.perchero, 101, 52);
    for (const [x, y] of [[100, 45], [110, 45]] as const) t.prop(TOWN_PROPS.brasero, x, y);
    // ---------- 5) casas y talleres (sin interior) a lo largo de las calles ----------
    const tryPlace = (id: string, x: number, y: number): boolean => {
        const b = townBuilding(id);
        if (x < IN0 || y < IN0 || x + b.w - 1 > IN1 || y + b.h - 1 > IN1) return false;
        for (let cy = y - 1; cy <= y + b.h; cy++) for (let cx = x - 1; cx <= x + b.w; cx++) {
            if (!t.in(cx, cy)) return false;
            const inside = cx >= x && cx < x + b.w && cy >= y && cy < y + b.h;
            if (inside && (t.keep[cy][cx] || w.blocked[cy][cx] || occ[cy][cx])) return false;
            if (!inside && occ[cy][cx] && (cx < x || cy < y)) return false; // callejón de 1 celda al oeste y al norte
        }
        try { t.building(id, x, y); } catch { return false; }
        t.rect(x, y, x + b.w - 1, y + b.h - 1, (cx, cy) => { occ[cy][cx] = true; });
        return true;
    };
    const S_DOOR = ['vh_casa_a', 'vh_casa_c', 'vh_casa_e', 'vh_barracon', 'vh_almacen', 'vh_casa_a', 'vh_casa_c', 'vh_hornos'];
    const E_DOOR = ['vh_casa_b', 'vh_casa_d', 'vh_casa_b', 'vh_casa_d'];
    for (const [top] of H_STREETS) for (let x = IN0; x <= IN1;) {
        let placed = false;
        for (let k = 0; k < 8 && !placed; k++) { const id = pick(S_DOOR), b = townBuilding(id); if (tryPlace(id, x, top - b.h)) { x += b.w + 1; placed = true; } }
        if (!placed) x++;
    }
    for (const [left] of V_STREETS) for (let y = IN0; y <= IN1;) {
        let placed = false;
        for (let k = 0; k < 6 && !placed; k++) { const id = pick(E_DOOR), b = townBuilding(id); if (tryPlace(id, left - b.w, y)) { y += b.h + 1; placed = true; } }
        if (!placed) y++;
    }
    for (const b of w.buildings) { const bb = townBuilding(b.id); if (bb.door) { const S = bb.door.side === 'S'; const dx = S ? b.x + bb.door.i : b.x + b.w, dy = S ? b.y + b.h : b.y + bb.door.i; t.tile(dx, dy, pick(COBBLE)); } }
    // ---------- 7) plaza: monolitos, braseros, estandartes y la gran fragua ----------
    t.reserve(59, 58, 67, 65);
    for (const [x, y] of [[53, 53], [74, 53], [53, 74], [74, 74]] as const) { t.keep[y][x] = false; t.prop(TOWN_PROPS.monolito, x, y); }
    for (const [x, y] of [[57, 52], [70, 52], [57, 75], [70, 75], [52, 58], [52, 69], [75, 58], [75, 69]] as const) { t.keep[y][x] = false; t.prop(TOWN_PROPS.estandarte, x, y); }
    for (const [x, y] of [[60, 53], [67, 53], [60, 74], [67, 74], [54, 60], [54, 67], [73, 60], [73, 67], [58, 57], [69, 57]] as const) { t.keep[y][x] = false; t.prop(TOWN_PROPS.brasero, x, y); }
    t.keep[72][63] = false; t.prop(102, 63, 72); w.fire = { x: 63, y: 72 };
    for (const [x, y] of [[61, 72], [65, 72]] as const) { t.keep[y][x] = false; t.prop(TOWN_PROPS.yunque, x, y); }
    t.keep[54][63] = false; t.keep[54][64] = false; t.prop(TOWN_PROPS.lingotes, 62, 54); t.prop(TOWN_PROPS.lingotes, 65, 54);
    // ---------- 8) braseros en las calles y frentes de la ronda ----------
    const lampAt = (x: number, y: number) => { if (t.in(x, y) && !w.blocked[y][x] && !t.keep[y][x] && !occ[y][x]) t.prop(TOWN_PROPS.brasero, x, y); };
    for (const [a, b] of H_STREETS) for (let x = IN0 + 2; x <= IN1; x += 9) { lampAt(x, a - 1); lampAt(x + 4, b + 1); }
    for (const [a, b] of V_STREETS) for (let y = IN0 + 3; y <= IN1; y += 9) { lampAt(a - 1, y); lampAt(b + 1, y + 4); }
    // ronda: pinchos, cajas de hierro y rocas contra la muralla (S y E), estandartes cada tanto
    for (let x = 17; x <= 110; x++) for (const y of [111, 112]) if (w.blocked[y][x] && !occ[y][x] && !lava[y][x]) { t.tile(x, y, pick(ROCK)); const r = rnd(); if (r < 0.2) t.prop(TOWN_PROPS.pinchos, x, y, false); else if (r < 0.3) t.prop(pick(CRATES_METAL), x, y, false); }
    for (let y = 17; y <= 110; y++) for (const x of [111, 112]) if (w.blocked[y][x] && !occ[y][x] && !lava[y][x]) { t.tile(x, y, pick(ROCK)); const r = rnd(); if (r < 0.2) t.prop(TOWN_PROPS.pinchos, x, y, false); else if (r < 0.3) t.prop(pick(CRATES_METAL), x, y, false); }
    for (let x = 22; x <= 106; x += 12) if (!(x > 54 && x < 74)) t.prop(TOWN_PROPS.estandarte, x, 112, false, x + 112 + 0.3);
    for (let y = 22; y <= 106; y += 12) t.prop(TOWN_PROPS.estandarte, 112, y, false, 112 + y + 0.3);
    // ---------- 9) relleno de los patios: cajas, rocas, árboles secos, hornos de brasas ----------
    t.rect(IN0, IN0, IN1, IN1, (x, y) => {
        if (w.blocked[y][x] || t.keep[y][x] || occ[y][x]) return;
        if (w.tiles[y][x] >= 3096 && w.tiles[y][x] <= 3107) return;
        const r = rnd();
        if (r < 0.025) t.prop(pick(DEAD), x, y); else if (r < 0.06) t.prop(pick(CRATES_METAL), x, y); else if (r < 0.08) t.prop(rnd() < 0.5 ? TOWN_PROPS.roca : TOWN_PROPS.roca2, x, y);
        else if (r < 0.1) t.prop(TOWN_PROPS.lingotes, x, y); else if (r < 0.11) t.prop(TOWN_PROPS.brasero, x, y);
    });
    // ---------- 10) afuera: el páramo de ceniza, con rocas, obsidiana, árboles secos y vetas de lava ----------
    t.rect(1, 1, N - 2, N - 2, (x, y) => {
        const d = Math.max(Math.abs(x - 63.5), Math.abs(y - 63.5)); if (d < 55.5 || w.blocked[y][x] || t.keep[y][x]) return;
        const r = rnd();
        if (r < 0.05) t.prop(pick(DEAD), x, y); else if (r < 0.09) t.prop(rnd() < 0.5 ? TOWN_PROPS.roca : TOWN_PROPS.roca2, x, y); else if (r < 0.105) t.prop(TOWN_PROPS.obsidiana, x, y);
        else if (r < 0.125) { t.tile(x, y, pick(CRUST)); }
    });
    // ---------- 11) NPCs de la calle (guardias) ----------
    t.npc('guardia_v1', 'Guardia del Portón', 60, 111, 6);
    t.npc('guardia_v2', 'Guardia del Portón', 67, 111, 2);
    t.npc('guardia_v3', 'Guardia de la Plaza', 67, 60, 6);
    t.npc('guardia_v4', 'Guardia de la Fragua', 79, 88, 2);
    t.npc('guardia_v5', 'Centinela del Foso', 99, 97, 4);
    // ---------- 12) zona segura, portal y vínculos ----------
    w.safe = Array.from({ length: N }, () => new Array<boolean>(N).fill(true));
    w.spawn = { ...VHAR.spawn };
    w.hubs = { vhar: { ...VHAR.spawn } };
    w.cities = [{ faction: 'vhar', name: 'Ciudadela de Vhar', x0: 0, y0: 0, x1: N - 1, y1: N - 1 }];
    w.waypoints = [{ id: 'city:vhar', x: VHAR.portal.x, y: VHAR.portal.y, kind: 'city', name: 'Portal de Frontera', faction: 'vhar' }];
    for (const c of [VHAR.spawn, VHAR.portal, VHAR.toLegacy, VHAR.fromLegacy]) { t.block(c.x, c.y, false); }
    w.props = w.props.filter((p) => !(Math.floor(p.x) === VHAR.portal.x && Math.floor(p.y) === VHAR.portal.y) && !(Math.floor(p.x) === VHAR.spawn.x && Math.floor(p.y) === VHAR.spawn.y));
    t.block(63, N - 1, true);
    return w;
}
