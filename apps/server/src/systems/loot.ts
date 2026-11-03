/**
 * Botín de materiales / oro en el suelo (MVP). Server-autoritativo, uno por mundo, solo en memoria.
 * Al morir un mob se tira un dado: si sale, cae un LootSpawnEvent en la celda del mob para los que lo ven.
 * El ClientPickupItem se valida (existe, a ≤ 1,5 celdas, vivo); si vale se borra, se suma a la cuenta y se avisa a todos con ServerItemPickedUp.
 * Aparte del botín de items de la economía (ground.ts / Economy.reward): esto son materiales apilables y montoncitos de oro.
 */
import { JUNK_MATS, type MobType } from '@fdn/world';

/** Distancia máxima (celdas) para levantar. */
export const LOOT_PICKUP_RANGE = 1.5;
/** Cuánto dura el botín en el suelo antes de desaparecer. */
export const LOOT_TTL_MS = 3 * 60_000;
/** Chance de que un mob suelte algo. */
export const LOOT_DROP_CHANCE = 0.35;
/** Dentro de lo que cae: chance de que sea oro en vez del material. */
const GOLD_SHARE = 0.3;

export interface LootEntry { lootId: string; x: number; y: number; itemId: string; itemName: string; amount: number; expiresAt: number }

/** Material (basura vendible) por tipo de mob; nombres y valores en JUNK_MATS (@fdn/world). El resto cae como trofeo genérico. */
const MATERIALS: Partial<Record<MobType, string>> = {
    goblin: 'goblin_ear', goblin_elite: 'goblin_ear', hobgoblin: 'goblin_ear', hobgoblin_archer: 'goblin_ear',
    zombie: 'rotten_flesh', zombie_dark: 'rotten_flesh',
    skeleton: 'old_bone', skeleton_mage: 'old_bone', skeleton_archer: 'old_bone',
    antlion: 'chitin', antlion_small: 'chitin', fire_ant: 'chitin', ice_ant: 'chitin',
    arana: 'spider_silk',
    wyvern: 'viper_skin', wyvern_fire: 'viper_skin', wyvern_ice: 'viper_skin',
    golem: 'stone_core', minotaur: 'minotaur_horn',
    demonio: 'demon_ash',
};
export const materialOf = (type: MobType, name: string): { id: string; name: string } => {
    const id = MATERIALS[type];
    return id ? { id, name: JUNK_MATS[id].name } : { id: `trophy_${type}`, name: `Trofeo de ${name}` };
};

export interface LootRoll { itemId: string; itemName: string; amount: number }
/** Tirada al morir un mob: null = no cae nada. */
export function rollLoot(type: MobType, name: string, lvl: number, rnd: () => number = Math.random): LootRoll | null {
    if (rnd() >= LOOT_DROP_CHANCE) return null;
    if (rnd() < GOLD_SHARE) return { itemId: 'gold', itemName: 'Oro', amount: Math.max(1, Math.round((2 + rnd() * 4) * lvl)) };
    const m = materialOf(type, name);
    return { itemId: m.id, itemName: m.name, amount: 1 };
}

export type PickupResult = { ok: true; loot: LootEntry } | { ok: false; reason: 'gone' | 'far' };

export class LootManager {
    readonly items = new Map<string, LootEntry>();
    /** Qué botín ya le mandamos a cada sesión (para no repetir y para avisar a los que llegan después). */
    private readonly seen = new Map<string, Set<string>>();
    private seq = 0;
    constructor(private readonly prefix: string, private readonly now: () => number = Date.now) {}

    spawn(x: number, y: number, r: LootRoll): LootEntry {
        const e: LootEntry = { lootId: `${this.prefix}-${(++this.seq).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, x: Math.floor(x), y: Math.floor(y), ...r, expiresAt: this.now() + LOOT_TTL_MS };
        this.items.set(e.lootId, e);
        return e;
    }

    /** Valida y saca el botín. `px, py`: celda del jugador. */
    pickup(lootId: string, px: number, py: number): PickupResult {
        const e = this.items.get(lootId); if (!e) return { ok: false, reason: 'gone' };
        if (Math.hypot(px - e.x, py - e.y) > LOOT_PICKUP_RANGE) return { ok: false, reason: 'far' };
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
