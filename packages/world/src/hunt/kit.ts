/**
 * Kit para armar los mapas de caza grandes (Fase 3 de docs/MUNDO.md): grilla con semilla fija, ruido suave, bordes naturales,
 * caminos con curvas, campamento seguro con fogata, pits de caza (zonas densas de mobs que se mantienen despejadas para que la IA
 * en línea recta no se trabe) y una pasada final que bloquea los bolsillos a los que no se llega a pie.
 *
 * Todo es determinista (cliente y server arman exactamente lo mismo): nada de Math.random ni de la hora.
 * Orden de armado de cada mapa: suelo -> borde -> agua/obstáculos -> caminos, campamento y pits (reservan celdas) -> decorado -> finish().
 */
import type { Prop, WorldMap, Zone } from '../index';
import { makeRnd, noise2 } from '../solmar/kit';

export interface Cell { x: number; y: number }
export type Tiles = readonly number[];

/** Elige un tile del conjunto: mayormente por ruido (manchones parejos) y un 30 % al azar (que no se vea repetido). */
export function tileBy(set: Tiles, n: number, r: number, r2: number): number {
    return r < 0.3 ? set[Math.floor(r2 * set.length)] : set[Math.min(set.length - 1, Math.floor(n * set.length))];
}

/** Pit de caza: una zona de mobs densa. `zone` es lo que simula el server; `clear` el radio que se mantiene sin obstáculos densos. */
export interface Pit { zone: Zone; clear: number }

export class HuntMap {
    readonly w: WorldMap;
    readonly rnd: () => number;
    readonly pick: <T>(a: readonly T[]) => T;
    /** Celdas reservadas: ningún objeto que bloquee puede ir ahí (caminos, campamento, llegadas, centro de los pits). */
    readonly keep: boolean[][];
    /** Celdas de camino (para no decorarlas y para el minimapa). */
    readonly road: boolean[][];
    /** Celdas bloqueadas "sólidas" (borde, bosque) que piden un objeto encima para que se vea que no se pasa. El agua no. */
    readonly solid: boolean[][];
    /** Hay un objeto en la celda. */
    readonly taken: boolean[][];
    /** Agua (bloqueada, sin objetos). */
    readonly water: boolean[][];

