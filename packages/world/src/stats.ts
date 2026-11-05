/**
 * Puntos de stats del personaje (docs/PLAN_DE_TRABAJO.md paso 1.2): Fuerza, Vitalidad, Destreza y Magia.
 * La Suerte se eliminó (3/11): los bonus de botín quedan fuera de los stats y los ítems; los puntos gastados se devuelven solos
 * (cleanStats descarta la clave vieja y statPointsFree recalcula contra el total por nivel).
 * Cada stat arranca en 10 y no tiene efecto por debajo de eso: los bonus son por punto sobre 10, así un personaje sin repartir juega igual que antes.
 * Cliente y server usan estas mismas funciones (el server decide; el cliente solo muestra y refleja los números).
 */
export const STAT_IDS = ['str', 'vit', 'dex', 'int', 'mag'] as const;
export type StatId = (typeof STAT_IDS)[number];
export type Stats = Record<StatId, number>;
export const STAT_NAMES: Record<StatId, string> = { str: 'Fuerza', vit: 'Vitalidad', dex: 'Destreza', int: 'Inteligencia', mag: 'Magia' };
export const STAT_DESC: Record<StatId, string> = {
    str: 'Daño cuerpo a cuerpo (+0,2 % por punto) y un poco de vida.',
    vit: 'Vida (+0,2 % de la vida base de tu clase por punto).',
    dex: 'Defensa (+0,5 por punto).',
    int: 'Probabilidad de crítico en hechizos de daño (+0,15 % por punto, tope 35 %).',
    mag: 'Maná (+2 por punto) y daño mágico (+0,3 % por punto).',
};
/** Valor inicial de cada stat, tope por stat, puntos libres al crear y puntos que da cada nivel. */
export const STAT_BASE = 10, STAT_CAP = 200, STAT_START_FREE = 10, STAT_PER_LEVEL = 3;
/** Reasignar es gratis hasta este nivel; después cuesta oro (hasta que existan los tickets). */
export const STAT_RESET_FREE_LVL = 10;
export const statResetCost = (lvl: number): number => (lvl <= STAT_RESET_FREE_LVL ? 0 : 200 * lvl);

export const defaultStats = (): Stats => ({ str: STAT_BASE, vit: STAT_BASE, dex: STAT_BASE, int: STAT_BASE, mag: STAT_BASE });
/** Puntos que corresponden a un personaje de ese nivel (sin contar los 10 de arranque de cada stat). */
export const statPointsTotal = (lvl: number): number => STAT_START_FREE + STAT_PER_LEVEL * (Math.max(1, Math.floor(lvl)) - 1);
export const statPointsSpent = (s: Stats): number => STAT_IDS.reduce((n, id) => n + (s[id] - STAT_BASE), 0);
export const statPointsFree = (lvl: number, s: Stats): number => statPointsTotal(lvl) - statPointsSpent(s);

/** Vida y maná por clase: [base, por nivel]. Compartidos: el server decide y el cliente muestra los mismos números. */
export const CLASS_HP: Record<string, [number, number]> = { guerrero: [593, 76], mago: [381, 42], healer: [470, 54] };
export const CLASS_MP: Record<string, [number, number]> = { guerrero: [40, 4], mago: [200, 12], healer: [110, 13] }; // etapa 6b: el maná base del mago pasó de 90 a 200 (con los costos de Valdrys meditaba 30-40 % del tiempo entre el nivel 3 y el 10; docs/COMBATE.md)
export const classBaseHp = (cls: string, lvl: number): number => { const [a, b] = CLASS_HP[cls] ?? CLASS_HP.guerrero; return a + (Math.max(1, Math.floor(lvl) || 1) - 1) * b; };

/** Lo que dan los stats: se suma a lo de la clase, el nivel y el equipo. */
export interface StatBonus { hp: number; mp: number; def: number; meleeMult: number; magicMult: number; /** % de crítico en hechizos de daño (Inteligencia) */ critMag: number }
/**
 * `baseHp` es la vida base de la clase a ese nivel (classBaseHp): la Vitalidad da +0,2 % de eso por punto,
 * así vale lo mismo para un mago que para un guerrero y no se desinfla a nivel alto (antes eran +2,5 planos, trampa).
 */
