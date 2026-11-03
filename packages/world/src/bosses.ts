/**
 * Motor de jefes (docs/JEFES.md): las mecánicas de cada jefe como datos. El server las ejecuta (apps/server/src/bosses.ts) y el cliente
 * solo dibuja lo que le avisan (barra de casteo, círculos en el piso, charcos, furia).
 *
 * El daño se escribe en múltiplos del golpe común del propio jefe (`dmgK`), así escala solo con el nivel del jefe y con la party.
 */
import type { MobType } from './mobs.ts';

/** Escuela del casteo: ícono y color de la barra, y lo que bloquea un corte (la misma escuela no se puede volver a castear un rato). */
export type BossSchool = 'fis' | 'fuego' | 'acido' | 'sombra';

/** Lo que hace un casteo o un golpe al salir. `r` = radio alrededor del jefe (0 = solo el objetivo del casteo). */
export interface BossEffect {
    r: number;
    /** Daño en múltiplos del golpe común del jefe. */
    dmgK?: number;
    /** Daño en fracción de la vida máxima de cada jugador (los golpes de sala que "sacan el 70 %"). Pasa por la defensa. */
    pctHp?: number;
    /** Segundos de aturdido. */
    stun?: number;
    /** Segundos de terror: el jugador sale despedido lejos del jefe y queda aterrado (no puede actuar) ese tiempo. */
    terror?: number;
    /** Segundos de frenado. */
    slow?: number;
    /** Segundos de anti-cura (el veneno: −30 % de curación recibida). */
    antiHeal?: number;
    /** El lanzador se cura esta fracción de su vida máxima. */
    heal?: number;
    /** Les saca a los alcanzados los buffs y escudos (bendiciones, escudo de maná, divino, guardián): hay que volver a ponerlos. */
    dispel?: boolean;
}

/** Casteo con barra. `window` = fracción final de la barra en la que entra un corte blando (por defecto 0,4, mínimo 0,8 s). */
export interface BossCastDef {
    kind: 'cast'; id: string; name: string; school: BossSchool;
    castMs: number; every: number; first?: number;
    window?: number;
    /** No se puede cortar (candado). */
    lock?: boolean;
    /** A quién apunta un casteo de un objetivo (`effect.r` = 0): el que tanquea o uno al azar. */
    target?: 'tank' | 'random';
    effect: BossEffect;
    /** Salida alternativa: si al terminar su objetivo está a más de `beyond` celdas, en vez del efecto hace esto (carga hasta él y lo golpea). */
    alt?: { beyond: number; name: string; dmgK: number; slow?: number };
}

/** Aviso en el piso: círculo de radio `r` en el jefe, en el que tanquea o en un jugador al azar; pega a los `warnMs`. Puede dejar un charco. */
export interface BossTelegraphDef {
    kind: 'telegraph'; id: string; name: string; every: number; first?: number;
    warnMs: number; at: 'self' | 'tank' | 'random'; r: number;
    dmgK?: number; stun?: number;
    pool?: { name: string; r: number; secs: number; dpsK: number };
}

/** Golpe fuerte al que tanquea, con aviso corto. Puede dejar sangrado que se apila. */
export interface BossTankHitDef {
    kind: 'tankHit'; id: string; name: string; every: number; first?: number;
    warnMs: number; mult: number;
    /** Sangrado: `ticks` pulsos de 1 s de `pct` de la vida máxima por pila, hasta `maxStacks` pilas. */
    bleed?: { pct: number; ticks: number; maxStacks: number };
}

/**
 * Tirón y explosión (Vortex → Apocalypse de Dreadmyst): arrastra a todos los que estén a `r` celdas o menos hasta el lado del jefe y marca
 * un círculo de `blastR` alrededor suyo que estalla a los `warnMs`. Hay que salir corriendo del círculo.
 */
export interface BossPullDef { kind: 'pull'; id: string; name: string; every: number; first?: number; r: number; blastR: number; warnMs: number; dmgK: number }

export type BossAbilityDef = BossCastDef | BossTelegraphDef | BossTankHitDef | BossPullDef;

/** Adds al cruzar un umbral de vida (una sola vez). `minParty`: solo si la corrida es de esa cantidad o más. `kit`: el add tiene sus propias mecánicas. */
export interface BossAddsDef { atHp: number; text: string; spawn: { type: MobType; n: number; lvl?: number; minParty?: number; kit?: string; name?: string }[] }

