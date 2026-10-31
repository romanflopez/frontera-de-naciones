/**
 * Mapas de prueba de la Fase 1 (docs/MUNDO.md): un claro de caza de 64x64 con mobs reales y una mazmorra de 48x48 con
 * respawn propio, unidos por una puerta con requisito de nivel, y los dos conectados con el mapa original por portales.
 * Se arman con semilla fija (determinista, igual en cliente y server) y con el arte que ya existe (tileset de pasto y Kenney).
 * Los vínculos y el resto de los datos del MapDef están en maps.ts; acá solo la geometría y las celdas que comparten.
 */
import type { WorldMap, Prop, Zone } from './index';
import { kenney, PATH, ROCKS } from './frontier';

const GRASS = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const STONE = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
const TREES = [248, 249, 250, 251, 252, 253, 254, 255, 240, 241];
const FLOWERS = [112, 113, 114, 115, 116, 117, 120, 121, 122, 123, 124, 125, 126, 127];

/** Claro de caza: celdas que comparten maps.ts y el builder. */
export const PRUEBA_CAZA = {
    id: 'prueba_caza', size: 64,
    /** Llegada desde Solmar (dentro del campamento seguro) y celda del portal de vuelta. */
    fromLegacy: { x: 6, y: 57 }, toLegacy: { x: 3, y: 57 },
    respawn: { x: 8, y: 59 }, fire: { x: 8, y: 55 },
    /** Puerta a la mazmorra y celda donde se aparece al subir. */
    door: { x: 57, y: 6 }, fromMazmorra: { x: 57, y: 9 },
};
/** Mazmorra de prueba. */
export const PRUEBA_MAZMORRA = {
    id: 'prueba_mazmorra', size: 48,
    fromCaza: { x: 5, y: 41 }, exit: { x: 5, y: 38 }, respawn: { x: 7, y: 41 }, shortcut: { x: 42, y: 8 },
};

const makeRnd = (seed0: number) => {
    let seed = seed0;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { rnd, pick: <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] };
};

export function buildPruebaCaza(): WorldMap {
    const N = PRUEBA_CAZA.size, C = PRUEBA_CAZA;
    const { rnd, pick } = makeRnd(5150);
    const tiles: number[][] = [], blocked: boolean[][] = [], safe: boolean[][] = [];
    const props: Prop[] = [];
    const camp = (x: number, y: number) => x >= 2 && x <= 11 && y >= 51 && y <= 61;
    for (let y = 0; y < N; y++) {
        tiles.push([]); blocked.push([]); safe.push([]);
        for (let x = 0; x < N; x++) {
            tiles[y].push(camp(x, y) ? pick(STONE) : pick(GRASS));
            blocked[y].push(x === 0 || y === 0 || x === N - 1 || y === N - 1);
            safe[y].push(camp(x, y));
        }
    }
    // camino de tierra del campamento a la puerta de la mazmorra
    const isPath: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const carve = (x0: number, y0: number, x1: number, y1: number) => {
        let x = x0, y = y0;
        while (x !== x1 || y !== y1) {
            if (!safe[y][x]) { tiles[y][x] = pick(PATH); isPath[y][x] = true; }
            if (x !== x1 && (rnd() < 0.6 || y === y1)) x += Math.sign(x1 - x); else y += Math.sign(y1 - y);
        }
    };
    carve(12, 56, 24, 44); carve(24, 44, 40, 30); carve(40, 30, 57, 10);
    // celdas que se dejan despejadas: portales, llegadas, respawn, fogata y el entorno de la puerta
    const keep: [number, number][] = [[C.fromLegacy.x, C.fromLegacy.y], [C.toLegacy.x, C.toLegacy.y], [C.respawn.x, C.respawn.y], [C.door.x, C.door.y], [C.fromMazmorra.x, C.fromMazmorra.y]];
    const keepNear = (x: number, y: number) => keep.some(([kx, ky]) => Math.abs(x - kx) <= 2 && Math.abs(y - ky) <= 2);
    for (let y = C.door.y - 1; y <= C.fromMazmorra.y + 1; y++) for (let x = C.door.x - 2; x <= C.door.x + 2; x++) { tiles[y][x] = pick(STONE); isPath[y][x] = true; }
    const prop = (id: number, x: number, y: number, block: boolean) => { props.push({ id, x: x + 0.5, y: y + 0.5 }); if (block) blocked[y][x] = true; };
    prop(102, C.fire.x, C.fire.y, true); // fogata
    prop(76, 4, 52, true); prop(77, 10, 52, true); prop(101, 10, 60, true);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
        if (blocked[y][x] || safe[y][x] || isPath[y][x] || keepNear(x, y)) continue;
        const r = rnd();
        if (r < 0.05) prop(pick(TREES), x, y, true);
        else if (r < 0.075) prop(pick(ROCKS), x, y, true);
        else if (r < 0.15) prop(pick(FLOWERS), x, y, false);
    }
    const zones: Zone[] = [
        { type: 'goblin', x: 24, y: 40, r: 4, n: 4, name: 'Claro de prueba: goblins' },
        { type: 'goblin_elite', x: 42, y: 28, r: 4, n: 3, name: 'Claro de prueba: avanzada' },
        { type: 'skeleton', x: 48, y: 14, r: 4, n: 3, name: 'Claro de prueba: huesos', lvl: 4 },
    ];
    return { size: N, tiles, blocked, safe, props, decals: [], zones, buildings: [], npcs: [], spawn: { ...C.fromLegacy }, fire: { ...C.fire } };
}

