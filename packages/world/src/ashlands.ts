/**
 * Segunda ampliación de Solmar (corre después de extendSolmar, con su propia semilla para no mover nada de lo anterior):
 *   - las Tierras de ceniza: una región grande al sur del páramo, con zonas de mobs de nivel creciente de oeste a este, y
 *   - la Cámara del foso: una mazmorra de tres salas, con escalera sellada (pide la Llave del foso) al este de las tierras.
 * Mismas piezas CC0 que frontier.ts (Kenney Isometric Dungeon + SBS Isometric Floor Tiles).
 */
import type { WorldMap, Prop, Zone } from './index';
import { kenney, sbs, SBS, ROCKS, DEAD, GRAVES, CLAY, ROCKY, type Rect } from './frontier';

export const ASH_SIZE = 96;
type Ori = 'N' | 'E' | 'S' | 'W';
const ORIS: Ori[] = ['N', 'E', 'S', 'W'];
const ASH = [[SBS.rocky1, [1, 2, 7, 10, 12]], [SBS.dry1, [0, 3, 4, 6, 13]], [SBS.dry1, [12, 16, 17]]] as const;

export function extendAshlands(w: WorldMap): WorldMap {
    const N = ASH_SIZE;
    let seed = 777123;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
    const pickTile = (set: readonly (readonly [number, readonly number[]])[], n = rnd()) => {
        const all = set.flatMap(([s, cells]) => cells.map((c) => sbs(s, c)));
        return rnd() < 0.3 ? pick(all) : all[Math.min(all.length - 1, Math.floor(n * all.length))];
    };
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

    // 2) Tierras de ceniza
    const CX = 50, CY = 79, RX = 42, RY = 16;
    const stairsIn = { x: 86, y: 79 }, arriveFromFoso = { x: 85, y: 79 };
    const inCorridor = (x: number, y: number) => x >= 31 && x <= 35 && y >= 55 && y <= 66;
    const inA = (x: number, y: number) => {
        if (inCorridor(x, y)) return true;
        if (y < 65 || y >= N - 1 || x < 1 || x >= N - 1) return false;
        const d = ((x - CX) / RX) ** 2 + ((y - CY) / RY) ** 2 + (noise(x, y, 5, 4) - 0.5) * 0.3;
        return d < 1;
    };
    const ash: boolean[][] = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => inA(x, y)));
    clearProps({ x0: 30, y0: 55, x1: 36, y1: 67 });
    const keepClear = (x: number, y: number) => inCorridor(x, y) || Math.hypot(x - stairsIn.x, y - stairsIn.y) < 3.2;
    for (let y = 55; y < N; y++) for (let x = 0; x < N; x++) {
        if (ash[y][x]) {
            const a = noise(x, y, 11, 12), n = noise(x, y, 51, 6);
            w.tiles[y][x] = inCorridor(x, y) && y < 65 ? sbs(SBS.dry1, [12, 16, 17][(x + y) % 3]) : a > 0.64 ? pickTile(ROCKY, n) : a < 0.34 ? pickTile(CLAY, n) : pickTile(ASH, n);
            w.blocked[y][x] = false; w.safe[y][x] = false;
            if (keepClear(x, y)) continue;
            const r = rnd();
            if (r < 0.04) prop(pick(ROCKS), x, y, true);
            else if (r < 0.065) prop(pick(DEAD), x, y, true);
            else if (r < 0.07) prop(pick(GRAVES), x, y, true);
        } else {
            let edge = false;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ash[y + dy]?.[x + dx]) edge = true;
            if (!edge || w.tiles[y][x] !== 0) continue; // lo que ya era del páramo se queda como estaba
            w.tiles[y][x] = pickTile(ROCKY); w.blocked[y][x] = true;
            if (rnd() < 0.88) prop(rnd() < 0.7 ? pick(ROCKS) : pick(DEAD), x, y, true);
        }
    }
    // el corredor atraviesa el borde del páramo: abrirlo también ahí y flanquearlo con rocas
    for (let y = 55; y <= 64; y++) for (let x = 31; x <= 35; x++) { w.blocked[y][x] = false; w.safe[y][x] = false; if (w.tiles[y][x] === 0) w.tiles[y][x] = sbs(SBS.dry1, [12, 16, 17][(x + y) % 3]); }
    for (let y = 60; y <= 64; y++) for (const x of [30, 36]) { if (w.tiles[y][x] === 0) w.tiles[y][x] = pickTile(ROCKY); prop(pick(ROCKS), x, y, true); }
    // de oeste a este suben el nivel y el peligro
    for (const z of [
        { type: 'fire_ant', x: 36, y: 72, r: 5, n: 4, name: 'Camino de brasas' },
        { type: 'wyvern', x: 52, y: 70, r: 4, n: 3, name: 'Nidal de ceniza' },
        { type: 'skeleton_mage', x: 62, y: 83, r: 5, n: 4, name: 'Osario ardiente' },
        { type: 'minotaur', x: 76, y: 72, r: 3, n: 2, name: 'Cantera del minotauro' },
        { type: 'golem', x: 22, y: 84, r: 2, n: 1, name: 'Forja apagada' },
    ]) w.zones.push(z as Zone);

    // escalera sellada a la Cámara del foso, entre dos columnas
    prop(kenney('stairsSpiral', 'S'), stairsIn.x, stairsIn.y, false);
    prop(kenney('stoneColumn', 'S'), stairsIn.x + 1, stairsIn.y - 1, true);
    prop(kenney('stoneColumn', 'S'), stairsIn.x - 1, stairsIn.y + 1, true);

    // 3) la Cámara del foso
    const OX = 64, OY = 26;
    const R = (id: string, x0: number, y0: number, x1: number, y1: number): [string, Rect] => [id, { x0: x0 + OX, y0: y0 + OY, x1: x1 + OX, y1: y1 + OY }];
    const rooms: [string, Rect][] = [R('f1', 1, 11, 7, 17), R('f2', 12, 9, 20, 18), R('f3', 24, 4, 29, 17)];
    const halls: Rect[] = [R('h1', 8, 14, 11, 14), R('h2', 21, 14, 23, 14)].map((r) => r[1]);
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
        if (k === 'f3') name = r < 0.3 ? 'dirt' : r < 0.45 ? 'stoneUneven' : 'stoneInset';
        else if (k === 'f2') name = r < 0.18 ? 'stoneUneven' : r < 0.26 ? 'dirt' : 'stone';
        else if (r < 0.1) name = 'stoneTile'; else if (r < 0.2) name = 'stoneUneven';
        w.tiles[y][x] = kenney(name, o());
    }
    const wallName = () => { const r = rnd(); return r < 0.62 ? 'stoneWall' : r < 0.82 ? 'stoneWallAged' : r < 0.9 ? 'stoneWallWindow' : r < 0.94 ? 'stoneWallWindowBars' : 'stoneWallBroken'; };
    const isF = (x: number, y: number) => !!floor[y]?.[x];
    const FRONT = 0.55, BACK = -0.55;
    const arch: [number, number, Ori][] = [[8, 14, 'E'], [11, 14, 'W'], [21, 14, 'E'], [23, 14, 'W']];
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
    for (const [x, y, s] of arch) prop(kenney('stoneWallArchway', s), x + OX, y + OY, false, x + OX + y + OY + (s === 'N' || s === 'W' ? FRONT : BACK));

    const P = (name: string, x: number, y: number, block = true, ori: Ori = 'S') => prop(kenney(name, ori), x + OX, y + OY, block);
    for (const [x, y] of [[14, 11], [18, 11], [14, 16], [18, 16]]) P('stoneColumn', x, y);
    P('barrels', 13, 10); P('woodenCrate', 19, 10); P('barrelsStacked', 13, 17); P('woodenPile', 19, 17, false);
    for (const [x, y] of [[26, 6], [28, 6], [26, 15], [28, 15]]) P('stoneColumn', x, y);
    P('chestClosed', 29, 4, true, 'W'); P('chestClosed', 24, 4, true, 'S'); P('woodenCrates', 29, 17);
    P('woodenCrate', 7, 12); P('barrel', 2, 16); P('barrel', 7, 16);
    const exit = { x: 2 + OX, y: 12 + OY }, arriveInFoso = { x: 3 + OX, y: 14 + OY };
    prop(kenney('stairsSpiral', 'S'), exit.x, exit.y, false, exit.x + exit.y + 0.2);

    w.zones.push({ type: 'skeleton_mage', x: 16 + OX, y: 13 + OY, r: 3, n: 4, name: 'Cámara del foso' } as Zone);
    w.zones.push({ type: 'skeleton_mage', x: 27 + OX, y: 8 + OY, r: 2, n: 2, name: 'Cámara del foso' } as Zone);
    w.zones.push({ type: 'demonio', x: 27 + OX, y: 11 + OY, r: 1, n: 1, name: 'Cámara del foso' } as Zone);

    w.portals = [
        ...(w.portals ?? []),
        { x: stairsIn.x, y: stairsIn.y, tx: arriveInFoso.x, ty: arriveInFoso.y, key: 'foso', msg: 'Bajás a la Cámara del foso. El aire quema.' },
        { x: exit.x, y: exit.y, tx: arriveFromFoso.x, ty: arriveFromFoso.y, msg: 'Subís las escaleras de vuelta a las Tierras de ceniza.' },
    ];
    w.dungeons = [{ x0: OX, y0: OY, x1: OX + 30, y1: OY + 20 }];
    return w;
}