export interface BossKit {
    abilities: BossAbilityDef[];
    adds?: BossAddsDef[];
    /** Furia al bajar de `atHp`: daño ×`dmg` y casteos ×`castSpeed` de largo. */
    enrage?: { atHp: number; dmg: number; castSpeed: number };
    /** Furia final por tiempo: a los `secs` de pelea, daño ×`dmg`. */
    hardEnrage?: { secs: number; dmg: number };
    /** Respiro mínimo entre dos mecánicas (s): dos fuertes nunca caen juntas. Por defecto 4. */
    gap?: number;
    /** Furia que se apila (Duke's Fury de Dreadmyst): cada `every` s de pelea, +`pct` de daño. Castiga las peleas largas sin un reloj que mate. */
    stackFury?: { every: number; pct: number };
}

/** Bloqueo de escuela después de un corte (s) y tiempo sin castear (s): la Antimagia de Dreadmyst. */
export const BOSS_SCHOOL_LOCK = 4, BOSS_CUT_PAUSE = 1;
export const BOSS_WINDOW_DEFAULT = 0.4, BOSS_WINDOW_MIN_MS = 800;
export const BOSS_GAP_DEFAULT = 4;

/**
 * Cortes (docs/JEFES.md §2): un corte duro (todo lo que aturde, congela o provoca) corta en cualquier momento; uno blando, solo si pega en la
 * ventana del final. Los jefes con kit son inmunes al aturdir: el control corta el casteo pero no los deja aturdidos.
 */
export const HARD_INTERRUPTS = new Set(['paralisis', 'nova', 'escudo', 'aturdir', 'carga', 'reprender']);
export const SOFT_INTERRUPTS = new Set(['castigo', 'juicio', 'esquirla']);

/** Inicio de la ventana de un casteo (ms desde que empieza). */
export function castWindowFrom(c: Pick<BossCastDef, 'castMs' | 'window'>, castMs = c.castMs): number {
    const w = Math.max(BOSS_WINDOW_MIN_MS, castMs * (c.window ?? BOSS_WINDOW_DEFAULT));
    return Math.max(0, Math.round(castMs - Math.min(castMs, w)));
}

/** Mecánicas de los adds lanzadores. */
export const ADD_KITS: Record<string, BossKit> = {
    // chamán del jefe goblin (D1, en dúo o más): una bola de fuego a uno al azar, que se corta
    chaman: { gap: 2, abilities: [{ kind: 'cast', id: 'fogonazo', name: 'Fogonazo', school: 'fuego', castMs: 2000, every: 8, first: 3, target: 'random', effect: { r: 0, dmgK: 2 } }] },
    // obrera escupidora de la Reina (D2, al 30 %): el Lord Zargan en chico, anti-cura a uno al azar
    escupidora: { gap: 2, abilities: [{ kind: 'cast', id: 'saliva', name: 'Saliva ácida', school: 'acido', castMs: 1800, every: 9, first: 2, target: 'random', effect: { r: 0, dmgK: 0.5, antiHeal: 8 } }] },
    // hechicero de la cripta y de la torre: una saeta sombría a uno al azar, que se corta (los Hechiceros deshonrados de Kandorys)
    // carcelero del Gran Verdugo (D7, al 50 % en trío o más): encadena a uno al azar (frenado + anti-cura); hay que cortarlo o matarlo rápido
    carcelero: { gap: 2, abilities: [{ kind: 'cast', id: 'grillete', name: 'Grillete', school: 'sombra', castMs: 2000, every: 9, first: 2, target: 'random', effect: { r: 0, dmgK: 1, slow: 4, antiHeal: 6 } }] },
    hechicero: { gap: 2, abilities: [{ kind: 'cast', id: 'saeta', name: 'Saeta sombría', school: 'sombra', castMs: 2000, every: 8, first: 3, target: 'random', effect: { r: 0, dmgK: 2 } }] },
};

