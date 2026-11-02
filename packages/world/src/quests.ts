/**
 * Misiones del corte del MVP (docs del proyecto: `mvp-dungeons-llaves-quests.md` §4).
 *
 * Tres cosas, todas con el Capitán de la ciudad:
 * - **Camino del aventurero:** cadena de 5 que lleva de los pits de nivel 1 a la Reina hormiga león (D2).
 * - **Encargos del día:** fijos (beta): están todos los de tu nivel, todos los días, sin sorteo. Se reinician juntos a las
 *   06:00 de Argentina (09:00 UTC). El primero que entregás en el día paga además una esencia (material de la llave del nido).
 * - **Repetible:** entregar 10 materiales iguales a cambio de oro o de una piedra de forja (sumidero de lo que sobra del farmeo).
 *
 * Reemplaza a la cadena vieja de 10 (`QUESTS` en economy.ts), que quedó jubilada: los portales de entrenamiento se abren por
 * nivel y las llaves viejas se siguen forjando con las esquirlas de los jefes.
 * Esta lógica es pura (sin red ni azar): el server la usa para avanzar el progreso y el cliente para mostrarlo.
 */
import type { MobType } from './mobs';
import { BOSS_UNIQUES, UNIQUES_BY_TIER, type UniqueBase } from './uniques';

// ---------- materiales nuevos (los sueltan los mobs; la receta de las llaves va en el paso de llaves) ----------
/** Colmillo: 8 % en los pits T1 (nivel 1-2). Con 8 + oro se arma la llave de la cueva (D1). */
export const MAT_COLMILLO = 'colmillo';
/** Esencia: 3 % en los pits T2 (nivel 3-4) o 1 por día con el primer encargo entregado. Va en la llave del nido (D2). */
export const MAT_ESENCIA = 'esencia';
export const QUEST_MATS: Record<string, { name: string; tier: number; chance: number }> = {
    [MAT_COLMILLO]: { name: 'Colmillo', tier: 1, chance: 0.08 },
    [MAT_ESENCIA]: { name: 'Esencia', tier: 2, chance: 0.03 },
};
/** Materiales que no se aceptan en la repetible: son de las llaves. */
export const RESERVED_MATS = new Set([MAT_COLMILLO, MAT_ESENCIA]);

/** Jefe que cierra cada dungeon del corte: matarlo (vos o tu party cerca) cuenta como completarlo. */
export const DUNGEON_BOSS: Record<'d1' | 'd2', MobType> = { d1: 'goblin_jefe', d2: 'antlion_reina' };
export const DUNGEON_NAME: Record<'d1' | 'd2', string> = { d1: 'la Cueva goblin', d2: 'el Nido de hormiga león' };
/** Piso del jefe: el dungeon solo cuenta si el jefe muere ahí (en la instancia), no si aparece en otro lado (GM, mapas de prueba). */
export const DUNGEON_MAP: Record<'d1' | 'd2', string> = { d1: 'minas_goblin', d2: 'ruinas_de_stormrock' };

// ---------- objetivos ----------
export type QuestGoal =
    | { k: 'kill'; mobs: MobType[]; map?: string; n: number; what: string }
    /** matar mobs de un pit de tu banda de nivel o más alta */
    | { k: 'pit'; n: number; what: string }
    /** tener N de un material (se cuenta lo que tenés; no se gasta al entregar) */
    | { k: 'collect'; mat: string; n: number; what: string }
    /** levantar N materiales del suelo */
    | { k: 'gather'; n: number; what: string }
    | { k: 'dungeon'; d: 'd1' | 'd2'; n: number; what: string }
    /** tener un ítem único en +N o más (equipado o en la bolsa): cuenta aunque la mejora la hayas hecho antes de aceptar */
    | { k: 'upgraded'; n: number; what: string }
    /** hablar con un NPC de ese rol */
    | { k: 'talk'; role: string; n: number; what: string }
    | { k: 'mutant'; n: number; what: string }
    /** ganar una pelea contra otra nación en un mapa de facción */
    | { k: 'pvp'; n: number; what: string };

export interface QuestReward {
    /** exp como % de lo que pide tu nivel actual (paso 1.1) */
    expPct: number;
    gold: number;
    forge?: number;
    /** ítem único: uno T1 de tu clase al azar, uno T1 de tu clase a elección o uno de la Reina a elección */
    unique?: 'class_t1_random' | 'class_t1_choice' | 'boss_d2_choice';
}

export interface MainQuest { id: string; name: string; minLvl: number; say: string; done: string; goals: QuestGoal[]; reward: QuestReward }

