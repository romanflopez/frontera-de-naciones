/**
 * Ampliación de Solmar con arte CC0 (Kenney "Isometric Dungeon" y SBS "Isometric Floor Tiles"):
 *   - el Páramo reseco, una zona nueva al sur del cementerio con terreno variado de SBS, y
 *   - la Cripta olvidada, una mazmorra de cuatro salas con piso, paredes y props de Kenney,
 *     a la que se baja por una escalera de caracol del páramo y de la que se vuelve por otra.
 * Se aplica al final de buildSolmar sin tocar nada de lo que ya generaba (usa su propia semilla),
 * y como corre igual en cliente y server, las celdas bloqueadas coinciden.
 *
 * Ids de tiles/objetos (los arma tools/src/dungeon/atlas.ts, tiene que coincidir):
 *   SBS     1000 + hoja * 18 + celda
 *   Kenney  2000 + índice de nombre * 4 + orientación (N, E, S, W)
 */
import type { WorldMap, Prop, Zone } from './index';

export const KENNEY_NAMES = ['barrel', 'barrels', 'barrelsStacked', 'bridge', 'bridgeBroken', 'chair', 'chestClosed', 'chestOpen', 'dirt', 'dirtTiles', 'planks', 'planksBroken', 'planksHole', 'stairs', 'stairsAged', 'stairsCorner', 'stairsSpiral', 'stone', 'stoneColumn', 'stoneColumnWood', 'stoneCorner', 'stoneInset', 'stoneLeft', 'stoneMissingTiles', 'stoneRight', 'stoneSide', 'stoneSideUneven', 'stoneStep', 'stoneSteps', 'stoneTile', 'stoneUneven', 'stoneWall', 'stoneWallAged', 'stoneWallAgedLeft', 'stoneWallAgedRight', 'stoneWallArchway', 'stoneWallBroken', 'stoneWallBrokenLeft', 'stoneWallBrokenRight', 'stoneWallColumn', 'stoneWallColumnIn', 'stoneWallCorner', 'stoneWallDoor', 'stoneWallDoorBars', 'stoneWallDoorClosed', 'stoneWallDoorOpen', 'stoneWallGate', 'stoneWallGateBars', 'stoneWallGateClosed', 'stoneWallGateOpen', 'stoneWallHalf', 'stoneWallHole', 'stoneWallRound', 'stoneWallRoundBroken', 'stoneWallRoundWindow', 'stoneWallStructure', 'stoneWallTop', 'stoneWallWindow', 'stoneWallWindowBars', 'tableChairsBroken', 'tableRound', 'tableRoundChairs', 'tableRoundItemsChairs', 'tableShort', 'tableShortChairs', 'woodenCrate', 'woodenCrates', 'woodenPile', 'woodenSupportBeams', 'woodenSupports', 'woodenSupportsBeam', 'woodenSupportsBlock'];
type Ori = 'N' | 'E' | 'S' | 'W';
const ORIS: Ori[] = ['N', 'E', 'S', 'W'];
/** Id de una pieza de Kenney. Las paredes N/E/S/W están en SO/NO/NE/SE de la celda. */
export const kenney = (name: string, o: Ori = 'S'): number => {
    const i = KENNEY_NAMES.indexOf(name);
    if (i < 0) throw new Error(`pieza de Kenney desconocida: ${name}`);
    return 2000 + i * 4 + ORIS.indexOf(o);
};
/** Hojas de SBS, en el orden en que las arma el atlas (cada una trae 18 tiles). */
export const SBS = { dry1: 0, dry2: 1, elements1: 2, elements2: 3, flora1: 4, flora2: 5, grass1: 6, grass2: 7, ice1: 8, ice2: 9, rocky1: 10, rocky2: 11, stones1: 12, stones2: 13, brick1: 14, brick2: 15, stone1: 16, stone2: 17, tile1: 18, tile2: 19, pattern1: 20, pattern2: 21 } as const;
export const sbs = (sheet: number, cell: number) => 1000 + sheet * 18 + cell;

