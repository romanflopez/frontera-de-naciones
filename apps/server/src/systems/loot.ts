/**
 * Botín de materiales / oro en el suelo (MVP). Server-autoritativo, uno por mundo, solo en memoria.
 * Al morir un mob se tira un dado: si sale, cae un LootSpawnEvent en la celda del mob para los que lo ven.
 * El ClientPickupItem se valida (existe, a ≤ 1,5 celdas, vivo); si vale se borra, se suma a la cuenta y se avisa a todos con ServerItemPickedUp.
 * Aparte del botín de items de la economía (ground.ts / Economy.reward): esto son materiales apilables y montoncitos de oro.
 */
import type { MobType } from '@fdn/world';

/** Distancia máxima (celdas) para levantar. */
export const LOOT_PICKUP_RANGE = 1.5;
/** Cuánto dura el botín en el suelo antes de desaparecer. */
export const LOOT_TTL_MS = 3 * 60_000;
/** Chance de que un mob suelte algo. */
export const LOOT_DROP_CHANCE = 0.35;
/** Dentro de lo que cae: chance de que sea oro en vez del material. */
const GOLD_SHARE = 0.3;

/** [DM] El botín de un kill es de la party que lo mató durante este tiempo; después, de cualquiera (como los ítems tirados). */
export const LOOT_OWNED_MS = 30_000;

export interface LootEntry {
    lootId: string; x: number; y: number; itemId: string; itemName: string; amount: number; expiresAt: number;
    /** sesiones que pueden levantarlo hasta `freeAt` (la party del que mató, en rango); vacío = de cualquiera */
    owners?: string[]; freeAt?: number;
}

/**
 * [DM] Reparto entre la party: el oro se divide en partes iguales (lo que sobra, de a 1 a compañeros al azar) y un material
 * le toca entero a uno al azar. Devuelve cuánto le toca a cada índice de `n` (solo los que reciben algo).
 */
export function splitLoot(itemId: string, amount: number, n: number, rnd: () => number = Math.random): { i: number; amount: number }[] {
    if (n <= 1) return [{ i: 0, amount }];
    if (itemId !== 'gold') return [{ i: Math.min(n - 1, Math.floor(rnd() * n)), amount }];
    const share = Math.floor(amount / n), parts = Array.from({ length: n }, () => share), idx = [...Array(n).keys()];
    for (let left = amount - share * n; left > 0; left--) { const j = Math.floor(rnd() * idx.length); parts[idx[j]]++; idx.splice(j, 1); }
    return parts.map((a, i) => ({ i, amount: a })).filter((x) => x.amount > 0);
}

/** Material por tipo de mob; el resto cae como trofeo genérico. */
const MATERIALS: Partial<Record<MobType, { id: string; name: string }>> = {
    goblin: { id: 'goblin_ear', name: 'Oreja de goblin' }, goblin_elite: { id: 'goblin_ear', name: 'Oreja de goblin' },
    hobgoblin: { id: 'goblin_ear', name: 'Oreja de goblin' }, hobgoblin_archer: { id: 'goblin_ear', name: 'Oreja de goblin' },
    zombie: { id: 'rotten_flesh', name: 'Carne podrida' }, zombie_dark: { id: 'rotten_flesh', name: 'Carne podrida' },
    skeleton: { id: 'old_bone', name: 'Hueso viejo' }, skeleton_mage: { id: 'old_bone', name: 'Hueso viejo' }, skeleton_archer: { id: 'old_bone', name: 'Hueso viejo' },
    antlion: { id: 'chitin', name: 'Quitina' }, antlion_small: { id: 'chitin', name: 'Quitina' }, fire_ant: { id: 'chitin', name: 'Quitina' }, ice_ant: { id: 'chitin', name: 'Quitina' },
    arana: { id: 'spider_silk', name: 'Seda de araña' },
    wyvern: { id: 'viper_skin', name: 'Viper Skin' }, wyvern_fire: { id: 'viper_skin', name: 'Viper Skin' }, wyvern_ice: { id: 'viper_skin', name: 'Viper Skin' },
    golem: { id: 'stone_core', name: 'Núcleo de piedra' }, minotaur: { id: 'minotaur_horn', name: 'Cuerno de minotauro' },
    demonio: { id: 'demon_ash', name: 'Ceniza demoníaca' },
};
export const materialOf = (type: MobType, name: string) => MATERIALS[type] ?? { id: `trophy_${type}`, name: `Trofeo de ${name}` };