    constructor(readonly N: number, readonly seed: number, fill: number) {
        const r = makeRnd(seed); this.rnd = r.rnd; this.pick = r.pick;
        const grid = <T>(v: T) => Array.from({ length: N }, () => new Array<T>(N).fill(v));
        this.w = {
            size: N, tiles: grid(fill), blocked: Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => x === 0 || y === 0 || x === N - 1 || y === N - 1)),
            safe: grid(false), props: [], decals: [], zones: [], buildings: [], npcs: [], spawn: { x: 1, y: 1 }, fire: { x: -50, y: -50 },
        };
        this.keep = grid(false); this.road = grid(false); this.solid = grid(false); this.taken = grid(false); this.water = grid(false);
    }
    in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.N && y < this.N; }
    rect(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void) { for (let y = Math.max(0, y0); y <= Math.min(this.N - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(this.N - 1, x1); x++) fn(x, y); }
    /** Celdas dentro de un óvalo de radios (rx, ry) deformado por ruido (`wob` = cuánto se deforma el borde, 0..0,5). */
    blob(cx: number, cy: number, rx: number, ry: number, wob: number, s: number, fn: (x: number, y: number, d: number) => void) {
        this.rect(Math.floor(cx - rx - 3), Math.floor(cy - ry - 3), Math.ceil(cx + rx + 3), Math.ceil(cy + ry + 3), (x, y) => {
            const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + (noise2(x, y, s, 4) - 0.5) * wob * 2;
            if (d < 1) fn(x, y, d);
        });
    }
    n(x: number, y: number, s: number, f: number) { return noise2(x, y, s, f); }
    tile(x: number, y: number, id: number) { if (this.in(x, y)) this.w.tiles[y][x] = id; }
    /** Pinta con un conjunto de tiles por ruido. */
    paint(x: number, y: number, set: Tiles, s = 41, f = 5) { this.tile(x, y, tileBy(set, this.n(x, y, s, f), this.rnd(), this.rnd())); }
    block(x: number, y: number, v = true) { if (this.in(x, y) && x > 0 && y > 0 && x < this.N - 1 && y < this.N - 1) this.w.blocked[y][x] = v; }
    /** Celda bloqueada que lleva un objeto encima (árbol, roca). */
    solidify(x: number, y: number) { if (!this.in(x, y) || this.keep[y][x]) return; this.block(x, y); this.solid[y][x] = true; }
    free(x: number, y: number) { return this.in(x, y) && !this.w.blocked[y][x] && !this.keep[y][x] && !this.taken[y][x]; }
    /** Objeto en el centro de la celda. Si bloquea, la celda no puede estar reservada ni ocupada. */
    prop(id: number, x: number, y: number, block = true, d?: number): boolean {
        if (!this.in(x, y) || this.taken[y][x]) return false;
        if (block && (this.keep[y][x] || (this.w.blocked[y][x] && !this.solid[y][x]))) return false;
        const p: Prop = { id, x: x + 0.5, y: y + 0.5 }; if (d !== undefined) p.d = d;
        this.w.props.push(p); this.taken[y][x] = true;
        if (block) { this.block(x, y); this.solid[y][x] = false; }
        return true;
    }
    /** Objeto que no ocupa la celda entera (flor, pasto alto, lápida decorativa): no bloquea y se puede pisar. */
    decor(id: number, x: number, y: number) { return this.prop(id, x, y, false); }
    decal(id: number, x: number, y: number) { this.w.decals.push({ id, x: x + 0.5, y: y + 0.5 }); }
    /** Edificio del kit de ciudad (town.ts) con la esquina norte en (x, y): bloquea la huella. Falla si pisa algo reservado. */
    building(id: string, x: number, y: number, w: number, h: number) {
        this.rect(x, y, x + w - 1, y + h - 1, (cx, cy) => { if (this.keep[cy][cx] || this.taken[cy][cx]) throw new Error(`${id} en (${x}, ${y}) pisa una celda reservada u ocupada (${cx}, ${cy})`); });
        this.w.buildings.push({ id, x, y, w, h });
        this.rect(x, y, x + w - 1, y + h - 1, (cx, cy) => { this.block(cx, cy); this.solid[cy][cx] = false; this.taken[cy][cx] = true; });
    }
    reserve(x0: number, y0: number, x1 = x0, y1 = y0) { this.rect(x0, y0, x1, y1, (x, y) => { this.keep[y][x] = true; this.solid[y][x] = false; this.block(x, y, false); }); }
    reserveDisc(cx: number, cy: number, r: number) { this.rect(Math.floor(cx - r), Math.floor(cy - r), Math.ceil(cx + r), Math.ceil(cy + r), (x, y) => { if (Math.hypot(x - cx, y - cy) <= r) this.reserve(x, y); }); }

    /**
     * Borde natural: una franja de `base` celdas (+ hasta `vary` por ruido) en todo el contorno queda sólida (después se le pone
     * bosque o rocas encima con `decorate`). `tiles` es el piso de la franja.
     */
    border(base: number, vary: number, tiles: Tiles) {
        const N = this.N;
        this.rect(0, 0, N - 1, N - 1, (x, y) => {
            const d = Math.min(x, y, N - 1 - x, N - 1 - y), t = base + this.n(x, y, this.seed + 7, 7) * vary + this.n(x, y, this.seed + 9, 3) * 1.5;
            if (d < t) { this.paint(x, y, tiles, 13, 4); if (x > 0 && y > 0 && x < N - 1 && y < N - 1) this.solidify(x, y); }
        });
    }
    /** Un manchón sólido (bosquecillo, peñasco) en forma de óvalo con ruido. */
    thicket(cx: number, cy: number, rx: number, ry: number, tiles?: Tiles) {
        this.blob(cx, cy, rx, ry, 0.35, Math.round(cx * 7 + cy), (x, y) => { if (tiles) this.paint(x, y, tiles, 13, 4); this.solidify(x, y); });
    }
    /** Laguna: agua bloqueada (sin objetos) con espuma en la orilla. Profundidad por distancia al borde. */
    pond(cx: number, cy: number, rx: number, ry: number, shallow: Tiles, deep: Tiles, foam?: { ne: number; se: number; sw: number; nw: number }) {
        const cells: Cell[] = [];
        this.blob(cx, cy, rx, ry, 0.3, Math.round(cx * 13 + cy * 3), (x, y, d) => {
            if (this.keep[y][x] || x < 2 || y < 2 || x > this.N - 3 || y > this.N - 3) return;
            this.water[y][x] = true; this.block(x, y); this.solid[y][x] = false; this.tile(x, y, this.pick(d > 0.45 ? shallow : deep)); cells.push({ x, y });
        });
        if (foam) for (const { x, y } of cells) {
            if (!this.water[y - 1]?.[x]) this.decal(foam.ne, x, y);
            if (!this.water[y]?.[x - 1]) this.decal(foam.nw, x, y);
            if (!this.water[y]?.[x + 1]) this.decal(foam.se, x, y);
            if (!this.water[y + 1]?.[x]) this.decal(foam.sw, x, y);
        }
    }

    /**
     * Camino: recorre los puntos con una curva suave (Catmull-Rom) y un leve serpenteo, pinta `width` celdas de ancho, lo reserva
     * (nada lo bloquea) y le da un borde gastado con `edge`. Atraviesa el borde del mapa y los bosques.
     */
    path(pts: Cell[], width: number, tiles: Tiles, edge?: Tiles) {
        const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
        const P = [pts[0], ...pts, pts[pts.length - 1]];
        const half = width / 2;
        for (let i = 1; i < P.length - 2; i++) {
            const a = P[i], b = P[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(2, Math.ceil(len * 2));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                let x = cr(P[i - 1].x, a.x, b.x, P[i + 2].x, t), y = cr(P[i - 1].y, a.y, b.y, P[i + 2].y, t);
                // serpenteo perpendicular (cero en los extremos para que el camino llegue justo a los puntos)
                const dx = (b.x - a.x) / (len || 1), dy = (b.y - a.y) / (len || 1), k = Math.sin(Math.PI * t) * (this.n(x, y, this.seed + 3, 9) - 0.5) * 3;
                x += -dy * k; y += dx * k;
                this.rect(Math.floor(x - half - 1.5), Math.floor(y - half - 1.5), Math.ceil(x + half + 1.5), Math.ceil(y + half + 1.5), (cx, cy) => {
                    const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
                    if (d <= half + 0.15) {
                        if (!this.road[cy][cx]) { this.paint(cx, cy, tiles, 29, 3); this.road[cy][cx] = true; }
                        this.reserve(cx, cy);
                    } else if (edge && d <= half + 1.1 && !this.road[cy][cx] && !this.water[cy][cx] && this.rnd() < 0.45) this.paint(cx, cy, edge, 31, 3);
                });
            }
        }
    }

    /**
     * Campamento seguro (zona sin mobs ni PvP, regenera rápido) con cerco de madera (portones donde lo cruza un camino), fogata en
     * el centro, tiendas, cajas y leña. Devuelve la celda de respawn (al lado de la fogata).
     */
    camp(x0: number, y0: number, x1: number, y1: number, floor: Tiles, fire: Cell): Cell {
        this.rect(x0, y0, x1, y1, (x, y) => {
            this.w.safe[y][x] = true; this.solid[y][x] = false; this.water[y][x] = false; this.block(x, y, false);
            if (!this.road[y][x]) this.paint(x, y, floor, 17, 3);
        });
        // cerco perimetral: 104 va a lo largo de y (lados oeste/este), 107 a lo largo de x (norte/sur); deja portones en los caminos
        for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (!this.road[y][x] && !this.keep[y][x]) this.prop(107, x, y);
        for (let y = y0 + 1; y < y1; y++) for (const x of [x0, x1]) if (!this.road[y][x] && !this.keep[y][x]) this.prop(104, x, y);
        this.w.fire = { ...fire };
        this.reserveDisc(fire.x, fire.y, 2.2);
        this.keep[fire.y][fire.x] = false; this.prop(102, fire.x, fire.y); // fogata
        this.decal(264, fire.x, fire.y + 2); // círculo de piedra donde se reaparece
        const spots: [number, number, number][] = [[72, x0 + 2, y0 + 2], [75, x1 - 2, y0 + 2], [75, x0 + 2, y1 - 2], [72, x1 - 2, y1 - 2]];
        for (const [id, x, y] of spots) this.prop(id, x, y);
        for (const [id, dx, dy] of [[76, 3, 1], [100, 1, 3], [101, -1, -3], [77, -3, 2], [136, 3, -2], [98, 4, 2], [97, -3, -2], [3483, 2, -3]] as const) {
            const x = fire.x + dx, y = fire.y + dy; if (x > x0 && x < x1 && y > y0 && y < y1) this.prop(id, x, y);
        }
        const respawn = { x: fire.x, y: fire.y + 2 };
        this.reserve(respawn.x, respawn.y);
        return respawn;
    }

    /**
     * Pit de caza: zona densa de mobs. Se reserva un núcleo despejado (radio `clear`) para que los mobs se muevan en línea recta y
     * se devuelve el `Pit` (la zona se agrega a `w.zones`). `floor` (opcional) pinta el suelo del pit con un óvalo ruidoso.
     */
    pit(zone: Zone, clear: number, floor?: Tiles): Pit {
        if (floor) this.blob(zone.x, zone.y, zone.r + 1.5, zone.r + 1.5, 0.3, zone.x * 3 + zone.y, (x, y) => { if (!this.road[y][x] && !this.w.safe[y][x]) this.paint(x, y, floor, 19, 4); });
        this.rect(zone.x - zone.r - 1, zone.y - zone.r - 1, zone.x + zone.r + 1, zone.y + zone.r + 1, (x, y) => {
            if (Math.hypot(x - zone.x, y - zone.y) <= clear && !this.water[y][x]) { this.keep[y][x] = true; this.solid[y][x] = false; this.block(x, y, false); }
        });
        this.w.zones.push(zone);
        return { zone, clear };
    }

    /**
     * Empalizada (cerco de troncos) en anillo de radio R alrededor de (cx, cy), con `gaps` aberturas (ángulos en grados, 0 = +x)
     * de `gapDeg` grados. Donde el anillo cruza un camino o una celda reservada queda abierto solo.
     */
    palisade(cx: number, cy: number, R: number, gaps: number[], gapDeg = 26, ids: { alongX: number; alongY: number } = { alongX: 107, alongY: 104 }) {
        this.rect(Math.floor(cx - R - 1), Math.floor(cy - R - 1), Math.ceil(cx + R + 1), Math.ceil(cy + R + 1), (x, y) => {
            const d = Math.hypot(x - cx, y - cy); if (Math.abs(d - R) >= 0.5) return;
            const a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
            if (gaps.some((g) => Math.abs(((a - g + 540) % 360) - 180) < gapDeg / 2)) return;
            const tx = -(y - cy), ty = x - cx; // tangente
            if (this.free(x, y)) this.prop(Math.abs(tx) > Math.abs(ty) ? ids.alongX : ids.alongY, x, y);
        });
    }

    /**
     * Decorado final. `edge(x, y, deep)` elige el objeto de una celda sólida (deep = no toca ninguna celda libre: puede quedar
     * vacía para no gastar objetos donde no se ve). `scatter(x, y)` decora las celdas libres que no son camino ni reservadas.
     */
    decorate(edge: (x: number, y: number, deep: boolean) => number | null, scatter: (x: number, y: number) => void) {
        const N = this.N, bl = this.w.blocked;
        for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
            if (this.solid[y][x] && !this.taken[y][x]) {
                let deep = true;
                for (let dy = -2; dy <= 2 && deep; dy++) for (let dx = -2; dx <= 2; dx++) if (this.in(x + dx, y + dy) && !bl[y + dy][x + dx]) { deep = false; break; }
                const id = edge(x, y, deep); if (id !== null) { this.w.props.push({ id, x: x + 0.5, y: y + 0.5 }); this.taken[y][x] = true; }
            } else if (!bl[y][x] && !this.keep[y][x] && !this.taken[y][x] && !this.road[y][x] && !this.w.safe[y][x]) scatter(x, y);
        }
    }

    /**
     * Cierre: todo lo caminable que no se alcanza a pie desde `from` queda bloqueado (bolsillos encerrados por árboles), así ningún
     * mob nace donde nadie llega. Devuelve cuántas celdas cerró.
     */
    finish(from: Cell): number {
        const N = this.N, bl = this.w.blocked, seen = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));
        const q: [number, number][] = [[from.x, from.y]]; seen[from.y][from.x] = true;
        for (let i = 0; i < q.length; i++) {
            const [x, y] = q[i];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < N && ny < N && !bl[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); } }
        }
        let closed = 0;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!bl[y][x] && !seen[y][x]) { bl[y][x] = true; closed++; }
        return closed;
    }
}

/** Mobs dispersos a lo largo de un camino: `count` zonas chicas de `n` mobs repartidas entre los puntos dados. */
export function roadZones(name: string, type: Zone['type'], lvl: number | undefined, pts: Cell[], n: number, respawn: number): Zone[] {
    return pts.map((p) => ({ type, x: p.x, y: p.y, r: 5, n, name, ...(lvl ? { lvl } : {}), respawn, aggro: 3.5 }));
}