export function statBonus(s: Stats | undefined, baseHp = 0): StatBonus {
    const d = (id: StatId): number => Math.max(0, (s?.[id] ?? STAT_BASE) - STAT_BASE);
    return {
        hp: Math.round(0.002 * baseHp * d('vit') + (d('str') * 2) / 3), mp: 2 * d('mag'), def: Math.round(0.5 * d('dex')),
        meleeMult: 1 + 0.002 * d('str'), magicMult: 1 + 0.003 * d('mag'), critMag: Math.min(INT_CRIT_CAP, INT_CRIT_PER_POINT * d('int')),
    };
}
/** Crítico en hechizos de daño por punto de Inteligencia (sobre 10) y su tope, en %. */
export const INT_CRIT_PER_POINT = 0.15, INT_CRIT_CAP = 35;
/** Qué tan útil es un stat para una clase: 'clave' (escala sus habilidades), 'util' (ayuda pero no es lo central), 'bajo' (casi no le sirve). */
export type StatFit = 'clave' | 'util' | 'bajo';
export interface StatTip {
    /** Qué hace un punto, con los números de TU clase y TU nivel. */
    perPoint: string;
    /** Lo que ya te dan los puntos repartidos (vacío si todavía no pusiste ninguno). */
    now: string;
    fit: StatFit;
    /** Consejo para esa clase, en una frase. */
    advice: string;
}
/** Qué stat escala cada clase: el Paladín pega con Fuerza (todas sus habilidades de daño), el Mago y el Healer con Magia (hechizos y curas). Salen de `stat` en pvpCombat.ts. */
const STAT_FIT: Record<string, Record<StatId, [StatFit, string]>> = {
    guerrero: {
        str: ['clave', 'Clave para el Paladín: todas sus habilidades de daño escalan con Fuerza.'],
        vit: ['clave', 'Más vida para aguantar al frente. Cada punto rinde más a medida que subís de nivel, porque se calcula sobre tu vida base.'],
        dex: ['util', 'Sirve para tankear, pero cada punto rinde poco: a más defensa, menos mejora cada punto nuevo.'],
        int: ['bajo', 'Solo da crítico a los hechizos de daño: tus habilidades de Paladín no lo usan.'],
        mag: ['bajo', 'Tus habilidades no escalan con Magia: solo te da maná. Tenés poco maná, así que algún punto ayuda, pero no es tu stat.'],
    },
    mago: {
        str: ['bajo', 'Tus hechizos no escalan con Fuerza: solo te da un poco de vida. No pongas puntos acá.'],
        vit: ['util', 'El Mago es frágil: algunos puntos ayudan a sobrevivir, pero tu daño sale de Magia.'],
        dex: ['bajo', 'Poca defensa por punto: casi siempre conviene Magia o Vitalidad.'],
        int: ['util', 'Cada punto suma chance de crítico a tus hechizos de daño: rinde mucho cuando ya tenés Magia alta.'],
        mag: ['clave', 'Clave para el Mago: sube el daño de todos tus hechizos y te da el maná para lanzarlos.'],
    },
    healer: {
        str: ['bajo', 'Tus hechizos y curas no escalan con Fuerza: solo te da un poco de vida. No pongas puntos acá.'],
        vit: ['util', 'Más vida para aguantar un golpe mientras curás.'],
        dex: ['bajo', 'Poca defensa por punto: casi siempre conviene Magia o Vitalidad.'],
        int: ['bajo', 'Solo da crítico a los hechizos de daño, no a las curas: casi nunca conviene.'],
        mag: ['clave', 'Clave para el Healer: sube lo que curás y lo que dañás, y te da el maná para seguir casteando.'],
    },
};
const pct = (x: number): string => (Math.round(x * 10) / 10).toString().replace('.', ',');
/**
 * Números del tooltip de cada stat, para la clase y el nivel del jugador (el cliente solo muestra: el server calcula con `statBonus`).
 * `stats` son los puntos ya repartidos (con el 10 de base).
 */
export function statTip(id: StatId, cls: string, lvl: number, stats: Stats): StatTip {
    const spent = Math.max(0, stats[id] - STAT_BASE), baseHp = classBaseHp(cls, lvl);
    const [fit, advice] = (STAT_FIT[cls] ?? STAT_FIT.guerrero)[id];
    const hpPerVit = 0.002 * baseHp;
    let perPoint: string, now: string;
    if (id === 'str') {
        perPoint = `Por punto: +0,2 % de daño cuerpo a cuerpo y +0,7 de vida.`;
        now = `+${pct(0.2 * spent)} % de daño, +${Math.round((spent * 2) / 3)} de vida`;
    } else if (id === 'vit') {
        perPoint = `Por punto: +${pct(hpPerVit)} de vida (0,2 % de tu vida base de ${baseHp} a nivel ${lvl}).`;
        now = `+${Math.round(hpPerVit * spent)} de vida`;
    } else if (id === 'dex') {
        perPoint = `Por punto: +0,5 de defensa.`;
        const def = Math.round(0.5 * spent), mit = Math.round((def / (100 + def)) * 100);
        now = `+${def} de defensa (${mit} % menos de daño físico, sin contar el equipo)`;
    } else if (id === 'int') {
        perPoint = `Por punto: +${pct(INT_CRIT_PER_POINT)} % de crítico en hechizos de daño (tope ${INT_CRIT_CAP} %).`;
        now = `+${pct(Math.min(INT_CRIT_CAP, INT_CRIT_PER_POINT * spent))} % de crítico en hechizos`;
    } else {
        perPoint = `Por punto: +2 de maná y +0,3 % de daño de hechizos y curas.`;
        now = `+${2 * spent} de maná, +${pct(0.3 * spent)} % de daño y curas`;
    }
    return { perPoint, now: spent > 0 ? now : '', fit, advice };
}