/** Camino del aventurero (textos provisorios: los ajusta Román). */
export const MAIN_QUESTS: MainQuest[] = [
    {
        id: 'primeros_pasos', name: 'Primeros pasos', minLvl: 1,
        say: 'Los goblins de los Campos de Sal se volvieron osados. Cada grupo vive en su pit: limpiá uno y vas a ver cómo vuelven a salir. Matá a 10 y volvé.',
        done: 'Bien hecho. Tomá esta pieza y unas piedras de forja: el herrero te va a explicar qué hacer con ellas.',
        goals: [{ k: 'kill', mobs: ['goblin', 'goblin_elite'], map: 'campos_de_sal', n: 10, what: 'Goblins en Campos de Sal' }],
        reward: { expPct: 25, gold: 150, forge: 3, unique: 'class_t1_random' },
    },
    {
        id: 'el_herrero', name: 'El herrero', minLvl: 1,
        say: 'Un ítem único vale más mejorado. Andá a la herrería y pedile al herrero que suba tu pieza a +1. A veces falla: así es la forja.',
        done: 'Ya sabés limar. Las piedras caen de los mobs: cuanto más difícil el lugar, más seguido.',
        goals: [{ k: 'upgraded', n: 1, what: 'Tener un ítem en +1' }],
        reward: { expPct: 25, gold: 80 },
    },
    {
        id: 'colmillos', name: 'Colmillos', minLvl: 1,
        say: 'La Cueva goblin no se abre con palabras. Los bichos de los pits de nivel 1 y 2 a veces sueltan colmillos: juntá 8, con eso y un poco de oro se arma la llave.',
        done: 'Ocho colmillos. Guardalos: son tu entrada a la cueva.',
        goals: [{ k: 'collect', mat: MAT_COLMILLO, n: 8, what: 'Colmillos' }],
        reward: { expPct: 35, gold: 60 },
    },
    {
        id: 'cueva_goblin', name: 'La cueva goblin', minLvl: 3,
        say: 'El Jefe goblin se esconde al fondo de las minas, debajo de la cueva. Bajá solo o con un compañero y no te quedes quieto cuando golpee el piso.',
        done: 'Volviste entero. Elegí una pieza de la armería, te la ganaste. Y guardá la llave gastada que soltó el jefe.',
        goals: [{ k: 'dungeon', d: 'd1', n: 1, what: 'Completar la Cueva goblin' }],
        reward: { expPct: 50, gold: 200, unique: 'class_t1_choice' },
    },
    {
        id: 'llave_gastada', name: 'La llave gastada', minLvl: 7,
        say: 'La Reina hormiga león manda en las ruinas debajo del nido. Sola no se va a dejar matar: juntá un grupo, y cuando empiece a llover ácido, cortala.',
        done: 'La Reina cayó. Elegí uno de sus trofeos: pocos lo pueden contar.',
        goals: [{ k: 'dungeon', d: 'd2', n: 1, what: 'Completar el Nido de hormiga león' }],
        reward: { expPct: 60, gold: 400, unique: 'boss_d2_choice' },
    },
];

export interface DailyQuest { id: string; name: string; minLvl: number; maxLvl?: number; goal: QuestGoal }
export const DAILY_QUESTS: DailyQuest[] = [
    { id: 'pits', name: 'Limpieza de pits', minLvl: 1, goal: { k: 'pit', n: 25, what: 'Mobs de un pit de tu nivel' } },
    { id: 'recolector', name: 'Recolector', minLvl: 1, goal: { k: 'gather', n: 10, what: 'Materiales levantados' } },
    { id: 'dia_d1', name: 'Bajada a la cueva', minLvl: 3, maxLvl: 12, goal: { k: 'dungeon', d: 'd1', n: 1, what: 'Completar la Cueva goblin' } },
    { id: 'dia_d2', name: 'Contra la Reina', minLvl: 7, goal: { k: 'dungeon', d: 'd2', n: 1, what: 'Completar el Nido de hormiga león' } },
    { id: 'mutante', name: 'Cazador de mutantes', minLvl: 1, goal: { k: 'mutant', n: 1, what: 'Matar un mutante' } },
    { id: 'frontera', name: 'Defensa de la frontera', minLvl: 3, goal: { k: 'pvp', n: 1, what: 'Ganar una pelea en mapa de facción' } },
];
export const DAILY_BY_ID = new Map(DAILY_QUESTS.map((q) => [q.id, q]));
export const DAILY_EXP_PCT = 10;
export const dailyGold = (lvl: number): number => 50 + 20 * lvl;
/** El reinicio diario: 06:00 de Buenos Aires = 09:00 UTC. Todos a la misma hora (mejor que un temporizador de 20 h por personaje). */
export const DAILY_RESET_UTC_HOUR = 9;
const DAY_MS = 86_400_000;
export const questDay = (now: number): number => Math.floor((now - DAILY_RESET_UTC_HOUR * 3_600_000) / DAY_MS);
export const msToReset = (now: number): number => (questDay(now) + 1) * DAY_MS + DAILY_RESET_UTC_HOUR * 3_600_000 - now;