export function buildPruebaMazmorra(): WorldMap {
    const N = PRUEBA_MAZMORRA.size, C = PRUEBA_MAZMORRA;
    const { rnd, pick } = makeRnd(8088);
    const ORIS = ['N', 'E', 'S', 'W'] as const;
    const tiles: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(kenney('stone', 'S')));
    const blocked: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(true));
    const safe: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const props: Prop[] = [];
    type R = { x0: number; y0: number; x1: number; y1: number };
    const rooms: R[] = [{ x0: 3, y0: 36, x1: 11, y1: 44 }, { x0: 16, y0: 22, x1: 30, y1: 32 }, { x0: 34, y0: 6, x1: 44, y1: 16 }];
    const halls: R[] = [{ x0: 12, y0: 38, x1: 22, y1: 39 }, { x0: 21, y0: 33, x1: 22, y1: 37 }, { x0: 31, y0: 24, x1: 36, y1: 25 }, { x0: 35, y0: 17, x1: 36, y1: 23 }];
    const floor: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    for (const r of [...rooms, ...halls]) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) floor[y][x] = true;
    const prop = (id: number, x: number, y: number, block: boolean, d?: number) => { props.push(d === undefined ? { id, x: x + 0.5, y: y + 0.5 } : { id, x: x + 0.5, y: y + 0.5, d }); if (block) blocked[y][x] = true; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!floor[y][x]) continue;
        blocked[y][x] = false;
        const r = rnd();
        tiles[y][x] = kenney(r < 0.08 ? 'stoneTile' : r < 0.16 ? 'stoneUneven' : r < 0.2 ? 'stoneInset' : 'stone', pick(ORIS));
    }
    // el vestíbulo es zona segura: ahí aparecés al subir y al morir
    for (let y = rooms[0].y0; y <= rooms[0].y1; y++) for (let x = rooms[0].x0; x <= rooms[0].x1; x++) safe[y][x] = true;
    // paredes: una pieza por lado de cada celda de piso que da a la roca (mismo criterio que la Cripta olvidada)
    const wallName = () => { const r = rnd(); return r < 0.62 ? 'stoneWall' : r < 0.82 ? 'stoneWallAged' : r < 0.9 ? 'stoneWallWindow' : r < 0.94 ? 'stoneWallWindowBars' : 'stoneWallBroken'; };
    const FRONT = 0.55, BACK = -0.55, isF = (x: number, y: number) => !!floor[y]?.[x];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!floor[y][x]) continue;
        let a = !isF(x - 1, y), b = !isF(x, y - 1), c = !isF(x + 1, y), d = !isF(x, y + 1);
        const cs = x + y;
        if (a && b) { prop(kenney('stoneWallCorner', 'S'), x, y, false, cs + BACK); a = b = false; }
        if (d && c) { prop(kenney('stoneWallCorner', 'N'), x, y, false, cs + FRONT); d = c = false; }
        if (a && d) { prop(kenney('stoneWallCorner', 'E'), x, y, false, cs + FRONT); a = d = false; }
        if (b && c) { prop(kenney('stoneWallCorner', 'W'), x, y, false, cs + FRONT); b = c = false; }
        if (b) prop(kenney(wallName(), 'S'), x, y, false, cs + BACK);
        if (a) prop(kenney(wallName(), 'E'), x, y, false, cs + BACK);
        if (d) prop(kenney(wallName(), 'N'), x, y, false, cs + FRONT);
        if (c) prop(kenney(wallName(), 'W'), x, y, false, cs + FRONT);
    }
    // escalera de caracol de salida (celda disparadora) y decorado
    prop(kenney('stairsSpiral', 'S'), C.exit.x, C.exit.y, false, C.exit.x + C.exit.y + 0.2);
    for (const [x, y] of [[19, 25], [27, 25], [19, 29], [27, 29], [37, 9], [41, 9], [37, 13], [41, 13]]) prop(kenney('stoneColumn', 'S'), x, y, true);
    prop(kenney('barrels', 'S'), 4, 43, true); prop(kenney('woodenCrate', 'S'), 5, 43, true); prop(kenney('barrel', 'S'), 10, 37, true);
    prop(kenney('chestClosed', 'W'), 43, 7, true);
    prop(102, 4, 42, true); // brazero
    const zones: Zone[] = [
        { type: 'skeleton', x: 23, y: 27, r: 4, n: 4, name: 'Mazmorra de prueba: sala de huesos', lvl: 3 },
        { type: 'skeleton_mage', x: 39, y: 11, r: 3, n: 3, name: 'Mazmorra de prueba: sala del hechicero', lvl: 4 },
    ];
    return { size: N, tiles, blocked, safe, props, decals: [], zones, buildings: [], npcs: [], spawn: { ...C.fromCaza }, fire: { x: 4, y: 42 }, dungeon: { x0: 0, y0: 0, x1: N - 1, y1: N - 1 } };
}
