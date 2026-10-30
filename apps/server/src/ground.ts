/**
 * Botín en el suelo, server-autoritativo (uno por mundo). Un item que no entra en la bolsa (o que el jugador tira)
 * queda como `GroundItem` hasta que alguien lo recoge o vence. Vive solo en memoria: NO sobrevive a un reinicio del server.
 * Ver docs/ECONOMIA_SERVER.md ("Botín en el suelo").
 */
import type { SItem } from './economy.ts';

/** Cuánto dura un item en el suelo. */
export const GROUND_TTL_MS = 5 * 60_000;
/** Distancia máxima (celdas) para recoger. */
export const PICKUP_RANGE = 2;
/** Tope de items propios sin recoger por jugador (anti-abuso de memoria al tirar objetos). */
export const GROUND_MAX_PER_OWNER = 40;

export interface GroundItem {
    id: number;
    /** Instancia completa (el uid se renueva al recogerla: es por personaje). */
    item: SItem;
    x: number; y: number;
    /** Claves de cuenta que pueden recogerlo antes de `freeAt` (hoy uno solo; con grupos, todos los miembros que participaron). */
    ownerIds: string[];
    /** Pasado este instante (ms) lo puede recoger cualquiera. */
    freeAt: number;
    expiresAt: number;
}

/** Lo que la economía necesita del suelo del mundo donde está el jugador. */
export interface GroundApi {
    get(id: number): GroundItem | undefined;
    /** Saca el item del suelo (y avisa a los que lo veían). Devuelve undefined si ya no estaba. */
    take(id: number): GroundItem | undefined;
    /** Deja el item en el suelo junto a (x, y) (celda del jugador). */
    add(item: SItem, x: number, y: number, ownerIds: string[], freeInMs: number): GroundItem;
    ownedCount(key: string): number;
}

export const canPickup = (g: GroundItem, key: string, now: number): boolean => now >= g.freeAt || g.ownerIds.includes(key);

export class GroundLoot {
    readonly items = new Map<number, GroundItem>();
    private nextId = 1;

    add(item: SItem, x: number, y: number, ownerIds: string[], freeInMs: number, now = Date.now()): GroundItem {
        const g: GroundItem = {
            id: this.nextId++, item, ownerIds: [...ownerIds], freeAt: now + Math.max(0, freeInMs), expiresAt: now + GROUND_TTL_MS,
            x: x + (Math.random() - 0.5) * 0.6, y: y + (Math.random() - 0.5) * 0.6, // un pequeño desvío para que varios no se tapen
        };
        this.items.set(g.id, g);
        return g;
    }
    take(id: number): GroundItem | undefined { const g = this.items.get(id); if (g) this.items.delete(id); return g; }
    expired(now = Date.now()): GroundItem[] { return [...this.items.values()].filter((g) => g.expiresAt <= now); }
    ownedCount(key: string): number { let n = 0; for (const g of this.items.values()) if (g.ownerIds.includes(key)) n++; return n; }
}
