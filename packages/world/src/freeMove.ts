/**
 * Movimiento libre sobre la grilla: el personaje se mueve continuo (cualquier ángulo, cualquier frame) y la
 * celda que ve el server es floor(x), floor(y). Coordenadas en celdas; el centro de la celda n es n + 0,5.
 *
 * Es código puro (sin DOM ni red) para que el cliente lo use y el server lo pueda probar.
 */

/** Radio del cuerpo contra paredes y otros jugadores (en celdas). Chico: tiene que poder pasar rozando. */
export const BODY_MARGIN = 0.18;
/** Paso máximo por sub-paso: con 3 celdas/s y 60 fps son 0,05, así que nunca se salta una celda. */
const MAX_SUBSTEP = 0.2;

export interface FreeMove {
    /** Posición actual. */
    x: number; y: number;
    /** Dirección deseada en grilla. La longitud (0..1) escala la velocidad; 0 = quieto. */
    dx: number; dy: number;
    /** Celdas por segundo a longitud 1. */
    speed: number;
    dt: number;
    /** ¿Se puede estar en esa celda? (paredes y otros jugadores). */
    free: (cx: number, cy: number) => boolean;
}

export interface FreeMoveResult { x: number; y: number; moved: number }

/** ¿Entra el cuerpo (un cuadrado de ± BODY_MARGIN) en esa posición? */
export function bodyFits(x: number, y: number, free: (cx: number, cy: number) => boolean, m = BODY_MARGIN): boolean {
    const x0 = Math.floor(x - m), x1 = Math.floor(x + m), y0 = Math.floor(y - m), y1 = Math.floor(y + m);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) if (!free(cx, cy)) return false;
    return true;
}

/**
 * Avanza un frame. Si la dirección choca, desliza por el eje que queda libre (como contra una pared en un MMO).
 * Si el cuerpo ya está pegado a algo que no entra (por ejemplo, otro jugador que se paró encima), no queda trabado:
 * solo se rechaza el movimiento que empeora la situación, así que siempre se puede salir.
 */
export function stepFree(i: FreeMove): FreeMoveResult {
    const len = Math.hypot(i.dx, i.dy);
    if (len < 1e-6 || i.dt <= 0) return { x: i.x, y: i.y, moved: 0 };
    const total = Math.min(len, 1) * i.speed * i.dt;           // distancia a recorrer este frame
    const n = Math.max(1, Math.ceil(total / MAX_SUBSTEP)), h = total / n;
    const ux = i.dx / len, uy = i.dy / len;
    let x = i.x, y = i.y, moved = 0;
    for (let k = 0; k < n; k++) {
        const startFits = bodyFits(x, y, i.free);
        const ok = (px: number, py: number) => bodyFits(px, py, i.free) || !startFits; // si ya estoy "adentro", dejo salir
        const nx = x + ux * h, ny = y + uy * h;
        if (ok(nx, ny)) { moved += Math.hypot(nx - x, ny - y); x = nx; y = ny; continue; }
        // deslizar: primero el eje en que más me muevo, después el otro
        const first = Math.abs(ux) >= Math.abs(uy);
        const tries: [number, number][] = first ? [[nx, y], [x, ny]] : [[x, ny], [nx, y]];
        let slid = false;
        for (const [px, py] of tries) {
            if (px === x && py === y) continue;
            if (ok(px, py)) { moved += Math.hypot(px - x, py - y); x = px; y = py; slid = true; break; }
        }
        if (!slid) break;
    }
    return { x, y, moved };
}

/** Celda que ve el server para una posición decimal. */
export const cellOf = (x: number, y: number): { x: number; y: number } => ({ x: Math.floor(x), y: Math.floor(y) });

/**
 * Presupuesto de movimiento del server (y su prueba): cada pedido de posición gasta la distancia recorrida; el tiempo
 * lo recarga a `speed` celdas por segundo hasta un tope de ráfaga. Si pide más de lo que hay, es trampa o lag excesivo.
 */
export class MoveBudget {
    private budget: number;
    private last: number;
    constructor(private readonly burst = 1.6, now = 0, private readonly tolerance = 1.08) { this.budget = burst; this.last = now; }
    /** Reinicia (teleport, reaparición, corrección del server). */
    reset(now: number): void { this.budget = this.burst; this.last = now; }
    /** true si `dist` celdas entran en el presupuesto a esa velocidad (celdas/s); gasta el presupuesto. */
    spend(dist: number, now: number, speedCps: number): boolean {
        const dt = Math.max(0, now - this.last) / 1000;
        this.last = now;
        this.budget = Math.min(this.burst, this.budget + dt * speedCps * this.tolerance);
        if (dist > this.budget) return false;
        this.budget -= dist;
        return true;
    }
}
