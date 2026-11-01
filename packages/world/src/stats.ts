/**
 * Puntos de stats del personaje (docs/PLAN_DE_TRABAJO.md paso 1.2): Fuerza, Vitalidad, Destreza, Magia y Suerte.
 * Cada stat arranca en 10 y no tiene efecto por debajo de eso: los bonus son por punto sobre 10, así un personaje sin repartir juega igual que antes.
 * Cliente y server usan estas mismas funciones (el server decide; el cliente solo muestra y refleja los números).
 */
export const STAT_IDS = ['str', 'vit', 'dex', 'mag', 'luk'] as const;
export type StatId = (typeof STAT_IDS)[number];
export type Stats = Record<StatId, number>;
export const STAT_NAMES: Record<StatId, string> = { str: 'Fuerza', vit: 'Vitalidad', dex: 'Destreza', mag: 'Magia', luk: 'Suerte' };
export const STAT_DESC: Record<StatId, string> = {
    str: 'Daño cuerpo a cuerpo (+0,2 % por punto) y un poco de vida.',
    vit: 'Vida (+2,5 por punto).',
    dex: 'Defensa (+0,5 por punto).',
    mag: 'Maná (+2 por punto) y daño mágico (+0,3 % por punto).',
    luk: 'Chance de botín de ítems y oro (+0,1 % por punto).',
};
/** Valor inicial de cada stat, tope por stat, puntos libres al crear y puntos que da cada nivel. */
export const STAT_BASE = 10, STAT_CAP = 100, STAT_START_FREE = 10, STAT_PER_LEVEL = 3;
/** Reasignar es gratis hasta este nivel; después cuesta oro (hasta que existan los tickets). */
export const STAT_RESET_FREE_LVL = 10;
export const statResetCost = (lvl: number): number => (lvl <= STAT_RESET_FREE_LVL ? 0 : 200 * lvl);

export const defaultStats = (): Stats => ({ str: STAT_BASE, vit: STAT_BASE, dex: STAT_BASE, mag: STAT_BASE, luk: STAT_BASE });
/** Puntos que corresponden a un personaje de ese nivel (sin contar los 10 de arranque de cada stat). */
export const statPointsTotal = (lvl: number): number => STAT_START_FREE + STAT_PER_LEVEL * (Math.max(1, Math.floor(lvl)) - 1);
export const statPointsSpent = (s: Stats): number => STAT_IDS.reduce((n, id) => n + (s[id] - STAT_BASE), 0);
export const statPointsFree = (lvl: number, s: Stats): number => statPointsTotal(lvl) - statPointsSpent(s);

/** Lo que dan los stats: se suma a lo de la clase, el nivel y el equipo. */
export interface StatBonus { hp: number; mp: number; def: number; meleeMult: number; magicMult: number; dropMult: number }
export function statBonus(s: Stats | undefined): StatBonus {
    const d = (id: StatId): number => Math.max(0, (s?.[id] ?? STAT_BASE) - STAT_BASE);
    return {
        hp: Math.round(2.5 * d('vit') + (d('str') * 2) / 3), mp: 2 * d('mag'), def: Math.round(0.5 * d('dex')),
        meleeMult: 1 + 0.002 * d('str'), magicMult: 1 + 0.003 * d('mag'), dropMult: 1 + 0.001 * d('luk'),
    };
}
/** Stats válidos: enteros entre 10 y el tope. Si algo no cuadra, devuelve los de arranque. */
export function cleanStats(raw: unknown): Stats {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out = defaultStats();
    for (const id of STAT_IDS) { const v = o[id]; if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.min(STAT_CAP, Math.max(STAT_BASE, Math.floor(v))); }
    return out;
}

// ---------- atributos de combate de los ítems: topes y fórmulas (las usa el server; el cliente solo las muestra) ----------
/** Topes del paso 1.3. El crítico es el TOTAL (5 % base + equipo); velocidad y robo de vida son la suma del equipo. */
export const COMBAT_CAP = { crit: 35, aspd: 40, leech: 15 } as const;
export const CRIT_BASE = 5, CRIT_MULT = 1.8, MELEE_BASE_SECS = 0.85, POISON_SECS = 4;
const capTo = (v: number, cap: number): number => Math.max(0, Math.min(cap, Number.isFinite(v) ? v : 0));
/** Probabilidad total de crítico (%) a partir de lo que suma el equipo. */
export const critTotal = (itemCrit: number): number => capTo(CRIT_BASE + itemCrit, COMBAT_CAP.crit);
export const aspdTotal = (itemAspd: number): number => capTo(itemAspd, COMBAT_CAP.aspd);
export const leechTotal = (itemLeech: number): number => capTo(itemLeech, COMBAT_CAP.leech);
/** Segundos mínimos entre dos golpes cuerpo a cuerpo con esa velocidad de ataque (ya topeada). */
export const meleeIntervalSecs = (aspd: number): number => MELEE_BASE_SECS / (1 + aspdTotal(aspd) / 100);