export interface LootRoll { itemId: string; itemName: string; amount: number }
/** Tirada al morir un mob: null = no cae nada. */
export function rollLoot(type: MobType, name: string, lvl: number, rnd: () => number = Math.random): LootRoll | null {
    if (rnd() >= LOOT_DROP_CHANCE) return null;
    if (rnd() < GOLD_SHARE) return { itemId: 'gold', itemName: 'Oro', amount: Math.max(1, Math.round((2 + rnd() * 4) * lvl)) };
    const m = materialOf(type, name);
    return { itemId: m.id, itemName: m.name, amount: 1 };
}

export type PickupResult = { ok: true; loot: LootEntry } | { ok: false; reason: 'gone' | 'far' | 'locked' };

export class LootManager {
    readonly items = new Map<string, LootEntry>();
    /** Qué botín ya le mandamos a cada sesión (para no repetir y para avisar a los que llegan después). */
    private readonly seen = new Map<string, Set<string>>();
    private seq = 0;
    constructor(private readonly prefix: string, private readonly now: () => number = Date.now) {}

    spawn(x: number, y: number, r: LootRoll, owners: string[] = []): LootEntry {
        const e: LootEntry = { lootId: `${this.prefix}-${(++this.seq).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, x: Math.floor(x), y: Math.floor(y), ...r, expiresAt: this.now() + LOOT_TTL_MS };
        if (owners.length) { e.owners = owners; e.freeAt = this.now() + LOOT_OWNED_MS; }
        this.items.set(e.lootId, e);
        return e;
    }

    /** Valida y saca el botín. `px, py`: celda del jugador. */
    pickup(lootId: string, px: number, py: number, sid = ''): PickupResult {
        const e = this.items.get(lootId); if (!e) return { ok: false, reason: 'gone' };
        if (Math.hypot(px - e.x, py - e.y) > LOOT_PICKUP_RANGE) return { ok: false, reason: 'far' };
        if (e.owners && (e.freeAt ?? 0) > this.now() && !e.owners.includes(sid)) return { ok: false, reason: 'locked' };
        this.items.delete(lootId);
        for (const s of this.seen.values()) s.delete(lootId);
        return { ok: true, loot: e };
    }

    /** Saca lo vencido y lo devuelve con las sesiones que lo tenían a la vista (para avisarles). */
    expire(): { loot: LootEntry; viewers: string[] }[] {
        const t = this.now(), out: { loot: LootEntry; viewers: string[] }[] = [];
        for (const e of [...this.items.values()]) {
            if (e.expiresAt > t) continue;
            this.items.delete(e.lootId);
            out.push({ loot: e, viewers: this.viewersOf(e.lootId) });
            for (const s of this.seen.values()) s.delete(e.lootId);
        }
        return out;
    }

    /** Lo que `sid` todavía no vio dentro del rectángulo de visión (y lo marca como visto). */
    unseenNear(sid: string, px: number, py: number, rx: number, ry: number): LootEntry[] {
        let s = this.seen.get(sid); if (!s) this.seen.set(sid, (s = new Set()));
        const out: LootEntry[] = [];
        for (const e of this.items.values()) if (!s.has(e.lootId) && Math.abs(e.x - px) <= rx && Math.abs(e.y - py) <= ry) { s.add(e.lootId); out.push(e); }
        return out;
    }
    markSeen(sid: string, lootId: string): void { let s = this.seen.get(sid); if (!s) this.seen.set(sid, (s = new Set())); s.add(lootId); }
    /** Quién tenía a la vista este botín (para el aviso de vencido). */
    viewersOf(lootId: string): string[] { return [...this.seen].filter(([, s]) => s.has(lootId)).map(([sid]) => sid); }
    /** Salió del mundo o cambió de socket: se le vuelve a mandar todo al entrar. */
    forget(sid: string): void { this.seen.delete(sid); }
}
