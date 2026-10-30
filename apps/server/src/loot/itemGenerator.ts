// Tirada de botín en el server: rareza y atributos al azar. El cliente elige el item base y arma el objeto con esto.
export type ItemRarity = 'comun' | 'magico' | 'raro' | 'epico';
export const RARITY_INDEX: Record<ItemRarity, number> = { comun: 0, magico: 1, raro: 2, epico: 3 };

export interface ItemAttribute { key: string; value: number }
export interface GeneratedItem { rarity: ItemRarity; attributes: ItemAttribute[]; baseSeed: number }

export const STAT_POOL = [
    'critical_chance', 'attack_speed', 'life_steal', 'defense', 'magic_resistance', 'paralysis_resistance', 'bonus_mana', 'bonus_hp',
] as const;

function randomStat(existing: string[]): string {
    const available = STAT_POOL.filter((s) => !existing.includes(s));
    return available[Math.floor(Math.random() * available.length)] ?? 'bonus_hp';
}

function rollStatValue(rarity: ItemRarity): number {
    const mult = rarity === 'magico' ? 1.2 : rarity === 'raro' ? 1.5 : rarity === 'epico' ? 2 : 1;
    return (Math.floor(Math.random() * 5) + 1) * mult;
}

/** Común 70 %, Mágico 22 %, Raro 7 %, Épico 1 %; los bosses garantizan una rareza mínima. */
export function rollMobDrop(mobLevel: number, minRarity = 0): GeneratedItem {
    const roll = Math.random() * 100;
    let rarity: ItemRarity = roll < 1 ? 'epico' : roll < 8 ? 'raro' : roll < 30 ? 'magico' : 'comun';
    const order: ItemRarity[] = ['comun', 'magico', 'raro', 'epico'];
    if (RARITY_INDEX[rarity] < minRarity) rarity = order[Math.min(3, minRarity)];
    const count = RARITY_INDEX[rarity], attributes: ItemAttribute[] = [], used: string[] = [];
    for (let i = 0; i < count; i++) {
        const key = randomStat(used); used.push(key);
        // el valor crece con el nivel del mob; el mínimo es 1 para que siempre se note
        attributes.push({ key, value: Math.max(1, Math.round(rollStatValue(rarity) * (1 + mobLevel * 0.2) * 1.6)) });
    }
    return { rarity, attributes, baseSeed: Math.floor(Math.random() * 1_000_000) };
}