export const EXT_SIZE = 64;
export const PATH = [44, 45, 46, 47];
export const ROCKS = [128, 129, 130, 131], DEAD = [244, 245, 246, 247], GRAVES = [140, 141, 142, 143];

// tiles de SBS elegidos a mano: se descartaron los cráteres, el negro/violeta y todo lo que desentona; cada familia
// se mantiene en una gama de color para que el piso no parezca un parche de muestras
export const SAND = [[SBS.dry2, [0, 3, 6, 13, 14]]] as const;
export const DRY = [[SBS.dry1, [0, 3, 4, 6, 7, 13]], [SBS.dry2, [4, 7]]] as const;
export const CLAY = [[SBS.dry1, [12, 16, 17]]] as const;
export const ROCKY = [[SBS.rocky1, [1, 2, 7, 10, 12]], [SBS.dry1, [13]]] as const;
export const OASIS = [[SBS.flora1, [1, 2, 5, 7, 8, 9, 10, 12]], [SBS.flora1, [4]]] as const;

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export function extendSolmar(w: WorldMap): WorldMap {
    const N = EXT_SIZE;
    let seed = 90210;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
    // n (ruido suave en [0, 1)) decide la mayoría de los tiles de una zona; un 30% sale al azar para que no se vea repetido
    const pickTile = (set: readonly (readonly [number, readonly number[]])[], n = rnd()) => {
        const all = set.flatMap(([s, cells]) => cells.map((c) => sbs(s, c)));
        return rnd() < 0.3 ? pick(all) : all[Math.min(all.length - 1, Math.floor(n * all.length))];
    };
    // ruido de valores suave y determinista, para repartir arena / arcilla / rocas / oasis
    const hash = (x: number, y: number, s: number) => { let h = Math.imul(x * 374761393 + y * 668265263 + s * 1274126177, 1103515245); h = (h ^ (h >>> 13)) >>> 0; return (Math.imul(h, 2654435761) >>> 0) / 4294967296; };
    const noise = (x: number, y: number, s: number, f: number) => {
        const fx = x / f, fy = y / f, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sm = (t: number) => t * t * (3 - 2 * t);
        const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
        return (a + (b - a) * sm(tx)) * (1 - sm(ty)) + (c + (d - c) * sm(tx)) * sm(ty);
    };

    // 1) crecer la grilla: lo nuevo arranca vacío (tile 0 no se dibuja) y bloqueado
    for (let y = 0; y < N; y++) {
        if (!w.tiles[y]) { w.tiles[y] = []; w.blocked[y] = []; w.safe[y] = []; }
        for (let x = w.tiles[y].length; x < N; x++) { w.tiles[y].push(0); w.blocked[y].push(true); w.safe[y].push(false); }
    }
    w.size = N;
    const prop = (id: number, x: number, y: number, block: boolean, d?: number) => { const p: Prop = { id, x: x + 0.5, y: y + 0.5 }; if (d != null) p.d = d; w.props.push(p); if (block) w.blocked[y][x] = true; };
    const clearProps = (r: Rect) => { for (let i = w.props.length - 1; i >= 0; i--) { const p = w.props[i], cx = Math.floor(p.x), cy = Math.floor(p.y); if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) w.props.splice(i, 1); } };

    // 2) portón sur del cementerio: un camino de 3 celdas que baja al páramo
    clearProps({ x0: 27, y0: 33, x1: 33, y1: 39 });
    for (let y = 33; y <= 39; y++) for (let x = 29; x <= 31; x++) { w.blocked[y][x] = false; w.safe[y][x] = false; if (y >= 35) w.tiles[y][x] = pick(PATH); }
    for (let y = 33; y <= 39; y++) for (const x of [28, 32]) if (y >= 35) prop(pick(ROCKS), x, y, true);

    // 3) Páramo reseco: terreno de SBS
    const CX = 33, CY = 49.5, RX = 19, RY = 10;
    const portalIn = { x: 47, y: 49 }, arriveFromCrypt = { x: 46, y: 49 };
    const inP = (x: number, y: number) => {
        if (y < 40 || y >= N - 1 || x < 1 || x >= N - 1) return false;
        if (x >= 29 && x <= 31 && y <= 42) return true;
        const d = ((x - CX) / RX) ** 2 + ((y - CY) / RY) ** 2 + (noise(x, y, 3, 4) - 0.5) * 0.34;
        return d < 1;
    };
    const paramo: boolean[][] = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => inP(x, y)));
    const terrain = (x: number, y: number) => {
        const a = noise(x, y, 11, 12), b = noise(x, y, 23, 9), c = noise(x, y, 37, 11), n = noise(x, y, 51, 6);
        if (c > 0.7 && b > 0.5) return pickTile(OASIS, n);
        if (a > 0.66) return pickTile(ROCKY, n);
        if (a < 0.3) return pickTile(CLAY, n);
        if (b > 0.62) return pickTile(SAND, n);
        return pickTile(DRY, n);
    };
    const keepClear = (x: number, y: number) =>
        (Math.hypot(x - portalIn.x, y - portalIn.y) < 3.2) || (x >= 27 && x <= 33 && y <= 45) || Math.hypot(x - 33, y - 50) < 2.5;
    for (let y = 40; y < N; y++) for (let x = 0; x < N; x++) {
        if (paramo[y][x]) {
            w.tiles[y][x] = terrain(x, y); w.blocked[y][x] = false;
            if (keepClear(x, y)) continue;
            const r = rnd();
            if (r < 0.035) prop(pick(ROCKS), x, y, true);
            else if (r < 0.06) prop(pick(DEAD), x, y, true);
            else if (r < 0.065) prop(pick(GRAVES), x, y, true);
        } else {
            // borde: rocas y árboles secos cierran el paso; el resto de lo nuevo queda vacío
            let edge = false;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (paramo[y + dy]?.[x + dx]) edge = true;
            if (!edge) continue;
            w.tiles[y][x] = pickTile(ROCKY); w.blocked[y][x] = true;
            if (rnd() < 0.88) prop(rnd() < 0.7 ? pick(ROCKS) : pick(DEAD), x, y, true);
        }
    }
    // el borde pegado al portón es la frontera vieja del mapa (y = 39): ya está abierta arriba
    w.zones.push({ type: 'antlion', x: 36, y: 51, r: 6, n: 4, name: 'Páramo reseco', lvl: 5 } as Zone);

    // 4) escalera de caracol a la cripta, entre dos columnas
    prop(kenney('stairsSpiral', 'S'), portalIn.x, portalIn.y, false);
    prop(kenney('stoneColumn', 'S'), portalIn.x + 1, portalIn.y - 1, true);
    prop(kenney('stoneColumn', 'S'), portalIn.x - 1, portalIn.y + 1, true);

    // 5) la cripta
    const OX = 41, OY = 2;
    const R = (id: string, x0: number, y0: number, x1: number, y1: number): [string, Rect] => [id, { x0: x0 + OX, y0: y0 + OY, x1: x1 + OX, y1: y1 + OY }];
    const rooms: [string, Rect][] = [R('r1', 2, 13, 8, 18), R('r2', 2, 3, 10, 8), R('r3', 14, 1, 20, 9), R('r4', 14, 12, 20, 18)];
    const halls: Rect[] = [R('c1', 5, 9, 5, 12), R('c2', 11, 5, 13, 5), R('c3', 17, 10, 17, 11), R('c4', 9, 15, 13, 15)].map((r) => r[1]);
    const floor: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    const kind: string[][] = Array.from({ length: N }, () => new Array<string>(N).fill(''));
    for (const [id, r] of rooms) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { floor[y][x] = true; kind[y][x] = id; }
    for (const r of halls) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { floor[y][x] = true; kind[y][x] ||= 'hall'; }
    const o = () => pick(ORIS);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!floor[y][x]) continue;
        w.blocked[y][x] = false;
        const k = kind[y][x], r = rnd();
        let name = 'stone';
        if (k === 'r4') name = r < 0.12 ? 'planksBroken' : 'planks';
        else if (k === 'r3') name = r < 0.28 ? 'dirt' : r < 0.36 ? 'stoneUneven' : 'stone';
        else if (r < 0.08) name = 'stoneTile'; else if (r < 0.16) name = 'stoneUneven'; else if (r < 0.2) name = 'stoneInset';
        w.tiles[y][x] = kenney(name, k === 'r4' ? 'S' : o()); // el entablado queda parejo
    }
    // paredes: una pieza por cada lado de cada celda de piso que da a la roca. N/W caen delante del personaje,
    // así que llevan profundidad propia para dibujarse encima de él y no al revés.
    const wallName = () => { const r = rnd(); return r < 0.62 ? 'stoneWall' : r < 0.82 ? 'stoneWallAged' : r < 0.9 ? 'stoneWallWindow' : r < 0.94 ? 'stoneWallWindowBars' : 'stoneWallBroken'; };
    const isF = (x: number, y: number) => !!floor[y]?.[x];
    const FRONT = 0.55, BACK = -0.55;
    const arch: [number, number, Ori][] = [[5, 9, 'S'], [5, 12, 'N'], [11, 5, 'E'], [13, 5, 'W'], [17, 10, 'S'], [17, 11, 'N'], [9, 15, 'E'], [13, 15, 'W']];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        if (!floor[y][x]) continue;
        // a = lado NO (x-1), b = NE (y-1), c = SE (x+1), d = SO (y+1): true si ahí hay roca
        let a = !isF(x - 1, y), b = !isF(x, y - 1), c = !isF(x + 1, y), d = !isF(x, y + 1);
        const cs = x + y;
        // esquinas: una sola pieza en lugar de dos paredes
        if (a && b) { prop(kenney('stoneWallCorner', 'S'), x, y, false, cs + BACK); a = b = false; }
        if (d && c) { prop(kenney('stoneWallCorner', 'N'), x, y, false, cs + FRONT); d = c = false; }
        if (a && d) { prop(kenney('stoneWallCorner', 'E'), x, y, false, cs + FRONT); a = d = false; }
        if (b && c) { prop(kenney('stoneWallCorner', 'W'), x, y, false, cs + FRONT); b = c = false; }
        if (b) prop(kenney(wallName(), 'S'), x, y, false, cs + BACK);
        if (a) prop(kenney(wallName(), 'E'), x, y, false, cs + BACK);
        if (d) prop(kenney(wallName(), 'N'), x, y, false, cs + FRONT);
        if (c) prop(kenney(wallName(), 'W'), x, y, false, cs + FRONT);
    }
    for (const [x, y, s] of arch) prop(kenney('stoneWallArchway', s), x + OX, y + OY, false, x + OX + y + OY + (s === 'N' || s === 'W' ? FRONT : BACK));

    // props de cada sala (coordenadas locales)
    const P = (name: string, x: number, y: number, block = true, ori: Ori = 'S') => prop(kenney(name, ori), x + OX, y + OY, block);
    for (const [x, y] of [[4, 4], [8, 4], [4, 7], [8, 7]]) P('stoneColumn', x, y);
    P('barrels', 2, 3); P('woodenCrate', 3, 3); P('tableRoundChairs', 10, 8, true);
    P('chestClosed', 20, 2, true, 'W'); P('chestClosed', 19, 1, true, 'S'); P('stoneColumn', 15, 3); P('stoneColumn', 19, 4); P('stoneColumn', 15, 7); P('stoneColumn', 19, 7); P('woodenPile', 16, 9, false);
    P('woodenCrates', 20, 12); P('woodenCrate', 19, 12); P('barrelsStacked', 14, 18); P('barrel', 15, 18); P('tableShortChairs', 18, 16); P('woodenPile', 20, 17, false); P('chair', 16, 13, false, 'E');
    P('barrel', 8, 18); P('woodenCrate', 2, 18);
    // salida: escalera de caracol en el rincón del fondo de la sala de entrada
    const exit = { x: 4 + OX, y: 13 + OY }, arriveInCrypt = { x: 5 + OX + 0, y: 16 + OY };
    prop(kenney('stairsSpiral', 'S'), exit.x, exit.y, false, exit.x + exit.y + 0.2);

    w.zones.push({ type: 'skeleton', x: 17 + OX, y: 5 + OY, r: 3, n: 3, name: 'Cripta olvidada', lvl: 6 } as Zone);
    w.zones.push({ type: 'skeleton', x: 6 + OX, y: 5 + OY, r: 2, n: 2, name: 'Cripta olvidada', lvl: 6 } as Zone);
    w.zones.push({ type: 'zombie', x: 17 + OX, y: 15 + OY, r: 2, n: 2, name: 'Cripta olvidada', lvl: 7 } as Zone);
    // jefe final de la cripta: suelta la esquirla del foso
    w.zones.push({ type: 'barbaro', x: 17 + OX, y: 4 + OY, r: 1, n: 1, name: 'Cripta olvidada' } as Zone);

    // 6) Arena de arena: un recinto de arena para pelear y probar teletransportes (entrada desde el campamento)
    const AR = { x0: 46, y0: 26, x1: 60, y1: 38 };
    const inArena = (x: number, y: number) => x >= AR.x0 && x <= AR.x1 && y >= AR.y0 && y <= AR.y1;
    const arenaIn = { x: 10, y: 9 }, arenaBack = { x: 48, y: 32 }, arenaArrive = { x: 49, y: 32 };
    for (let y = AR.y0 - 1; y <= AR.y1 + 1; y++) for (let x = AR.x0 - 1; x <= AR.x1 + 1; x++) {
        if (inArena(x, y)) {
            w.tiles[y][x] = pickTile(SAND, noise(x, y, 77, 5)); w.blocked[y][x] = false; w.safe[y][x] = false;
        } else {
            w.tiles[y][x] = pickTile(ROCKY); w.blocked[y][x] = true;
            if (rnd() < 0.9) prop(rnd() < 0.8 ? pick(ROCKS) : pick(DEAD), x, y, true);
        }
    }
    // columnas como cobertura, repartidas sin tapar la entrada
    for (const [x, y] of [[52, 29], [56, 29], [52, 35], [56, 35], [54, 32], [59, 32]]) prop(kenney('stoneColumn', 'S'), x, y, true);
    prop(kenney('stairsSpiral', 'S'), arenaBack.x, arenaBack.y, false);
    prop(kenney('stairsSpiral', 'S'), arenaIn.x, arenaIn.y, false);

    w.portals = [
        { x: portalIn.x, y: portalIn.y, tx: arriveInCrypt.x, ty: arriveInCrypt.y, key: 'cripta', msg: 'Bajás por la escalera de caracol a la Cripta olvidada.' },
        { x: exit.x, y: exit.y, tx: arriveFromCrypt.x, ty: arriveFromCrypt.y, msg: 'Subís las escaleras de vuelta al páramo.' },
        { x: arenaIn.x, y: arenaIn.y, tx: arenaArrive.x, ty: arenaArrive.y, msg: 'Entrás a la Arena de arena.' },
        { x: arenaBack.x, y: arenaBack.y, tx: 9, ty: 9, msg: 'Volvés al campamento de Solmar.' },
    ];
    w.dungeon = { x0: OX, y0: OY, x1: OX + 21, y1: OY + 19 };
    return w;
}