/** Stats válidos: enteros entre 10 y el tope. Si algo no cuadra, devuelve los de arranque. */
export function cleanStats(raw: unknown): Stats {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, out = defaultStats();
    for (const id of STAT_IDS) { const v = o[id]; if (typeof v === 'number' && Number.isFinite(v)) out[id] = Math.min(STAT_CAP, Math.max(STAT_BASE, Math.floor(v))); }
    return out;
}

// ---------- atributos de combate de los ítems: topes y fórmulas (las usa el server; el cliente solo las muestra) ----------
/**
 * Topes del paso 1.3. El crítico es el TOTAL (5 % base + equipo); velocidad y robo de vida son la suma del equipo.
 * `df` y `rm` topean SOLO lo que viene de atributos de los ítems (la DF/RM base de armaduras y yelmos no entra):
 * con 8 slots la mitigación X/(100+X) apilada se escapaba sin tope (docs modelo-de-items §3.6).
 */
export const COMBAT_CAP = { crit: 35, aspd: 40, leech: 15, df: 60, rm: 75 } as const;
export const CRIT_BASE = 5, CRIT_MULT = 1.8, MELEE_BASE_SECS = 0.85, POISON_SECS = 4;
const capTo = (v: number, cap: number): number => Math.max(0, Math.min(cap, Number.isFinite(v) ? v : 0));
/** Probabilidad total de crítico (%) a partir de lo que suma el equipo. */
export const critTotal = (itemCrit: number): number => capTo(CRIT_BASE + itemCrit, COMBAT_CAP.crit);
export const aspdTotal = (itemAspd: number): number => capTo(itemAspd, COMBAT_CAP.aspd);
export const leechTotal = (itemLeech: number): number => capTo(itemLeech, COMBAT_CAP.leech);
/** DF y RM que vienen de ATRIBUTOS de ítems, ya topeadas (la base de las armaduras va aparte, sin tope). */
export const itemDfTotal = (itemDf: number): number => capTo(itemDf, COMBAT_CAP.df);
export const itemRmTotal = (itemRm: number): number => capTo(itemRm, COMBAT_CAP.rm);
/** Segundos mínimos entre dos golpes cuerpo a cuerpo con esa velocidad de ataque (ya topeada). */
export const meleeIntervalSecs = (aspd: number): number => MELEE_BASE_SECS / (1 + aspdTotal(aspd) / 100);

// ---------- regeneración (etapa 6b; cliente y server usan estas mismas funciones) ----------
/**
 * Regen de maná fuera de ciudad y fuera de combate PvP (contra monstruos y caminando): etapa 6b, calibrada con `sim:pve`.
 * Con el 1 % (mínimo 2) el mago, con los costos de Valdrys y su pool de ERIS, se pasaba 30-45 % del tiempo meditando entre el
 * nivel 1 y el 20. No toca el PvP: ahí manda `pvpMpRegen` (1 %, piso 5).
 */
export const PVE_MP_REGEN = { pct: 0.02, min: 3 } as const;
/** Meditar quieto: fracción del maná máximo por segundo, con un piso. */
export const MEDITATE = { pct: 0.08, min: 6 } as const;
/**
 * Vida que regenera por segundo fuera de la ciudad y fuera de combate (`HP_REGEN.calmMs` sin recibir daño). Por porcentaje de la
 * vida máxima, como en Dreadmyst: con 1 por segundo fijo, a nivel 40 (3.700 de vida) recuperar un bicho llevaba 10 minutos.
 * `resting` = quieto (meditando o parado): regenera más rápido.
 */
export const HP_REGEN = { pct: 0.01, restPct: 0.03, min: 1, calmMs: 2500 } as const;
export const hpRegenPerSec = (maxHp: number, resting: boolean): number => Math.max(HP_REGEN.min, maxHp * (resting ? HP_REGEN.restPct : HP_REGEN.pct));
