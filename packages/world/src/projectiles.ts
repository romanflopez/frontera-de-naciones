/**
 * Hechizos con proyectil esquivable: se apuntan a una posición, vuelan a velocidad fija y pegan solo si el blanco
 * sigue ahí al llegar. Moverse (caderear) los hace errar; el server decide el impacto con su propia posición del blanco.
 * Valores de la simulación de esquive (Vp ≈ 16 y radio ≈ 1: quieto o en línea recta te pegan, un paso lateral a tiempo te salva).
 * Código puro: lo usan el cliente (puntería, visual) y el server (validación).
 */
export interface ProjectileSpec {
    /** Celdas por segundo. */
    vp: number;
    /** Radio de impacto en celdas, medido desde el punto apuntado. */
    r: number;
}
export const PROJECTILES: Record<string, ProjectileSpec> = {
    proyectil: { vp: 16, r: 0.8 },   // Saeta ígnea
    bola: { vp: 14, r: 1.1 },        // Bola de fuego: más lenta pero más ancha
};
/** Tolerancia de red al decidir el impacto: la posición del blanco en el server llega ~0,1 s vieja (≈ 0,3 celdas corriendo). */
export const PROJECTILE_LAG_TOL = 0.3;
/** Vuelo mínimo (ms): ni siquiera pegado a quemarropa es instantáneo. */
export const PROJECTILE_MIN_MS = 80;

export const projectileFlightMs = (spell: string, fromX: number, fromY: number, toX: number, toY: number): number => {
    const sp = PROJECTILES[spell]; if (!sp) return PROJECTILE_MIN_MS;
    return Math.max(PROJECTILE_MIN_MS, Math.round((Math.hypot(toX - fromX, toY - fromY) / sp.vp) * 1000));
};

/** ¿El proyectil apuntado a (aimX, aimY) pega a un blanco que está en (tx, ty)? */
export const projectileHits = (spell: string, aimX: number, aimY: number, tx: number, ty: number): boolean => {
    const sp = PROJECTILES[spell]; if (!sp) return false;
    return Math.hypot(tx - aimX, ty - aimY) <= sp.r + PROJECTILE_LAG_TOL;
};

/**
 * Punto de puntería con anticipación lineal: dónde estará el blanco cuando llegue el proyectil si sigue con su velocidad
 * (celdas/s). Quieto, es su posición. Se resuelve iterando, porque el vuelo depende de a dónde se apunta.
 */
export function leadAim(spell: string, fromX: number, fromY: number, tx: number, ty: number, vx: number, vy: number): { x: number; y: number } {
    const sp = PROJECTILES[spell]; if (!sp) return { x: tx, y: ty };
    let ax = tx, ay = ty;
    for (let i = 0; i < 4; i++) {
        const T = Math.hypot(ax - fromX, ay - fromY) / sp.vp;
        ax = tx + vx * T; ay = ty + vy * T;
    }
    return { x: ax, y: ay };
}
