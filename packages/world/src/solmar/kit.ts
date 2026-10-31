/**
 * Herramientas para armar mapas de ciudad (villa exterior e interiores) con semilla fija: grilla, pisos, objetos, edificios del
 * kit (town.ts) con su puerta, NPCs y una máscara de celdas reservadas (calles, plazas, puertas) que los edificios no pueden pisar.
 * Todo determinista: cliente y server arman lo mismo.
 */
import type { Npc, Prop, WorldMap } from '../index';
import { townBuilding } from '../town';

export interface Cell { x: number; y: number }
export const makeRnd = (seed0: number) => {
    let seed = seed0;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { rnd, pick: <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] };
};
/** Ruido de valores suave y determinista en [0, 1). */
export function noise2(x: number, y: number, s: number, f: number): number {
    const hash = (a: number, b: number) => { let h = Math.imul(a * 374761393 + b * 668265263 + s * 1274126177, 1103515245); h = (h ^ (h >>> 13)) >>> 0; return (Math.imul(h, 2654435761) >>> 0) / 4294967296; };
    const fx = x / f, fy = y / f, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, sm = (t: number) => t * t * (3 - 2 * t);
    const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return (a + (b - a) * sm(tx)) * (1 - sm(ty)) + (c + (d - c) * sm(tx)) * sm(ty);
}

export class TownMap {
    readonly w: WorldMap;
    readonly rnd: () => number;
    readonly pick: <T>(a: readonly T[]) => T;
    /** Celdas que tienen que quedar libres (calles, plazas, puertas, llegadas): edificios y objetos que bloquean no pueden ir ahí. */
    readonly keep: boolean[][];
    constructor(readonly N: number, seed: number, fill: number, blockedAll = false) {
        const r = makeRnd(seed); this.rnd = r.rnd; this.pick = r.pick;
        this.w = {
            size: N, tiles: Array.from({ length: N }, () => new Array<number>(N).fill(fill)),
            blocked: Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => blockedAll || x === 0 || y === 0 || x === N - 1 || y === N - 1)),
            safe: Array.from({ length: N }, () => new Array<boolean>(N).fill(true)),
            props: [], decals: [], zones: [], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 },
        };
        this.keep = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
    }
    in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.N && y < this.N; }
    rect(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.in(x, y)) fn(x, y); }
    tile(x: number, y: number, id: number) { if (this.in(x, y)) this.w.tiles[y][x] = id; }
    block(x: number, y: number, v = true) { if (this.in(x, y)) this.w.blocked[y][x] = v; }
    reserve(x0: number, y0: number, x1 = x0, y1 = y0) { this.rect(x0, y0, x1, y1, (x, y) => { this.keep[y][x] = true; }); }
    free(x: number, y: number) { return this.in(x, y) && !this.w.blocked[y][x] && !this.keep[y][x]; }
    /** Objeto en el centro de la celda. `block` lo hace sólido; si la celda está reservada y bloquea, no se pone. */
    prop(id: number, x: number, y: number, block = true, d?: number): boolean {
        if (!this.in(x, y) || (block && (this.keep[y][x] || this.w.blocked[y][x]))) return false;
        const p: Prop = { id, x: x + 0.5, y: y + 0.5 }; if (d !== undefined) p.d = d;
        this.w.props.push(p); if (block) this.w.blocked[y][x] = true; return true;
    }
    decal(id: number, x: number, y: number) { this.w.decals.push({ id, x: x + 0.5, y: y + 0.5 }); }
    /** Edificio del kit con la esquina norte en (x, y): bloquea la huella. Devuelve la celda de la puerta (afuera) y la de llegada. */
    building(id: string, x: number, y: number): { door: Cell; out: Cell } | null {
        const b = townBuilding(id);
        this.rect(x, y, x + b.w - 1, y + b.h - 1, (cx, cy) => { if (this.keep[cy][cx]) throw new Error(`${id} en (${x}, ${y}) pisa una celda reservada (${cx}, ${cy})`); if (this.w.blocked[cy][cx]) throw new Error(`${id} en (${x}, ${y}) pisa una celda ocupada (${cx}, ${cy})`); });
        this.w.buildings.push({ id, x, y, w: b.w, h: b.h });
        this.rect(x, y, x + b.w - 1, y + b.h - 1, (cx, cy) => { this.w.blocked[cy][cx] = true; });
        if (!b.door) return null;
        const S = b.door.side === 'S';
        const door = S ? { x: x + b.door.i, y: y + b.h } : { x: x + b.w, y: y + b.door.i };
        const out = S ? { x: door.x, y: door.y + 1 } : { x: door.x + 1, y: door.y };
        this.reserve(door.x, door.y); this.reserve(out.x, out.y);
        return { door, out };
    }
    npc(id: string, name: string, x: number, y: number, dir: number) { const n: Npc = { id, name, x, y, dir }; this.w.npcs.push(n); this.w.blocked[y][x] = true; }
}
