/**
 * Zem (D.9, DISEÑO.md §5b): material que cae de todos los mobs, reemplaza a la piedra de forja y es lo que se gasta en la mejora +N.
 * La forja solo usa el zem del DEPÓSITO. El zem de la bolsa es riesgo: al morir contra un jugador en zona roja se cae todo.
 */
/** Chance de que un mob suelte 1 zem, por origen (7 a 10 %; los jefes de mazmorra y de mundo siguen soltando su montón fijo). */
export const ZEM_CHANCE = { loose: 0.07, pit: 0.08, dungeon: 0.09, world: 0.1 } as const;
/** Zem de un jefe de mazmorra o de mundo (rango, ambos incluidos). */
export const ZEM_BOSS: [number, number] = [3, 5];
/** Al morir contra un jugador en zona roja se cae este porcentaje del oro de la bolsa, con un tope de `nivel × PVP_GOLD_CAP_PER_LEVEL`. */
export const PVP_GOLD_LOSS_PCT = 0.1, PVP_GOLD_CAP_PER_LEVEL = 100;
/** Cuánto oro se cae al morir en zona roja: `min(10 % del oro, nivel × 100)`, entero y nunca más que lo que se tiene. */
export const pvpGoldLoss = (gold: number, lvl: number): number => {
    if (!(gold > 0) || !Number.isFinite(gold)) return 0;
    return Math.max(0, Math.min(Math.floor(gold), Math.floor(gold * PVP_GOLD_LOSS_PCT), Math.floor(Math.max(1, lvl) * PVP_GOLD_CAP_PER_LEVEL)));
};
/** Id del material en el botín del suelo (`LootEntry.itemId`) y nombre para mostrar. */
export const ZEM_ID = 'zem', ZEM_NAME = 'Zem';