/** Repetible: N materiales iguales por oro o por una piedra de forja. */
export const REPEAT_MATS = 10;
export const repeatGold = (lvl: number): number => 20 + 6 * lvl;

// ---------- estado ----------
export interface QuestBook {
    /** Camino del aventurero: índice, estado y progreso de cada objetivo. */
    m: { i: number; st: 'new' | 'active' | 'ready'; prog: number[] };
    /** Encargos del día: día del reinicio, los de hoy, progreso, entregados, si ya se cobró la esencia y a quién ya le ganaste hoy en PvP. */
    d: { day: number; ids: string[]; prog: Record<string, number>; done: string[]; ess: boolean; pvp: string[] };
}
export const newQuestBook = (): QuestBook => ({ m: { i: 0, st: 'new', prog: [] }, d: { day: -1, ids: [], prog: {}, done: [], ess: false, pvp: [] } });

const int = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
/** Sanea lo guardado (cuentas sin libro, datos rotos o de una versión vieja). */
export function cleanQuestBook(raw: unknown): QuestBook {
    const b = newQuestBook(), o = (raw ?? {}) as Partial<QuestBook>;
    const m = (o.m ?? {}) as Partial<QuestBook['m']>, d = (o.d ?? {}) as Partial<QuestBook['d']>;
    b.m.i = int(m.i, 0, MAIN_QUESTS.length);
    const q = MAIN_QUESTS[b.m.i];
    b.m.st = q && (m.st === 'active' || m.st === 'ready') ? m.st : 'new';
    b.m.prog = b.m.st === 'new' || !q ? [] : q.goals.map((g, j) => int(m.prog?.[j], 0, g.n));
    b.d.day = typeof d.day === 'number' ? Math.floor(d.day) : -1;
    b.d.ids = [...new Set((Array.isArray(d.ids) ? d.ids : []).filter((id): id is string => typeof id === 'string' && DAILY_BY_ID.has(id)))];
    for (const id of b.d.ids) b.d.prog[id] = int(d.prog?.[id], 0, DAILY_BY_ID.get(id)!.goal.n);
    b.d.done = (Array.isArray(d.done) ? d.done : []).filter((id): id is string => b.d.ids.includes(id as string));
    b.d.ess = !!d.ess; b.d.pvp = (Array.isArray(d.pvp) ? d.pvp : []).filter((x): x is string => typeof x === 'string').slice(0, 200);
    return b;
}

/** Encargos que puede tomar alguien de este nivel. */
export const dailyEligible = (lvl: number): DailyQuest[] => DAILY_QUESTS.filter((q) => lvl >= q.minLvl && (q.maxLvl === undefined || lvl <= q.maxLvl));

/**
 * Encargos fijos: al cambiar el día se renuevan todos (los no entregados se pierden); si subiste de nivel en el día,
 * se suman los que se abren con el nivel nuevo. Devuelve true si cambió algo.
 */
export function rollDailies(b: QuestBook, lvl: number, now: number): boolean {
    const day = questDay(now), ids = dailyEligible(lvl).map((q) => q.id);
    if (b.d.day !== day) { b.d = { day, ids, prog: Object.fromEntries(ids.map((id) => [id, 0])), done: [], ess: false, pvp: [] }; return true; }
    const add = ids.filter((id) => !b.d.ids.includes(id)); if (!add.length) return false;
    for (const id of add) { b.d.ids.push(id); b.d.prog[id] = 0; }
    return true;
}

// ---------- eventos ----------
export type QuestEvent =
    | { k: 'kill'; type: MobType; map: string; pit: boolean; /** tier del mob y del jugador (tierOfLevel) */ tier: number; myTier: number; mutant: boolean }
    | { k: 'gather'; n: number }
    | { k: 'dungeon'; d: 'd1' | 'd2' }
    | { k: 'talk'; role: string }
    | { k: 'pvp' };

/** Lo que el jugador tiene ahora (para los objetivos de "tener"): materiales y la mejora más alta entre sus ítems únicos. */
export interface QuestHave { mats: Record<string, number>; maxUp: number }