/** Jefes con el motor nuevo. Los que no están acá siguen con su `special` de siempre. */
export const BOSS_KITS: Partial<Record<MobType, BossKit>> = {
    // D1, solo o dúo: ningún corte es obligatorio (alejarse del Grito y esquivar el Pisotón alcanza); cortar es más rápido y seguro
    goblin_jefe: {
        abilities: [
            { kind: 'telegraph', id: 'pisoton', name: 'Pisotón', every: 10, first: 5, warnMs: 1300, at: 'self', r: 3, dmgK: 0.8, stun: 1 },
            {
                kind: 'cast', id: 'grito', name: 'Grito de terror', school: 'sombra', castMs: 2000, every: 15, first: 9,
                effect: { r: 6, dmgK: 0.3, terror: 3 },
                alt: { beyond: 4, name: 'Carga y desjarrete', dmgK: 1.2, slow: 4 }, // el Minotauro de Kandorys: si te alejás, te carga
            },
        ],
        adds: [{ atHp: 0.5, text: '¡A mí, muchachos!', spawn: [{ type: 'goblin', n: 2, lvl: 5 }, { type: 'hobgoblin', n: 1, lvl: 5, minParty: 2, kit: 'chaman', name: 'Chamán goblin' }] }],
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
    },
    // D2, trío: pide un corte cada ~12 s (la Lluvia); alcanza rotando Cadenas, Escudo vengador, Martillo, Reprender o Castigo en la ventana
    antlion_reina: {
        abilities: [
            { kind: 'telegraph', id: 'chorro', name: 'Chorro de ácido', every: 9, first: 4, warnMs: 1300, at: 'random', r: 2.5, dmgK: 1, pool: { name: 'Charco de ácido', r: 2.5, secs: 6, dpsK: 0.3 } },
            { kind: 'cast', id: 'lluvia', name: 'Lluvia de ácido', school: 'acido', castMs: 2500, every: 12, first: 7, effect: { r: 14, pctHp: 0.7 } },
            { kind: 'tankHit', id: 'mordida', name: 'Mordida corrosiva', every: 11, first: 10, warnMs: 800, mult: 3, bleed: { pct: 0.03, ticks: 5, maxStacks: 3 } },
        ],
        adds: [
            { atHp: 0.6, text: 'La Reina llama a sus crías.', spawn: [{ type: 'antlion_small', n: 3, lvl: 9 }] },
            { atHp: 0.3, text: 'La Reina llama a sus crías.', spawn: [{ type: 'antlion_small', n: 2, lvl: 9 }, { type: 'fire_ant', n: 1, lvl: 9, kit: 'escupidora', name: 'Obrera escupidora' }] },
        ],
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
        hardEnrage: { secs: 300, dmg: 3 },
    },
    // D3 (11-20): tanque con autocura. Si nadie corta el Juramento, la pelea se alarga y la furia apilable la vuelve peligrosa
    caballero_cripta: {
        abilities: [
            { kind: 'tankHit', id: 'escudazo', name: 'Golpe de escudo', every: 9, first: 6, warnMs: 900, mult: 2.5 },
            { kind: 'cast', id: 'juramento', name: 'Juramento oscuro', school: 'sombra', castMs: 2500, every: 16, first: 10, target: 'tank', effect: { r: 0, heal: 0.12 } },
            { kind: 'telegraph', id: 'tajo', name: 'Tajo sombrío', every: 11, first: 4, warnMs: 1300, at: 'random', r: 2.5, dmgK: 1.2 },
        ],
        adds: [
            { atHp: 0.6, text: 'Los muertos de la cripta se levantan.', spawn: [{ type: 'skeleton', n: 2 }] },
            { atHp: 0.3, text: 'Los muertos de la cripta se levantan.', spawn: [{ type: 'skeleton', n: 1 }, { type: 'skeleton_mage', n: 1, kit: 'hechicero', name: 'Hechicero de la cripta' }] },
        ],
        stackFury: { every: 10, pct: 0.03 },
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
    },
    // D4: lanzador. Mucho para cortar, un tirón que hay que salir corriendo y un disipar que no se corta (hay que volver a ponerse los escudos)
    mago_mayor: {
        abilities: [
            { kind: 'cast', id: 'bola', name: 'Bola arcana', school: 'fuego', castMs: 2000, every: 7, first: 3, target: 'random', effect: { r: 0, dmgK: 2.5 } },
            { kind: 'cast', id: 'lluviafuego', name: 'Lluvia de fuego', school: 'fuego', castMs: 3000, every: 14, first: 9, effect: { r: 14, pctHp: 0.6 } },
            { kind: 'pull', id: 'vortice', name: 'Vórtice', every: 20, first: 15, r: 12, blastR: 3, warnMs: 1600, dmgK: 2.5 },
            { kind: 'cast', id: 'disipar', name: 'Disipar magia', school: 'sombra', castMs: 1500, every: 18, first: 12, lock: true, effect: { r: 14, dispel: true } },
        ],
        adds: [{ atHp: 0.5, text: 'El Mago mayor llama a sus aprendices.', spawn: [{ type: 'skeleton_mage', n: 2, kit: 'hechicero', name: 'Aprendiz' }] }],
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
    },
    // D5 (21-30): el aire. Un rugido de sala que aterra (cortable) y una tormenta con candado (escudos y curas)
    wyvern_aire: {
        abilities: [
            { kind: 'telegraph', id: 'rafaga', name: 'Ráfaga', every: 9, first: 4, warnMs: 1200, at: 'random', r: 3, dmgK: 1.2, pool: { name: 'Remolino', r: 3, secs: 5, dpsK: 0.3 } },
            { kind: 'cast', id: 'rugido', name: 'Rugido', school: 'sombra', castMs: 2000, every: 15, first: 8, effect: { r: 14, dmgK: 0.3, terror: 3 } },
            { kind: 'cast', id: 'tormenta', name: 'Tormenta de viento', school: 'fis', castMs: 2500, every: 18, first: 13, lock: true, effect: { r: 14, pctHp: 0.4 } },
            { kind: 'tankHit', id: 'zarpazo', name: 'Zarpazo', every: 11, first: 10, warnMs: 800, mult: 3, bleed: { pct: 0.03, ticks: 5, maxStacks: 3 } },
        ],
        adds: [{ atHp: 0.5, text: 'Las crías de la tormenta bajan del cielo.', spawn: [{ type: 'wyvern_ice', n: 1 }, { type: 'wyvern_fire', n: 1 }] }],
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
        hardEnrage: { secs: 360, dmg: 3 },
    },
    // D6 (el Foso): todo junto. Tirón, llamas de sala para cortar, grito que aterra y disipa, golpe al tanque con sangrado y furia apilable
    demonio_foso: {
        abilities: [
            { kind: 'telegraph', id: 'salto', name: 'Salto sísmico', every: 10, first: 5, warnMs: 1300, at: 'tank', r: 3.4, dmgK: 1.5, stun: 1 },
            { kind: 'cast', id: 'llamas', name: 'Llamas del foso', school: 'fuego', castMs: 2500, every: 13, first: 8, effect: { r: 14, pctHp: 0.65 } },
            { kind: 'pull', id: 'vortice', name: 'Vórtice infernal', every: 22, first: 16, r: 12, blastR: 3, warnMs: 1500, dmgK: 3 },
            { kind: 'tankHit', id: 'desgarro', name: 'Desgarro', every: 11, first: 11, warnMs: 800, mult: 3, bleed: { pct: 0.03, ticks: 5, maxStacks: 3 } },
            { kind: 'cast', id: 'grito', name: 'Grito del foso', school: 'sombra', castMs: 1800, every: 24, first: 20, effect: { r: 14, terror: 2, dispel: true } },
        ],
        adds: [
            { atHp: 0.6, text: 'Del foso salen llamas con alas.', spawn: [{ type: 'wyvern_fire', n: 2 }] },
            { atHp: 0.3, text: 'Del foso salen llamas con alas.', spawn: [{ type: 'wyvern_fire', n: 1 }, { type: 'skeleton_mage', n: 1, kit: 'hechicero', name: 'Brujo del foso' }] },
        ],
        stackFury: { every: 10, pct: 0.03 },
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
        hardEnrage: { secs: 420, dmg: 3 },
    },
    // D7 (Nv 40, el tope): el examen final. Pide todo lo aprendido: tanque que aguante el Hachazo con sangrado, cortes del Suplicio (anti-cura
    // de sala) en la ventana, salir del tirón de las Cadenas, esquivar el Patíbulo y disipar con candado que obliga a re-bufear.
    // Fase 2 (50 %): carceleros que encadenan. Fase 3 (25 %): furia. Tope duro a los 8 minutos.
    verdugo: {
        abilities: [
            { kind: 'tankHit', id: 'hachazo', name: 'Hachazo', every: 10, first: 6, warnMs: 900, mult: 3.2, bleed: { pct: 0.035, ticks: 6, maxStacks: 4 } },
            { kind: 'telegraph', id: 'patibulo', name: 'Patíbulo', every: 9, first: 4, warnMs: 1200, at: 'random', r: 2.8, dmgK: 1.6, stun: 1, pool: { name: 'Sangre del patíbulo', r: 2.8, secs: 6, dpsK: 0.35 } },
            { kind: 'cast', id: 'suplicio', name: 'Suplicio', school: 'sombra', castMs: 2500, every: 13, first: 9, effect: { r: 14, pctHp: 0.55, antiHeal: 6 } },
            { kind: 'pull', id: 'cadenas', name: 'Cadenas del verdugo', every: 21, first: 15, r: 12, blastR: 3.2, warnMs: 1500, dmgK: 3.2 },
            { kind: 'cast', id: 'sentencia', name: 'Sentencia', school: 'fis', castMs: 2000, every: 26, first: 22, lock: true, effect: { r: 14, terror: 2, dispel: true } },
        ],
        adds: [
            { atHp: 0.6, text: 'El Verdugo llama a sus condenados.', spawn: [{ type: 'zombie_dark', n: 3 }] },
            { atHp: 0.5, text: 'Bajan los carceleros con sus grilletes.', spawn: [{ type: 'skeleton', n: 1, kit: 'carcelero', name: 'Carcelero' }, { type: 'skeleton', n: 1, minParty: 3, kit: 'carcelero', name: 'Carcelero' }] },
            { atHp: 0.25, text: 'Las celdas se abren.', spawn: [{ type: 'zombie_dark', n: 2 }, { type: 'skeleton_mage', n: 1, kit: 'hechicero', name: 'Brujo de las cámaras' }] },
        ],
        stackFury: { every: 10, pct: 0.035 },
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
        hardEnrage: { secs: 480, dmg: 3 },
    },
    // Jefe de mundo (T4, nivel 20): pelea abierta para varias parties y, en mapa de facción, con la otra nación cerca. Mecánicas de sala
    // simples de leer (piso que tiembla, derrumbe cortable, puño al tanque) y adds que obligan a repartirse.
    coloso: {
        abilities: [
            { kind: 'telegraph', id: 'temblor', name: 'Temblor', every: 9, first: 4, warnMs: 1300, at: 'random', r: 3.2, dmgK: 1.2, stun: 1 },
            { kind: 'cast', id: 'derrumbe', name: 'Derrumbe', school: 'fis', castMs: 2500, every: 14, first: 9, effect: { r: 14, pctHp: 0.5 } },
            { kind: 'tankHit', id: 'puno', name: 'Puño de roca', every: 11, first: 8, warnMs: 900, mult: 3, bleed: { pct: 0.03, ticks: 5, maxStacks: 3 } },
            { kind: 'pull', id: 'avalancha', name: 'Avalancha', every: 24, first: 18, r: 12, blastR: 3.2, warnMs: 1600, dmgK: 2.5 },
        ],
        adds: [
            { atHp: 0.6, text: 'Del suelo se levantan guardianes de piedra.', spawn: [{ type: 'minotaur', n: 2, lvl: 20 }] },
            { atHp: 0.3, text: 'Del suelo se levantan guardianes de piedra.', spawn: [{ type: 'minotaur', n: 2, lvl: 20 }, { type: 'skeleton_mage', n: 1, lvl: 20, kit: 'hechicero', name: 'Brujo de las rocas' }] },
        ],
        enrage: { atHp: 0.25, dmg: 1.5, castSpeed: 0.7 },
        hardEnrage: { secs: 600, dmg: 3 },
    },
};

/**
 * Jefe de mundo del MVP (docs/JEFE_DE_MUNDO.md): uno solo, sale una vez por día a una hora al azar (para que no lo campeen) en uno de los
 * mapas abiertos de su tier, también al azar. Si nadie lo mata en `lifeMin` minutos, se va.
 */
export const WORLD_BOSS = { type: 'coloso' as MobType, tier: 4, lifeMin: 40, /** ventana del día (hora de Argentina) en la que puede salir */ fromHour: 10, toHour: 23 };