/** Cuánto suma un evento a un objetivo (0 si no le corresponde). Los de "tener" (collect) no avanzan por eventos. */
export function goalStep(g: QuestGoal, e: QuestEvent): number {
    switch (g.k) {
        case 'kill': return e.k === 'kill' && g.mobs.includes(e.type) && (!g.map || g.map === e.map) ? 1 : 0;
        case 'pit': return e.k === 'kill' && e.pit && e.tier >= e.myTier ? 1 : 0;
        case 'mutant': return e.k === 'kill' && e.mutant ? 1 : 0;
        case 'gather': return e.k === 'gather' ? e.n : 0;
        case 'dungeon': return e.k === 'dungeon' && e.d === g.d ? 1 : 0;
        case 'talk': return e.k === 'talk' && e.role === g.role ? 1 : 0;
        case 'pvp': return e.k === 'pvp' ? 1 : 0;
        default: return 0;
    }
}

/** Progreso de un objetivo: los de "tener" se miran en lo que tenés; el resto, en lo guardado. */
export const goalProgress = (g: QuestGoal, saved: number, have: QuestHave): number =>
    g.k === 'collect' ? Math.min(g.n, have.mats[g.mat] ?? 0) : g.k === 'upgraded' ? (have.maxUp >= g.n ? g.n : 0) : Math.min(g.n, saved);
export const mainComplete = (b: QuestBook, have: QuestHave): boolean => {
    const q = MAIN_QUESTS[b.m.i]; return !!q && q.goals.every((g, j) => goalProgress(g, b.m.prog[j] ?? 0, have) >= g.n);
};

/**
 * Aplica un evento al libro. Devuelve los avisos para el jugador (misión lista, encargo listo).
 * `have` es lo que tiene ahora (para los objetivos de "tener"). Llamar `rollDailies` antes si puede haber cambiado el día.
 * Sin evento (`null`) solo recalcula los de "tener" (después de mejorar, gastar materiales, etc.).
 */
export function applyQuestEvent(b: QuestBook, e: QuestEvent | null, have: QuestHave): string[] {
    const out: string[] = [];
    const q = MAIN_QUESTS[b.m.i];
    if (q && b.m.st === 'active' && e) q.goals.forEach((g, j) => { const s = goalStep(g, e); if (s) b.m.prog[j] = Math.min(g.n, (b.m.prog[j] ?? 0) + s); });
    if (q && b.m.st !== 'new') {
        const was = b.m.st;
        b.m.st = mainComplete(b, have) ? 'ready' : 'active';
        if (was !== 'ready' && b.m.st === 'ready') out.push(`Misión lista: «${q.name}». Volvé con el Capitán.`);
    }
    for (const id of b.d.ids) {
        if (b.d.done.includes(id)) continue;
        const dq = DAILY_BY_ID.get(id)!, before = b.d.prog[id] ?? 0, s = e ? goalStep(dq.goal, e) : 0;
        if (!s) continue;
        b.d.prog[id] = Math.min(dq.goal.n, before + s);
        if (before < dq.goal.n && b.d.prog[id] >= dq.goal.n) out.push(`Encargo listo: «${dq.name}». Entregalo al Capitán.`);
    }
    return out;
}

/** Ítems que se pueden elegir (o sortear) como premio, según la clase. El mago y el healer usan lo que da Magia; el guerrero, lo que no. */
export function rewardUniques(kind: NonNullable<QuestReward['unique']>, cls: string): UniqueBase[] {
    if (kind === 'boss_d2_choice') return BOSS_UNIQUES[DUNGEON_BOSS.d2] ?? [];
    const caster = cls === 'mago' || cls === 'healer';
    return (UNIQUES_BY_TIER[1] ?? []).filter((u) => u.slot === 'anillo' || (caster ? (u.mag ?? 0) > 0 : !(u.mag ?? 0)));
}

// ---------- vista para el cliente (va como JSON en InventoryState.quest_book) ----------
export interface QuestBookView {
    m: { i: number; st: QuestBook['m']['st']; prog: number[] };
    d: { ids: string[]; prog: Record<string, number>; done: string[]; ess: boolean; resetMs: number };
    mats: Record<string, number>;
}
export function questBookView(b: QuestBook, have: QuestHave, now: number): QuestBookView {
    const q = MAIN_QUESTS[b.m.i];
    return {
        m: { i: b.m.i, st: b.m.st, prog: q && b.m.st !== 'new' ? q.goals.map((g, j) => goalProgress(g, b.m.prog[j] ?? 0, have)) : [] },
        d: { ids: b.d.ids, prog: b.d.prog, done: b.d.done, ess: b.d.ess, resetMs: msToReset(now) },
        mats: Object.fromEntries(Object.entries(have.mats).filter(([, n]) => n > 0)),
    };
}
